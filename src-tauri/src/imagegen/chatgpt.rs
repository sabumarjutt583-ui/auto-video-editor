//! ChatGPT's chat page, used ONLY to study reference pictures for a custom style.
//!
//! It works like the script writer's Claude chat (a browser profile of its own, a sign-in
//! window the person uses himself, one fresh chat per question), but it is separate: it needs
//! no OpenAI API key and the person's ChatGPT sign-in lives only in `chatgpt/profiles/<id>/`
//! of the app data folder. The app never sees a password.
//!
//! Using a chat page like this may not be allowed by the service's terms. The person is told
//! so and accepts that notice before anything runs (`accept_consent`); the app does not hide
//! or disguise anything, and a page that needs a person (captcha, unusual activity, sign-in)
//! is never worked around: it becomes an error that pauses the account.
//!
//! SELECTORS ARE UNVERIFIED (2026-10-28): the defaults in `ChatConfig::chatgpt` are
//! best-known ChatGPT identifiers only and have never been checked against a live signed-in
//! ChatGPT session from this VM (no ChatGPT account here). A page change is fixed by a
//! settings/config update, not a new app version.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::Notify;

use super::browser::session::{Launch, Mode, Session};
use super::browser::signin::{PlainWindow, WindowState};
use super::chat::{self, ChatReply};
use super::config::EngineConfig;
use super::errors::{ErrorKind, GenError};
use crate::logging;

const LOG: &str = "chatgpt";
/// How long a ChatGPT usage limit is respected when the page does not say when it ends.
const LIMIT_REST_MS: u64 = 60 * 60 * 1000;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Saved {
    consent: bool,
    connected: bool,
    last_error: String,
    limited_until: u64,
}

/// What the Settings card shows.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptStatus {
    pub consent: bool,
    pub connected: bool,
    pub signing_in: bool,
    pub busy: bool,
    /// Epoch milliseconds until which the account rests after a usage limit (0 = not resting).
    pub limited_until: u64,
    pub last_error: String,
}

/// How the browser is started (taken from the image engine settings).
pub type BrowserChoice = super::script_chat::BrowserChoice;

pub struct ChatGptChat {
    dir: PathBuf,
    saved: Mutex<Saved>,
    transient: Mutex<(bool, bool)>,
    waiter: Notify,
    /// One question at a time (and no question while the sign-in window is open).
    turn: tokio::sync::Mutex<()>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

/// The engine settings with ChatGPT's chat page in the place of Gemini's.
pub fn engine_for_chatgpt(config: &EngineConfig) -> EngineConfig {
    let mut engine = config.clone();
    engine.chat = config.chatgpt.clone();
    engine
}

/// The shared chat code speaks of "Gemini"; for this page it is ChatGPT.
fn rename(mut error: GenError) -> GenError {
    error.message = error
        .message
        .replace("Gemini's", "ChatGPT's")
        .replace("Gemini", "ChatGPT")
        .replace("Google account", "ChatGPT account");
    error
}

impl ChatGptChat {
    pub fn new(dir: PathBuf) -> Self {
        let saved = std::fs::read_to_string(dir.join("state.json"))
            .ok()
            .and_then(|t| serde_json::from_str::<Saved>(&t).ok())
            .unwrap_or_default();
        Self { dir, saved: Mutex::new(saved), transient: Mutex::new((false, false)), waiter: Notify::new(), turn: tokio::sync::Mutex::new(()) }
    }

    pub fn profile_dir(&self) -> PathBuf {
        self.dir.join("profile")
    }

    fn update(&self, change: impl FnOnce(&mut Saved)) {
        let snapshot = {
            let mut saved = lock(&self.saved);
            change(&mut saved);
            saved.clone()
        };
        if std::fs::create_dir_all(&self.dir).is_ok() {
            if let Ok(text) = serde_json::to_string_pretty(&snapshot) {
                let _ = std::fs::write(self.dir.join("state.json"), text);
            }
        }
    }

    pub fn status(&self) -> ChatGptStatus {
        let saved = lock(&self.saved).clone();
        let (signing_in, busy) = *lock(&self.transient);
        let now = super::engine::now_ms();
        ChatGptStatus { consent: saved.consent, connected: saved.connected, signing_in, busy, limited_until: if saved.limited_until > now { saved.limited_until } else { 0 }, last_error: saved.last_error }
    }

    fn set_transient(&self, change: impl FnOnce(&mut (bool, bool))) {
        change(&mut lock(&self.transient));
    }

    pub fn accept_consent(&self) {
        self.update(|s| s.consent = true);
    }

    /// Sets the time until which this account rests after a usage limit (0 = ready again).
    /// Used by the person to say when the account is back online; persisted in state.json.
    pub fn set_limited_until(&self, until_ms: u64) {
        self.update(|s| s.limited_until = until_ms);
    }

    fn require_consent(&self) -> Result<(), GenError> {
        if lock(&self.saved).consent {
            Ok(())
        } else {
            Err(GenError::new(ErrorKind::BadRequest, "Please read and accept the notice about ChatGPT accounts first (Settings, ChatGPT accounts)."))
        }
    }

    /// The person pressed "I have signed in".
    pub fn confirm_signed_in(&self) {
        self.waiter.notify_one();
    }

    /// Forgets the sign-in: the profile folder is deleted.
    pub fn disconnect(&self) {
        let _ = std::fs::remove_dir_all(self.profile_dir());
        self.update(|s| {
            s.connected = false;
            s.last_error.clear();
            s.limited_until = 0;
        });
    }

    /// Opens the person's own browser on ChatGPT's sign-in page. When the window is closed
    /// (or "I have signed in" is pressed) the page is checked in the background.
    pub async fn sign_in(&self, browser: &BrowserChoice, config: &EngineConfig) -> Result<(), GenError> {
        self.require_consent()?;
        let _turn = self.turn.lock().await;
        self.set_transient(|t| t.0 = true);
        let result = self.run_sign_in_window(&browser.exe, config).await;
        self.set_transient(|t| t.0 = false);
        result?;
        self.check_inner(browser, config).await
    }

    async fn run_sign_in_window(&self, exe: &Path, config: &EngineConfig) -> Result<(), GenError> {
        let mut window = PlainWindow::open(exe, &self.profile_dir(), &config.chatgpt.login_url).await.map_err(|e| GenError::new(ErrorKind::Session, e))?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(15 * 60);
        loop {
            match window.state() {
                WindowState::Closed => return Ok(()),
                WindowState::EndedAtOnce => {
                    return Err(GenError::new(ErrorKind::Session, "The browser closed right away. The ChatGPT sign-in may already be open in another window. Please close it and try again."))
                }
                WindowState::Open => {}
            }
            if tokio::time::Instant::now() > deadline {
                window.close_politely();
                return Err(GenError::new(ErrorKind::Timeout, "Sign-in took too long, so the window was closed. Please try again."));
            }
            if tokio::time::timeout(Duration::from_millis(1500), self.waiter.notified()).await.is_ok() {
                window.close_politely();
                window.wait_closed(Duration::from_secs(10)).await;
                return Ok(());
            }
        }
    }

    /// Checks (in the background browser) that ChatGPT's message box is there, that is: the sign-in works.
    pub async fn check(&self, browser: &BrowserChoice, config: &EngineConfig) -> Result<(), GenError> {
        self.require_consent()?;
        let _turn = self.turn.lock().await;
        self.check_inner(browser, config).await
    }

    async fn check_inner(&self, browser: &BrowserChoice, config: &EngineConfig) -> Result<(), GenError> {
        let engine = engine_for_chatgpt(config);
        let result = match self.open_browser(browser).await {
            Ok(session) => {
                let found = match session.open_tab().await {
                    Ok(tab) => {
                        let found = Self::signed_in_on(&session, &tab, &engine).await;
                        session.close_tab(&tab).await;
                        found
                    }
                    Err(e) => Err(chat::from_cdp(&e, "Opening the ChatGPT page")),
                };
                session.stop().await;
                found
            }
            Err(error) => Err(error),
        };
        match result {
            Ok(()) => {
                self.update(|s| {
                    s.connected = true;
                    s.last_error.clear();
                });
                logging::info(LOG, "ChatGPT sign-in works");
                Ok(())
            }
            Err(error) => {
                let error = rename(error);
                self.update(|s| {
                    s.connected = false;
                    s.last_error = error.message.clone();
                });
                logging::warn(LOG, &format!("ChatGPT check failed ({:?}): {}", error.kind, error.message));
                Err(error)
            }
        }
    }

    async fn signed_in_on(session: &Session, tab: &super::browser::session::Tab, engine: &EngineConfig) -> Result<(), GenError> {
        let chat = &engine.chat;
        session.navigate_tab(tab, &chat.url, Duration::from_millis(chat.timing.page_ready_ms)).await.map_err(|e| chat::from_cdp(&e, "Opening the ChatGPT page"))?;
        let deadline = tokio::time::Instant::now() + Duration::from_millis(chat.timing.page_ready_ms);
        let probe = format!("(function () {{ return {{ url: location.href, input: !!document.querySelector({}) }}; }})()", chat::js(&chat.selectors.input));
        loop {
            let value = session.eval_in(&tab.frame, &probe).await.map_err(|e| chat::from_cdp(&e, "Reading the ChatGPT page"))?;
            if value["input"].as_bool() == Some(true) {
                return Ok(());
            }
            let url = value["url"].as_str().unwrap_or_default();
            if url.contains("/auth") || url.contains("/login") || url.contains("/signup") {
                return Err(GenError::new(ErrorKind::Auth, "ChatGPT is signed out. Press Sign in and sign in again."));
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(GenError::new(ErrorKind::PageChanged, "ChatGPT's chat page did not open as expected. It may have changed, or it is asking for a check in a normal window. Press Sign in to look at it."));
            }
            tokio::time::sleep(Duration::from_millis(chat.timing.poll_ms)).await;
        }
    }

    /// Asks one question with pictures: a fresh chat with the prompt and the attached pictures.
    /// Resting after a usage limit is respected, and a signed-out account is reported, not worked around.
    pub async fn ask_with_images(&self, browser: &BrowserChoice, config: &EngineConfig, prompt: &str, images: &[PathBuf], timeout: Duration, progress: chat::Progress<'_>) -> Result<ChatReply, GenError> {
        self.require_consent()?;
        {
            let saved = lock(&self.saved);
            if !saved.connected {
                return Err(GenError::new(ErrorKind::Auth, "ChatGPT is not connected. Open Settings, ChatGPT accounts, and press Sign in."));
            }
            let now = super::engine::now_ms();
            if saved.limited_until > now {
                let minutes = (saved.limited_until - now).div_ceil(60_000).max(1);
                return Err(GenError::new(ErrorKind::RateLimit, format!("ChatGPT says its usage limit is reached. Try again in about {minutes} minute(s).")));
            }
        }
        let _turn = self.turn.lock().await;
        self.set_transient(|t| t.1 = true);
        let engine = engine_for_chatgpt(config);
        let result = match self.open_browser(browser).await {
            Ok(session) => {
                let answer = match session.open_tab().await {
                    Ok(tab) => {
                        let signed = Self::signed_in_on(&session, &tab, &engine).await;
                        session.close_tab(&tab).await;
                        match signed {
                            Ok(()) => chat::ask_full(&session, &engine, prompt, images, timeout, progress).await,
                            Err(error) => Err(error),
                        }
                    }
                    Err(e) => Err(chat::from_cdp(&e, "Opening the ChatGPT page")),
                };
                session.stop().await;
                answer
            }
            Err(error) => Err(error),
        };
        self.set_transient(|t| t.1 = false);
        match result {
            Ok(reply) => {
                self.update(|s| s.last_error.clear());
                Ok(reply)
            }
            Err(error) => {
                let error = rename(error);
                match error.kind {
                    ErrorKind::Auth => self.update(|s| {
                        s.connected = false;
                        s.last_error = error.message.clone();
                    }),
                    ErrorKind::RateLimit => {
                        let rest = if error.retry_after_ms > 0 { error.retry_after_ms } else { LIMIT_REST_MS };
                        self.update(|s| s.limited_until = super::engine::now_ms() + rest);
                    }
                    _ => self.update(|s| s.last_error = error.message.clone()),
                }
                logging::warn(LOG, &format!("ChatGPT question failed ({:?}): {}", error.kind, error.message));
                Err(error)
            }
        }
    }

    /// Opens the background browser on the ChatGPT profile. The caller stops it when done.
    async fn open_browser(&self, browser: &BrowserChoice) -> Result<Session, GenError> {
        let launch = Launch { exe: browser.exe.clone(), profile: self.profile_dir(), mode: browser.mode, extra_args: browser.extra_args.clone() };
        let session = Session::open(&launch).await.map_err(|e| super::errors::classify_browser_error(&e.to_string(), "Starting the browser"))?;
        if browser.mode == Mode::Window {
            let _ = session.minimize().await;
        }
        Ok(session)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_chat() -> ChatGptChat {
        let dir = std::env::temp_dir().join(format!("ave-chatgpt-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        ChatGptChat::new(dir)
    }

    #[test]
    fn engine_for_chatgpt_uses_the_chatgpt_block_not_gemini() {
        let config = EngineConfig::bundled();
        let engine = engine_for_chatgpt(&config);
        assert_eq!(engine.chat.url, "https://chatgpt.com/");
        assert_eq!(engine.chat.selectors.input, "#prompt-textarea");
        assert_ne!(engine.chat.url, config.chat.url);
    }

    #[test]
    fn rename_turns_gemini_words_into_chatgpt_words() {
        let error = rename(GenError::new(ErrorKind::Auth, "Gemini's chat page: this Google account is signed out."));
        assert_eq!(error.message, "ChatGPT's chat page: this ChatGPT account is signed out.");
    }

    #[test]
    fn a_new_chatgpt_account_starts_disconnected_and_not_resting() {
        let chat = temp_chat();
        let status = chat.status();
        assert!(!status.connected);
        assert_eq!(status.limited_until, 0);
        assert!(status.last_error.is_empty());
    }

    #[test]
    fn consent_and_back_online_time_survive_a_reload() {
        let dir = std::env::temp_dir().join(format!("ave-chatgpt-persist-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let chat = ChatGptChat::new(dir.clone());
        chat.accept_consent();
        chat.set_limited_until(9_999_999_999_999);
        let again = ChatGptChat::new(dir);
        assert!(again.status().consent);
        assert_eq!(again.status().limited_until, 9_999_999_999_999);
    }

    #[tokio::test]
    async fn asking_without_consent_fails_before_any_browser_starts() {
        let chat = temp_chat();
        let browser = BrowserChoice { exe: PathBuf::from("/nonexistent-browser"), mode: Mode::Hidden, extra_args: vec![] };
        let config = EngineConfig::bundled();
        let error = chat.ask_with_images(&browser, &config, "hello", &[], Duration::from_secs(60), None).await.unwrap_err();
        assert_eq!(error.kind, ErrorKind::BadRequest);
        assert!(error.message.contains("ChatGPT accounts"));
    }
}
