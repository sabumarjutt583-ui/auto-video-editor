//! The real way to make pictures: the browser workers (free engine) and the API calls.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::api_engines::{cloudflare_image, gemini_image, CLOUDFLARE_BASE, GEMINI_BASE};
use super::browser::locator;
use super::browser::session::Mode;
use super::config::EngineConfig;
use super::engine::{BoxFuture, Generators, Picture};
use super::errors::{ErrorKind, GenError};
use super::queue::Job;
use super::settings::{ApiProvider, BrowserMode, ImageGenSettings};
use super::worker::{FreeWorker, WorkerConfig};
use crate::keys::{self, KeyStatus, Provider};

pub struct RealGenerators {
    dir: PathBuf,
    config: Mutex<Arc<EngineConfig>>,
    workers: Mutex<HashMap<String, FreeWorker>>,
    api_cache: Mutex<Option<(Instant, String, bool)>>,
    /// Extra browser switches (tests only).
    pub extra_args: Vec<String>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn mode_of(mode: BrowserMode) -> Mode {
    match mode {
        BrowserMode::Hidden => Mode::Hidden,
        BrowserMode::Window => Mode::Window,
    }
}

impl RealGenerators {
    pub fn new(dir: PathBuf, config: Arc<EngineConfig>) -> Self {
        Self { dir, config: Mutex::new(config), workers: Mutex::new(HashMap::new()), api_cache: Mutex::new(None), extra_args: Vec::new() }
    }

    pub fn profile_dir(&self, account_id: &str) -> PathBuf {
        self.dir.join("profiles").join(account_id)
    }

    pub fn engine_config(&self) -> Arc<EngineConfig> {
        lock(&self.config).clone()
    }

    /// New settings of the page: browsers are closed so that the next job uses the new address.
    pub async fn set_config(&self, config: Arc<EngineConfig>) {
        *lock(&self.config) = config;
        self.close_all().await;
    }

    /// The worker of an account (created on first use).
    pub fn worker(&self, account_id: &str, settings: &ImageGenSettings) -> Result<FreeWorker, GenError> {
        if let Some(worker) = lock(&self.workers).get(account_id) {
            return Ok(worker.clone());
        }
        let exe = locator::find(Some(&settings.browser_path)).ok_or_else(|| {
            GenError::new(ErrorKind::Session, "No Chrome, Edge, Brave or Chromium browser was found. Please install one (Chrome is best) or choose a browser in Settings.")
        })?;
        let worker = FreeWorker::new(WorkerConfig { exe, profile: self.profile_dir(account_id), mode: mode_of(settings.browser_mode), extra_args: self.extra_args.clone(), engine: self.engine_config() });
        lock(&self.workers).insert(account_id.to_string(), worker.clone());
        Ok(worker)
    }

    pub fn existing_worker(&self, account_id: &str) -> Option<FreeWorker> {
        lock(&self.workers).get(account_id).cloned()
    }

    pub async fn close_worker(&self, account_id: &str) {
        let worker = lock(&self.workers).remove(account_id);
        if let Some(worker) = worker {
            worker.close().await;
        }
    }

    pub async fn close_all(&self) {
        let all: Vec<FreeWorker> = lock(&self.workers).drain().map(|(_, w)| w).collect();
        for worker in all {
            worker.close().await;
        }
    }

    /// Closes the browsers that nobody used for `after`.
    pub async fn close_idle(&self, after: Duration) {
        let idle: Vec<(String, FreeWorker)> = lock(&self.workers).iter().filter(|(_, w)| w.idle_for() >= after).map(|(id, w)| (id.clone(), w.clone())).collect();
        for (id, worker) in idle {
            worker.close().await;
            lock(&self.workers).remove(&id);
        }
    }

    pub fn invalidate_api_cache(&self) {
        *lock(&self.api_cache) = None;
    }
}

async fn read_key(provider: Provider) -> Result<String, GenError> {
    let result = tokio::task::spawn_blocking(move || keys::require(provider)).await;
    match result {
        Ok(Ok(key)) => Ok(key),
        Ok(Err(error)) => Err(GenError::new(ErrorKind::Auth, error.message)),
        Err(_) => Err(GenError::new(ErrorKind::Auth, "The key could not be read from the keychain.")),
    }
}

impl Generators for RealGenerators {
    fn free(&self, account_id: &str, job: &Job, settings: &ImageGenSettings) -> BoxFuture<Picture> {
        let worker = self.worker(account_id, settings);
        let (prompt, aspect) = (job.prompt.clone(), job.aspect.clone());
        let (parallel, timeout) = (settings.parallel, Duration::from_secs(u64::from(settings.timeout_sec)));
        Box::pin(async move { worker?.generate(&prompt, &aspect, parallel, timeout).await })
    }

    fn api(&self, job: &Job, settings: &ImageGenSettings) -> BoxFuture<Picture> {
        let (prompt, aspect) = (job.prompt.clone(), job.aspect.clone());
        let settings = settings.clone();
        Box::pin(async move {
            match settings.api_provider {
                ApiProvider::Gemini => {
                    let key = read_key(Provider::Gemini).await?;
                    gemini_image(GEMINI_BASE, &key, &settings.gemini_image_model, &prompt, &aspect).await
                }
                ApiProvider::Cloudflare => {
                    let token = read_key(Provider::Cloudflare).await?;
                    cloudflare_image(CLOUDFLARE_BASE, &settings.cloudflare_account_id, &token, &settings.cloudflare_model, &prompt).await
                }
            }
        })
    }

    fn api_ready(&self, settings: &ImageGenSettings) -> bool {
        let tag = format!("{:?}/{}", settings.api_provider, settings.cloudflare_account_id);
        if let Some((at, cached_tag, ready)) = lock(&self.api_cache).as_ref() {
            if *cached_tag == tag && at.elapsed() < Duration::from_secs(5) {
                return *ready;
            }
        }
        let ready = match settings.api_provider {
            ApiProvider::Gemini => keys::status(Provider::Gemini).is_ok_and(|s| s == KeyStatus::Set),
            ApiProvider::Cloudflare => !settings.cloudflare_account_id.is_empty() && keys::status(Provider::Cloudflare).is_ok_and(|s| s == KeyStatus::Set),
        };
        *lock(&self.api_cache) = Some((Instant::now(), tag, ready));
        ready
    }

    fn switch_to_window(&self, account_id: &str) -> BoxFuture<bool> {
        let worker = self.existing_worker(account_id);
        Box::pin(async move {
            match worker {
                Some(worker) => worker.switch_to_window().await,
                None => false,
            }
        })
    }
}
