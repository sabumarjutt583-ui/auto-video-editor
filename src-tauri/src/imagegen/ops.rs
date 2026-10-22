//! What the buttons of the accounts panel do: add, sign in (the person's own browser window),
//! verify, test image, show the background browser, remove. And the glue that owns the engine.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tokio::sync::Notify;

use super::accounts::Phase;
use super::browser::locator;
use super::browser::signin::{PlainWindow, WindowState};
use super::chat::{self, ChatReply};
use super::config::EngineConfig;
use super::engine::{Engine, Generators, Sink};
use super::errors::{ErrorKind, GenError};
use super::real::RealGenerators;
use super::save;
use super::settings::{BrowserMode, ImageGenSettings};
use crate::commands::error::AppError;

pub struct ImageGen {
    pub engine: Engine,
    pub real: Arc<RealGenerators>,
    sign_in_waiters: Mutex<std::collections::HashMap<String, Arc<Notify>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestImage {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
}

pub const TEST_PROMPT: &str = "A single ripe yellow banana on a plain white table, soft studio light, simple photograph";

pub fn to_app_error(error: &GenError) -> AppError {
    AppError::new(error.message.clone(), format!("{:?}", error.kind))
}

impl ImageGen {
    pub fn new(dir: PathBuf, sink: Arc<dyn Sink>, config: EngineConfig) -> Arc<Self> {
        let config = Arc::new(config);
        let real = Arc::new(RealGenerators::new(dir.clone(), config.clone()));
        let engine = Engine::new(dir, real.clone() as Arc<dyn Generators>, sink, (*config).clone());
        Arc::new(Self { engine, real, sign_in_waiters: Mutex::new(std::collections::HashMap::new()) })
    }

    /// Starts the scheduler and the browser clean-up, and resumes a run a crash interrupted.
    pub fn start_background(self: &Arc<Self>) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            this.engine.resume_after_restart();
            let looper = this.engine.clone();
            tauri::async_runtime::spawn(async move { looper.run_loop().await });
            loop {
                tokio::time::sleep(Duration::from_secs(60)).await;
                this.real.close_idle(Duration::from_secs(600)).await;
            }
        });
    }

    pub async fn set_config(&self, config: EngineConfig) {
        let config = Arc::new(config);
        self.engine.set_config((*config).clone());
        self.real.set_config(config).await;
    }

    pub async fn set_settings(&self, settings: ImageGenSettings) -> Result<(), AppError> {
        let before = self.engine.settings();
        self.engine.set_settings(settings)?;
        let after = self.engine.settings();
        if before.browser_mode != after.browser_mode || before.browser_path != after.browser_path {
            self.real.close_all().await;
        }
        Ok(())
    }

    /// The browser program used for private jobs that need no account (motion graphics).
    pub fn browser_exe(&self) -> Result<PathBuf, AppError> {
        let settings = self.engine.settings();
        crate::imagegen::browser::locator::find(Some(&settings.browser_path)).ok_or_else(|| AppError::new("No Chrome, Edge, Brave or Chromium browser was found. Please install one (Chrome is best) or choose a browser in Settings.", "browser not found"))
    }

    /// Extra browser switches (tests only).
    pub fn browser_args(&self) -> Vec<String> {
        self.real.extra_args.clone()
    }

    /// Asks Gemini's chat one question with the next free Google account. Accounts that hit a limit rest
    /// and the question moves on to the next one, so several accounts share the work.
    pub async fn chat_ask(&self, prompt: &str) -> Result<ChatReply, AppError> {
        self.chat_ask_images(prompt, &[]).await
    }

    /// Like `chat_ask`, with pictures (files on this computer) uploaded into the question.
    pub async fn chat_ask_images(&self, prompt: &str, images: &[std::path::PathBuf]) -> Result<ChatReply, AppError> {
        self.chat_ask_progress(prompt, images, None).await
    }

    /// Like `chat_ask_images`, and reports what Gemini is doing ("Gemini is thinking... 42 s").
    pub async fn chat_ask_progress(&self, prompt: &str, images: &[std::path::PathBuf], progress: chat::Progress<'_>) -> Result<ChatReply, AppError> {
        let settings = self.engine.settings();
        let config = self.engine.config();
        if !settings.consent_given(config.major().unwrap_or(1)) {
            return Err(AppError::new("Please read and accept the Google account notice first (Settings, Image Generator).", "consent not accepted"));
        }
        let timeout = Duration::from_secs(u64::from(settings.timeout_sec).max(120));
        let attempts = self.engine.read_accounts(|accounts| accounts.file.accounts.len()).max(1);
        let mut last: Option<GenError> = None;
        for _ in 0..attempts {
            let Some(id) = self.engine.with_accounts(|accounts, now| accounts.claim_chat(now)) else { break };
            let result = match self.real.worker(&id, &settings) {
                Ok(worker) => worker.chat_with(prompt, images, timeout, progress).await,
                Err(error) => Err(error),
            };
            let error = match result {
                Ok(reply) => {
                    self.engine.with_accounts(|accounts, _| accounts.release_chat(&id, true));
                    return Ok(reply);
                }
                Err(error) => error,
            };
            self.engine.with_accounts(|accounts, now| {
                accounts.release_chat(&id, false);
                match error.kind {
                    ErrorKind::RateLimit => {
                        accounts.chat_limit(&id, now);
                    }
                    ErrorKind::Auth => accounts.mark_auth_error(&id, &error.message),
                    ErrorKind::Flagged => accounts.mark_flagged(&id, &error.message, now),
                    _ => {}
                }
            });
            if matches!(error.kind, ErrorKind::RateLimit | ErrorKind::Auth | ErrorKind::Flagged | ErrorKind::Session | ErrorKind::Network | ErrorKind::Aborted) {
                last = Some(error);
            } else {
                return Err(to_app_error(&error));
            }
        }
        if let Some(error) = last {
            return Err(to_app_error(&error));
        }
        let wait = self.engine.read_accounts(|accounts| accounts.next_chat_end(super::engine::now_ms()));
        if wait > 0 {
            let minutes = wait.saturating_sub(super::engine::now_ms()).div_ceil(60_000).max(1);
            return Err(AppError::new(format!("Every Google account is resting after a usage limit. Try again in about {minutes} minute(s)."), "chat limit"));
        }
        Err(AppError::new("No Google account is ready. Add one in Settings, Google accounts, and press Sign in.", "no account for chat"))
    }

    pub fn add_account(&self, name: &str) -> String {
        self.engine.with_accounts(|accounts, now| accounts.add(name, now))
    }

    pub async fn remove_account(&self, id: &str) -> Result<(), AppError> {
        self.real.close_worker(id).await;
        let removed = self.engine.with_accounts(|accounts, _| accounts.remove(id));
        if removed {
            // Only the folder of this account inside our own profiles folder is deleted.
            let profile = self.real.profile_dir(id);
            if profile.starts_with(self.engine.data_dir().join("profiles")) && profile.is_dir() {
                let _ = std::fs::remove_dir_all(&profile);
            }
        }
        Ok(())
    }

    fn require_consent(&self) -> Result<(), AppError> {
        let settings = self.engine.settings();
        let major = self.engine.config().major().unwrap_or(1);
        if settings.consent_given(major) {
            Ok(())
        } else {
            Err(AppError::new("Please read and accept the notice about the free engine first.", "consent missing"))
        }
    }

    fn set_phase(&self, id: &str, phase: Option<Phase>) {
        self.engine.with_accounts(|accounts, _| accounts.set_phase(id, phase));
    }

    /// Opens the person's browser on Google's sign-in page. Returns when the window is closed
    /// (by the person, or by us once Gemini shows) and the account was verified.
    pub async fn sign_in(&self, id: &str) -> Result<(), AppError> {
        self.require_consent()?;
        if self.engine.read_accounts(|a| a.get(id).is_none()) {
            return Err(AppError::new("That account does not exist any more.", id));
        }
        let settings = self.engine.settings();
        let config = self.engine.config();
        let exe = locator::find(Some(&settings.browser_path)).ok_or_else(|| AppError::new("No Chrome, Edge, Brave or Chromium browser was found. Please install one (Chrome is best) or choose a browser in Settings.", "no browser"))?;
        self.set_phase(id, Some(Phase::SigningIn));
        // A profile can be open only once: the background browser of this account is closed first.
        self.real.close_worker(id).await;
        let waiter = Arc::new(Notify::new());
        self.sign_in_waiters.lock().unwrap_or_else(|e| e.into_inner()).insert(id.to_string(), waiter.clone());
        let result = self.run_sign_in_window(&exe, id, &config, &waiter).await;
        self.sign_in_waiters.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
        if let Err(error) = result {
            self.set_phase(id, None);
            return Err(error);
        }
        self.verify(id).await
    }

    async fn run_sign_in_window(&self, exe: &std::path::Path, id: &str, config: &EngineConfig, waiter: &Notify) -> Result<(), AppError> {
        let mut window = PlainWindow::open(exe, &self.real.profile_dir(id), &config.sign_in_address()).await.map_err(|e| AppError::new("The browser could not be started.", e))?;
        let settle = Duration::from_millis(config.timing.signed_in_settle_ms);
        let mut signed_in_since: Option<tokio::time::Instant> = None;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(15 * 60);
        loop {
            match window.state() {
                WindowState::Closed => return Ok(()),
                WindowState::EndedAtOnce => {
                    return Err(AppError::new("The browser closed right away. This account may already be open in another window. Please close it and try again.", "browser exited within 2.5 s"));
                }
                WindowState::Open => {}
            }
            if tokio::time::Instant::now() > deadline {
                window.close_politely();
                return Err(AppError::new("Sign-in took too long, so the window was closed. Please try again.", "15 minute limit"));
            }
            if let Some(title) = window.title() {
                if config.title_says_signed_in(&title) {
                    let since = *signed_in_since.get_or_insert_with(tokio::time::Instant::now);
                    if since.elapsed() >= settle {
                        window.close_politely();
                        window.wait_closed(Duration::from_secs(10)).await;
                        return Ok(());
                    }
                } else {
                    signed_in_since = None;
                }
            }
            // "I have signed in" pressed: close politely and carry on.
            if tokio::time::timeout(Duration::from_millis(1500), waiter.notified()).await.is_ok() {
                window.close_politely();
                window.wait_closed(Duration::from_secs(10)).await;
                return Ok(());
            }
        }
    }

    /// The person pressed "I have signed in" (non-Windows systems cannot see the window title).
    pub fn finish_sign_in(&self, id: &str) {
        if let Some(waiter) = self.sign_in_waiters.lock().unwrap_or_else(|e| e.into_inner()).get(id) {
            waiter.notify_one();
        }
    }

    /// Checks that the account is signed in and can open the image tool. Generates nothing.
    pub async fn verify(&self, id: &str) -> Result<(), AppError> {
        self.require_consent()?;
        self.set_phase(id, Some(Phase::Checking));
        let outcome = self.verify_inner(id).await;
        self.set_phase(id, None);
        outcome.map_err(|e| to_app_error(&e))
    }

    async fn verify_inner(&self, id: &str) -> Result<(), GenError> {
        let settings = self.engine.settings();
        let worker = self.real.worker(id, &settings)?;
        let mut result = worker.ensure_ready().await;
        // Google may accept a normal (minimized) window although it does not accept the hidden one.
        if matches!(&result, Err(e) if matches!(e.kind, ErrorKind::Access | ErrorKind::Auth)) && worker.switch_to_window().await {
            let retry = worker.ensure_ready().await;
            if retry.is_ok() {
                let mut changed = self.engine.settings();
                changed.browser_mode = BrowserMode::Window;
                changed.browser_note = "Google did not accept the hidden browser for this account, so the browser now runs in a minimized window.".to_string();
                self.engine.set_settings(changed).ok();
            }
            result = retry;
        }
        match result {
            Ok(email) => {
                let duplicate = self.engine.read_accounts(|a| a.find_by_email(&email, id).map(|d| d.name.clone()));
                self.engine.with_accounts(|accounts, _| {
                    accounts.set_connected(id, &email);
                    match &duplicate {
                        Some(name) => accounts.set_verified(id, Some(false), &format!("This Google account is already added as \"{name}\". Remove one of them.")),
                        None => accounts.set_verified(id, Some(true), ""),
                    }
                });
                Ok(())
            }
            Err(error) => {
                self.apply_account_error(id, &error);
                worker.close().await;
                Err(error)
            }
        }
    }

    /// What an error means for the account (used by Verify and Test image; jobs use the scheduler).
    fn apply_account_error(&self, id: &str, error: &GenError) {
        self.engine.with_accounts(|accounts, now| match error.kind {
            ErrorKind::Auth => accounts.mark_auth_error(id, &error.message),
            ErrorKind::Access => accounts.set_verified(id, Some(false), &error.message),
            ErrorKind::Flagged => accounts.mark_flagged(id, &error.message, now),
            ErrorKind::RateLimit => {
                accounts.limit_pause(id, "Usage limit reached", error.retry_after_ms, now);
            }
            _ => accounts.set_last_error(id, &error.message),
        });
    }

    /// One real picture with a fixed prompt, to see that the account works. Not saved in any project.
    pub async fn test_image(&self, id: &str) -> Result<TestImage, AppError> {
        self.require_consent()?;
        self.set_phase(id, Some(Phase::Testing));
        let settings = self.engine.settings();
        let outcome = match self.real.worker(id, &settings) {
            Ok(worker) => worker.generate(TEST_PROMPT, "16:9", 1, Duration::from_secs(180)).await,
            Err(error) => Err(error),
        };
        self.set_phase(id, None);
        match outcome {
            Ok(bytes) => {
                let (width, height) = save::png_size(&bytes).unwrap_or((0, 0));
                let mime = match save::sniff(&bytes) {
                    Some(save::Format::Jpeg) => "image/jpeg",
                    Some(save::Format::Webp) => "image/webp",
                    _ => "image/png",
                };
                self.engine.with_accounts(|accounts, _| accounts.mark_success(id));
                Ok(TestImage { data_url: format!("data:{mime};base64,{}", crate::api::base64::encode(&bytes)), width, height })
            }
            Err(error) => {
                self.apply_account_error(id, &error);
                Err(to_app_error(&error))
            }
        }
    }

    /// A snapshot of the background browser as a `data:` URL, or `None` when no browser is open.
    pub async fn background_snapshot(&self, id: &str) -> Option<String> {
        let bytes = self.real.existing_worker(id)?.snapshot().await?;
        Some(format!("data:image/jpeg;base64,{}", crate::api::base64::encode(&bytes)))
    }

    pub async fn show_background_browser(&self, id: &str) -> bool {
        match self.real.existing_worker(id) {
            Some(worker) => worker.show_window().await,
            None => false,
        }
    }
}
