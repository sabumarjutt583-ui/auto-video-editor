//! The scheduler. It hands the queued scenes to the Google accounts (round-robin) or to the API,
//! saves every finished picture into the project's `media` folder under its timecode name, and decides
//! what each kind of error means. It does not know how a picture is made: that is the `Generators`
//! trait (the browser worker and the API calls in the app, a fake in the tests).
//!
//! The rules (see docs/IMAGE_ENGINE_NOTES.md section 7):
//! * a usage limit (429) pauses only that account (1, 2, 4 ... 30 minutes), the job waits, no attempt is used;
//! * signed out / flagged / no access: that account takes no jobs until the user fixes it, no attempt is used;
//! * browser or network trouble: the job is queued again, no attempt is used;
//! * timeouts, server errors and empty answers retry with a delay, up to the maximum number of attempts;
//! * content refusals and bad requests are never retried;
//! * with "continue with the API" on, work moves to the API when no account can take it.

use std::collections::HashSet;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::Notify;

use super::accounts::{Accounts, AccountsFile, AccountView, FreeSummary};
use super::config::EngineConfig;
use super::errors::{ErrorKind, GenError};
use super::queue::{AddReport, Job, NewJob, Queue, RequeueOptions, Requeued, Stats, Status, Via};
use super::recovery;
use super::save::{self, SaveError, Saved};
use super::settings::{ApiProvider, Engine as Mode, ImageGenSettings};
use super::store::{load_json, save_json};
use crate::commands::error::AppError;

pub type Picture = Result<Vec<u8>, GenError>;
pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send + 'static>>;

/// How a picture is made. Implemented by the real browser/API code and by test fakes.
pub trait Generators: Send + Sync + 'static {
    fn free(&self, account_id: &str, job: &Job, settings: &ImageGenSettings) -> BoxFuture<Picture>;
    fn api(&self, job: &Job, settings: &ImageGenSettings) -> BoxFuture<Picture>;
    /// The API can be used (a key is saved, an account id is set).
    fn api_ready(&self, settings: &ImageGenSettings) -> bool;
    /// Hidden mode was refused: use a minimized window for this account. `false` when that is already so.
    fn switch_to_window(&self, account_id: &str) -> BoxFuture<bool>;
}

/// Where events for the page go (the app emits them to the window; tests collect them).
pub trait Sink: Send + Sync + 'static {
    fn emit(&self, event: &str, payload: Value);
}

#[derive(Debug, Clone, Copy)]
pub struct Tuning {
    pub retry_base_ms: u64,
    pub retry_max_ms: u64,
    pub session_cooldown_ms: u64,
    pub heartbeat_ms: u64,
    pub storage_retry_ms: u64,
}

impl Default for Tuning {
    fn default() -> Self {
        Self { retry_base_ms: 3_000, retry_max_ms: 60_000, session_cooldown_ms: 3_000, heartbeat_ms: 1_000, storage_retry_ms: 15_000 }
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    /// `consent`, `no_account`, `signing_in`, `all_limited`, `needs_attention`, `api_key_missing`, `storage`, `waiting_retry`.
    pub kind: &'static str,
    pub text: String,
    pub until: u64,
}

pub struct NoticeInput {
    pub now: u64,
    pub queued: usize,
    pub generating: usize,
    pub engine: Mode,
    pub consent_ok: bool,
    pub summary: FreeSummary,
    pub fallback: bool,
    pub api_ready: bool,
    pub next_cooldown_end: u64,
    pub next_retry_at: u64,
    pub storage_error: Option<String>,
}

/// Why nothing is happening while scenes are waiting. `None` when work is going on (or nothing waits).
pub fn compute_notice(i: &NoticeInput) -> Option<Notice> {
    if i.queued == 0 || i.generating > 0 {
        return None;
    }
    let make = |kind: &'static str, text: &str, until: u64| Some(Notice { kind, text: text.to_string(), until });
    if let Some(error) = &i.storage_error {
        return make("storage", &format!("The pictures cannot be saved: {error} Generation continues when the folder works again."), 0);
    }
    let api_will_help = i.fallback && i.api_ready;
    match i.engine {
        Mode::Api if !i.api_ready => make("api_key_missing", "The API key (or Cloudflare account id) is missing. Add it in Settings.", 0),
        Mode::Api => (i.next_retry_at > i.now).then(|| Notice { kind: "waiting_retry", text: "Waiting a moment before trying again.".into(), until: i.next_retry_at }),
        Mode::Free if api_will_help => None,
        Mode::Free if !i.consent_ok => make("consent", "Please read and accept the notice about the free engine first.", 0),
        Mode::Free if i.summary.total == 0 => make("no_account", "No Google account is connected yet. Add one in the accounts panel and press Sign in.", 0),
        Mode::Free if i.summary.working > 0 => (i.next_retry_at > i.now).then(|| Notice { kind: "waiting_retry", text: "Waiting a moment before trying again.".into(), until: i.next_retry_at }),
        Mode::Free if i.summary.starting > 0 => make("signing_in", "Waiting for a Google account to finish signing in.", 0),
        Mode::Free if i.summary.cooling > 0 => Some(Notice { kind: "all_limited", text: "Every Google account reached its usage limit. The next one is ready again at the time shown.".into(), until: i.next_cooldown_end }),
        Mode::Free => make("needs_attention", "No Google account can work right now (signed out, paused or asked for a check). Open the accounts panel.", 0),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobView {
    pub id: String,
    pub order: u32,
    pub file_name: String,
    pub status: Status,
    pub attempts: u32,
    pub account_id: Option<String>,
    pub via: Option<Via>,
    pub file: Option<String>,
    pub error: String,
    pub error_kind: Option<ErrorKind>,
    pub regenerate: bool,
    pub next_attempt_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub project_dir: Option<String>,
    pub running: bool,
    pub stats: Stats,
    pub jobs: Vec<JobView>,
    pub accounts: Vec<AccountView>,
    pub settings: ImageGenSettings,
    pub config_version: String,
    pub consent_needed: bool,
    pub api_ready: bool,
    pub notice: Option<Notice>,
    pub now: u64,
}

struct Run {
    dir: PathBuf,
    queue: Queue,
    running: bool,
    storage_error: Option<String>,
    storage_retry_at: u64,
}

#[derive(Default)]
struct ApiGate {
    cooldown_until: u64,
    level: u32,
}

struct State {
    settings: ImageGenSettings,
    config: Arc<EngineConfig>,
    accounts: Accounts,
    run: Option<Run>,
    api: ApiGate,
}

struct Inner {
    dir: PathBuf,
    gens: Arc<dyn Generators>,
    sink: Arc<dyn Sink>,
    state: Mutex<State>,
    wake: Notify,
    tuning: Mutex<Tuning>,
}

#[derive(Clone)]
pub struct Engine {
    inner: Arc<Inner>,
}

fn io_error(message: &str, error: impl std::fmt::Display) -> AppError {
    AppError::new(message, error.to_string())
}

fn jobs_file(project: &Path) -> PathBuf {
    project.join("imagegen").join("jobs.json")
}

fn run_state_file(dir: &Path) -> PathBuf {
    dir.join("run.json")
}

enum Pick {
    Free(Job, String),
    Api(Job),
}

impl Engine {
    pub fn new(dir: PathBuf, gens: Arc<dyn Generators>, sink: Arc<dyn Sink>, config: EngineConfig) -> Self {
        let settings = load_json::<ImageGenSettings>(&dir.join("settings.json")).and_then(|s| s.validated().ok()).unwrap_or_default();
        let accounts = Accounts::new(load_json::<AccountsFile>(&dir.join("accounts.json")).unwrap_or_default());
        let state = State { settings, config: Arc::new(config), accounts, run: None, api: ApiGate::default() };
        Self { inner: Arc::new(Inner { dir, gens, sink, state: Mutex::new(state), wake: Notify::new(), tuning: Mutex::new(Tuning::default()) }) }
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.inner.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    #[cfg(test)]
    pub fn set_tuning(&self, tuning: Tuning) {
        *self.inner.tuning.lock().unwrap_or_else(|e| e.into_inner()) = tuning;
    }

    fn tuning(&self) -> Tuning {
        *self.inner.tuning.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn data_dir(&self) -> &Path {
        &self.inner.dir
    }

    // ----- settings, config, accounts -----

    pub fn settings(&self) -> ImageGenSettings {
        self.state().settings.clone()
    }

    pub fn config(&self) -> Arc<EngineConfig> {
        self.state().config.clone()
    }

    pub fn set_config(&self, config: EngineConfig) {
        self.state().config = Arc::new(config);
        self.changed();
    }

    pub fn set_settings(&self, settings: ImageGenSettings) -> Result<(), AppError> {
        let settings = settings.validated()?;
        {
            let mut state = self.state();
            // The consent is only changed by `accept_consent`.
            let consent = state.settings.consent.clone();
            state.settings = ImageGenSettings { consent, ..settings };
        }
        self.persist_settings();
        self.changed();
        Ok(())
    }

    pub fn accept_consent(&self) -> Result<(), AppError> {
        {
            let mut state = self.state();
            let major = state.config.major().unwrap_or(1);
            state.settings.consent = Some(super::settings::Consent { accepted_at: crate::clock::timestamp(), config_major: major });
        }
        self.persist_settings();
        self.changed();
        Ok(())
    }

    fn persist_settings(&self) {
        let settings = self.state().settings.clone();
        let _ = save_json(&self.inner.dir.join("settings.json"), &settings);
    }

    pub fn persist_accounts(&self) {
        let file = self.state().accounts.file.clone();
        let _ = save_json(&self.inner.dir.join("accounts.json"), &file);
    }

    /// Runs `change` on the accounts, saves them and tells the page.
    pub fn with_accounts<T>(&self, change: impl FnOnce(&mut Accounts, u64) -> T) -> T {
        let result = {
            let mut state = self.state();
            change(&mut state.accounts, now_ms())
        };
        self.persist_accounts();
        self.changed();
        result
    }

    pub fn read_accounts<T>(&self, read: impl FnOnce(&Accounts) -> T) -> T {
        read(&self.state().accounts)
    }

    // ----- the run -----

    pub fn running(&self) -> bool {
        self.state().run.as_ref().is_some_and(|r| r.running)
    }

    /// Loads the project's saved queue, recovers it after a crash, adds the wanted scenes and (unless
    /// `paused`) starts working.
    pub fn start(&self, project_dir: &Path, wanted: Vec<NewJob>, force: bool, start_now: bool) -> Result<AddReport, AppError> {
        let now = now_ms();
        let report;
        {
            let mut state = self.state();
            if let Some(run) = &state.run {
                if run.dir != project_dir && run.queue.jobs.iter().any(|j| j.status == Status::Generating) {
                    return Err(AppError::new("Pictures for another project are still being made. Please wait or pause that run first.", format!("running: {}", run.dir.display())));
                }
            }
            let same = state.run.as_ref().is_some_and(|r| r.dir == project_dir);
            if !same {
                state.run = Some(Self::load_run(project_dir, now));
            }
            let Some(run) = state.run.as_mut() else { return Err(io_error("The queue could not be opened.", "no run")) };
            report = run.queue.add_jobs(wanted, force, now);
            run.running = start_now;
            Self::save_run(run)?;
        }
        self.save_run_state();
        self.changed();
        Ok(report)
    }

    fn load_run(project_dir: &Path, now: u64) -> Run {
        let mut queue = load_json::<Queue>(&jobs_file(project_dir)).unwrap_or_default();
        let media = project_dir.join("media");
        recovery::recover(&mut queue, &|relative| std::fs::metadata(project_dir.join(relative)).is_ok_and(|m| m.is_file() && m.len() > 0), false, now);
        let _ = save::clean_partial(&media);
        Run { dir: project_dir.to_path_buf(), queue, running: false, storage_error: None, storage_retry_at: 0 }
    }

    fn save_run(run: &Run) -> Result<(), AppError> {
        save_json(&jobs_file(&run.dir), &run.queue).map_err(|e| io_error("The picture list could not be saved in the project folder.", e))
    }

    fn save_run_state(&self) {
        let (dir, running) = {
            let state = self.state();
            match &state.run {
                Some(run) => (Some(run.dir.display().to_string()), run.running),
                None => (None, false),
            }
        };
        let _ = save_json(&run_state_file(&self.inner.dir), &json!({ "projectDir": dir, "running": running }));
    }

    /// After a crash: opens the project that was being worked on and, if it was running, runs it again.
    pub fn resume_after_restart(&self) -> bool {
        let Some(saved) = load_json::<Value>(&run_state_file(&self.inner.dir)) else { return false };
        let (Some(dir), true) = (saved["projectDir"].as_str().map(PathBuf::from), saved["running"] == Value::Bool(true)) else { return false };
        if !dir.join("imagegen").join("jobs.json").exists() {
            return false;
        }
        let now = now_ms();
        {
            let mut state = self.state();
            let mut run = Self::load_run(&dir, now);
            run.running = true;
            let _ = Self::save_run(&run);
            state.run = Some(run);
        }
        self.changed();
        true
    }

    pub fn pause(&self) {
        if let Some(run) = self.state().run.as_mut() {
            run.running = false;
        }
        self.save_run_state();
        self.changed();
    }

    pub fn resume(&self) {
        if let Some(run) = self.state().run.as_mut() {
            run.running = true;
        }
        self.save_run_state();
        self.changed();
    }

    /// Failed scenes (or the given ones) get a fresh start.
    pub fn retry_failed(&self, ids: &[String]) -> usize {
        let count = self.mutate_queue(|queue, now| queue.retry(ids, now));
        if count > 0 {
            self.resume();
        }
        count
    }

    pub fn remove_jobs(&self, ids: &[String]) -> usize {
        self.mutate_queue(|queue, _| queue.remove(ids))
    }

    fn mutate_queue<T: Default>(&self, change: impl FnOnce(&mut Queue, u64) -> T) -> T {
        let result = {
            let mut state = self.state();
            let Some(run) = state.run.as_mut() else { return T::default() };
            let result = change(&mut run.queue, now_ms());
            let _ = Self::save_run(run);
            result
        };
        self.changed();
        result
    }

    // ----- the page's view -----

    pub fn snapshot(&self) -> Snapshot {
        let api_ready_settings = self.settings();
        let api_ready = self.inner.gens.api_ready(&api_ready_settings);
        let now = now_ms();
        let state = self.state();
        let consent_needed = !state.settings.consent_given(state.config.major().unwrap_or(1));
        let (stats, jobs, project_dir, running, storage_error) = match &state.run {
            Some(run) => (
                run.queue.stats(),
                run.queue
                    .jobs
                    .iter()
                    .map(|j| JobView {
                        id: j.id.clone(),
                        order: j.order,
                        file_name: j.file_name.clone(),
                        status: j.status,
                        attempts: j.attempts,
                        account_id: j.account_id.clone(),
                        via: j.via,
                        file: j.file.clone(),
                        error: j.error.clone(),
                        error_kind: j.error_kind,
                        regenerate: j.regenerate,
                        next_attempt_at: j.next_attempt_at,
                    })
                    .collect(),
                Some(run.dir.display().to_string()),
                run.running,
                run.storage_error.clone(),
            ),
            None => (Stats::default(), Vec::new(), None, false, None),
        };
        let summary = state.accounts.summary(now);
        let notice = if running {
            compute_notice(&NoticeInput {
                now,
                queued: stats.queued,
                generating: stats.generating,
                engine: state.settings.engine,
                consent_ok: !consent_needed,
                summary,
                fallback: state.settings.fallback_to_api,
                api_ready,
                next_cooldown_end: state.accounts.next_cooldown_end(now),
                next_retry_at: state.run.as_ref().map_or(0, |r| r.queue.next_ready_at(now)),
                storage_error,
            })
        } else {
            None
        };
        Snapshot {
            project_dir,
            running,
            stats,
            jobs,
            accounts: state.accounts.views(now),
            settings: state.settings.clone(),
            config_version: state.config.config_version.clone(),
            consent_needed,
            api_ready,
            notice,
            now,
        }
    }

    fn changed(&self) {
        let snapshot = self.snapshot();
        self.inner.sink.emit("imagegen-state", serde_json::to_value(&snapshot).unwrap_or(Value::Null));
        self.inner.wake.notify_one();
    }

    // ----- scheduling -----

    /// The heartbeat. Spawn this once at start-up.
    pub async fn run_loop(&self) {
        loop {
            self.dispatch();
            let beat = Duration::from_millis(self.tuning().heartbeat_ms);
            tokio::select! {
                () = self.inner.wake.notified() => {}
                () = tokio::time::sleep(beat) => {}
            }
            // The page also needs to see pauses end (a usage limit that is over): refresh once a beat while working.
            if self.running() {
                let snapshot = self.snapshot();
                self.inner.sink.emit("imagegen-state", serde_json::to_value(&snapshot).unwrap_or(Value::Null));
            }
        }
    }

    /// Starts as many jobs as the limits allow.
    pub fn dispatch(&self) {
        let api_ready = {
            let settings = self.settings();
            self.inner.gens.api_ready(&settings)
        };
        loop {
            let picked = {
                let mut state = self.state();
                Self::pick(&mut state, now_ms(), api_ready)
            };
            let Some(pick) = picked else { return };
            let _ = self.with_run(Self::save_run_quietly);
            let engine = self.clone();
            tokio::spawn(async move {
                match pick {
                    Pick::Free(job, account) => {
                        let settings = engine.settings();
                        let result = engine.inner.gens.free(&account, &job, &settings).await;
                        engine.finish(job, Some(account), result).await;
                    }
                    Pick::Api(job) => {
                        let settings = engine.settings();
                        let result = engine.inner.gens.api(&job, &settings).await;
                        engine.finish(job, None, result).await;
                    }
                }
            });
            self.changed_light();
        }
    }

    fn changed_light(&self) {
        let snapshot = self.snapshot();
        self.inner.sink.emit("imagegen-state", serde_json::to_value(&snapshot).unwrap_or(Value::Null));
    }

    fn with_run<T>(&self, f: impl FnOnce(&mut Run) -> T) -> Option<T> {
        self.state().run.as_mut().map(f)
    }

    fn save_run_quietly(run: &mut Run) {
        let _ = Self::save_run(run);
    }

    fn pick(state: &mut State, now: u64, api_ready: bool) -> Option<Pick> {
        let parallel = state.settings.parallel.clamp(1, 8);
        let (engine, fallback, provider) = (state.settings.engine, state.settings.fallback_to_api, state.settings.api_provider);
        let consent_ok = state.settings.consent_given(state.config.major().unwrap_or(1));
        let max_parallel = state.config.max_parallel;
        let State { accounts, run, api, .. } = state;
        let run = run.as_mut()?;
        if !run.running || run.storage_retry_at > now || run.queue.stats().generating as u32 >= parallel {
            return None;
        }
        let media = run.dir.join("media");
        let busy_targets: HashSet<String> = run.queue.jobs.iter().filter_map(|j| j.target.clone()).collect();
        let taken = |name: &str| busy_targets.contains(name) || media.join(name).exists();

        if engine == Mode::Free && consent_ok {
            if let Some(account) = accounts.claim_slot(now, parallel.min(max_parallel)) {
                match run.queue.claim_next(now, Via::Free, Some(&account), &|j| !j.force_api, &taken) {
                    Some(job) => return Some(Pick::Free(job, account)),
                    None => accounts.release_slot(&account),
                }
            }
        }
        if !api_ready || api.cooldown_until > now {
            return None;
        }
        let summary = accounts.summary(now);
        let free_can_work = engine == Mode::Free && consent_ok && (summary.working > 0 || summary.starting > 0);
        let via = match provider {
            ApiProvider::Gemini => Via::Gemini,
            ApiProvider::Cloudflare => Via::Cloudflare,
        };
        let job = if engine == Mode::Api || (fallback && !free_can_work) {
            run.queue.claim_next(now, via, None, &|_| true, &taken)
        } else if fallback {
            // The accounts work, but a job the free engine gave up on goes to the API.
            run.queue.claim_next(now, via, None, &|j| j.force_api, &taken)
        } else {
            None
        };
        job.map(Pick::Api)
    }

    // ----- results -----

    async fn finish(&self, job: Job, account: Option<String>, result: Picture) {
        let lease = job.lease.clone().unwrap_or_default();
        let outcome = match result {
            Ok(bytes) => self.store_picture(&job, &lease, bytes).await,
            Err(error) => Err(error),
        };
        match outcome {
            Ok(()) => {}
            Err(error) => self.handle_error(&job, &lease, account.as_deref(), error).await,
        }
        if let Some(account) = &account {
            self.state().accounts.release_slot(account);
        }
        self.changed();
    }

    /// Saves the picture and marks the job completed. Errors here are saving problems, not generation problems.
    async fn store_picture(&self, job: &Job, lease: &str, bytes: Vec<u8>) -> Result<(), GenError> {
        let (dir, valid) = {
            let state = self.state();
            match &state.run {
                Some(run) => (run.dir.clone(), run.queue.is_lease_valid(&job.id, lease)),
                None => return Ok(()),
            }
        };
        if !valid {
            return Ok(());
        }
        let media = dir.join("media");
        let png = save::normalize(bytes, &job.aspect, &self.inner.dir.join("work")).await.map_err(|e| GenError::new(ErrorKind::NoImage, e))?;
        let mut target = job.target.clone().unwrap_or_else(|| job.file_name.clone());
        let saved = loop {
            match save::save_new(&media, &target, &png) {
                Ok(saved) => break saved,
                Err(SaveError::Taken) => {
                    // Someone made a different file with this name since the job started: use the next free name.
                    let next = super::queue::unique_target(&job.file_name, &|name| media.join(name).exists());
                    if next == target {
                        return Err(GenError::new(ErrorKind::Unknown, "No free file name could be found."));
                    }
                    target = next;
                }
                Err(SaveError::Io(message)) => return Err(storage_error(&message)),
            }
        };
        let (width, height) = save::png_size(&png).unwrap_or((0, 0));
        let relative = format!("media/{target}");
        let now = now_ms();
        let completed = {
            let mut state = self.state();
            let Some(run) = state.run.as_mut() else { return Ok(()) };
            run.storage_error = None;
            let done = run.queue.complete(&job.id, lease, &relative, now);
            let regenerated = job.regenerate;
            if done {
                let _ = Self::save_run(run);
            }
            done.then_some(regenerated)
        };
        if let Some(account) = &job.account_id {
            self.state().accounts.mark_success(account);
            self.persist_accounts();
        }
        if let Some(regenerated) = completed {
            let modified = std::fs::metadata(media.join(&target)).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
            self.inner.sink.emit(
                "imagegen-image",
                json!({ "projectDir": dir.display().to_string(), "sceneId": job.id, "path": relative, "name": target, "width": width, "height": height, "modified": modified, "regenerated": regenerated, "alreadySaved": saved == Saved::Same }),
            );
        }
        Ok(())
    }

    async fn handle_error(&self, job: &Job, lease: &str, account: Option<&str>, error: GenError) {
        let now = now_ms();
        let tuning = self.tuning();
        let max_attempts = self.settings().max_attempts;
        let fallback_ready = {
            let settings = self.settings();
            settings.fallback_to_api && job.via == Some(Via::Free) && self.inner.gens.api_ready(&settings)
        };
        // Access in hidden mode: the account may only be refused in a hidden browser. Try a minimized window once.
        let mut switched = false;
        if error.kind == ErrorKind::Access {
            if let Some(account) = account {
                switched = self.inner.gens.switch_to_window(account).await;
            }
        }
        let mut state = self.state();
        if switched {
            state.settings.browser_mode = super::settings::BrowserMode::Window;
            state.settings.browser_note = "Google did not accept the hidden browser, so the browser now runs in a minimized window.".to_string();
        }
        let State { accounts, run, api, .. } = &mut *state;
        let Some(run) = run.as_mut() else { return };
        let mut options = RequeueOptions { error: error.message.clone(), error_kind: Some(error.kind), ..RequeueOptions::default() };
        let mut fail = false;
        match error.kind {
            ErrorKind::RateLimit => match account {
                Some(id) => {
                    accounts.limit_pause(id, "Usage limit reached", error.retry_after_ms, now);
                }
                None => {
                    api.level = (api.level + 1).min(6);
                    let minutes = [1u64, 2, 4, 8, 16, 30][(api.level - 1) as usize];
                    api.cooldown_until = now + (minutes * 60_000).max(error.retry_after_ms);
                }
            },
            ErrorKind::Auth => match account {
                Some(id) => accounts.mark_auth_error(id, &error.message),
                None => {
                    api.cooldown_until = now + 10 * 60_000;
                    fail = true;
                }
            },
            ErrorKind::Access => match account {
                Some(id) if switched => {
                    // Nothing wrong with the account yet: the job waits a second and runs in the new window.
                    accounts.cooldown(id, "Trying a minimized window", Some(1_000), now);
                }
                Some(id) => {
                    accounts.set_verified(id, Some(false), &error.message);
                    accounts.set_last_error(id, &error.message);
                }
                None => fail = true,
            },
            ErrorKind::Flagged => {
                if let Some(id) = account {
                    accounts.mark_flagged(id, &error.message, now);
                }
            }
            ErrorKind::Session => {
                if let Some(id) = account {
                    accounts.cooldown(id, "Browser problem", Some(tuning.session_cooldown_ms), now);
                }
            }
            ErrorKind::Network => match account {
                Some(id) => {
                    accounts.cooldown(id, "Connection problem", None, now);
                }
                None => api.cooldown_until = now + 10_000,
            },
            ErrorKind::Aborted => {}
            ErrorKind::Storage => {
                // The folder cannot be written (missing, read-only, full): nothing is started for a while.
                run.storage_error = Some(error.message.clone());
                run.storage_retry_at = now + tuning.storage_retry_ms;
            }
            ErrorKind::Blocked | ErrorKind::BadRequest => fail = true,
            ErrorKind::Timeout | ErrorKind::NoImage | ErrorKind::Server | ErrorKind::Unknown => {
                if let Some(id) = account {
                    accounts.mark_failure(id, &error.message);
                }
                let used = job.attempts + 1;
                if used >= max_attempts && fallback_ready {
                    // The free engine gave up: the API gets this one, with a fresh count.
                    options.force_api = true;
                } else {
                    options.count_attempt = true;
                    options.max_attempts = Some(max_attempts);
                    let wait = tuning.retry_base_ms.saturating_mul(1u64 << (used - 1).min(10));
                    options.delay_ms = wait.min(tuning.retry_max_ms);
                }
            }
        }
        if let Some(id) = account {
            if matches!(error.kind, ErrorKind::Auth | ErrorKind::Flagged | ErrorKind::Access) {
                accounts.set_last_error(id, &error.message);
            }
        }
        if fail {
            run.queue.fail(&job.id, lease, error.message.clone(), Some(error.kind), now);
        } else {
            // `Failed` here means the attempts ran out: the job shows the error and waits for "Retry".
            let _: Requeued = run.queue.requeue(&job.id, lease, options, now);
        }
        let _ = Self::save_run(run);
        drop(state);
        if switched {
            self.persist_settings();
        }
        self.persist_accounts();
    }
}

fn storage_error(message: &str) -> GenError {
    GenError::new(ErrorKind::Storage, format!("{message}"))
}
