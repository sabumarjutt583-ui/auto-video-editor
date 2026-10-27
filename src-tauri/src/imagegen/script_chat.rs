//! The script writer: a chat page of the person's own Claude account, used ONLY to write scripts.
//!
//! It works like the Gemini chat (a browser profile of its own, a sign-in window the person uses,
//! one fresh chat per question), but it is separate: it needs no Google account and the person's Claude
//! sign-in lives only in `claude/profile` of the app data folder. The app never sees a password.
//!
//! Using a chat page like this may not be allowed by the service's terms. The person is told so and
//! accepts that notice before anything runs (`accept_consent`); the app does not hide or disguise anything,
//! and a page that needs a person (captcha, unusual activity, sign-in) is never worked around.

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

const LOG: &str = "script";
/// How long a Claude usage limit is respected when the page does not say when it ends.
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
pub struct ScriptStatus {
    pub consent: bool,
    pub connected: bool,
    pub signing_in: bool,
    pub busy: bool,
    /// Epoch milliseconds until which the account rests after a usage limit (0 = not resting).
    pub limited_until: u64,
    pub last_error: String,
}

/// How the browser is started (taken from the image engine settings).
#[derive(Debug, Clone)]
pub struct BrowserChoice {
    pub exe: PathBuf,
    pub mode: Mode,
    pub extra_args: Vec<String>,
}

pub struct ScriptChat {
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

/// The engine settings with the script writer's chat page in the place of Gemini's.
pub fn engine_for_script(config: &EngineConfig) -> EngineConfig {
    let mut engine = config.clone();
    engine.chat = config.script.clone();
    engine
}

/// The shared chat code speaks of "Gemini"; for this page it is Claude.
fn rename(mut error: GenError) -> GenError {
    error.message = error.message.replace("Gemini's", "Claude's").replace("Gemini", "Claude").replace("Google account", "Claude account");
    error
}

impl ScriptChat {
    pub fn new(dir: PathBuf) -> Self {
        let saved = std::fs::read_to_string(dir.join("state.json")).ok().and_then(|t| serde_json::from_str::<Saved>(&t).ok()).unwrap_or_default();
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

    pub fn status(&self) -> ScriptStatus {
        let saved = lock(&self.saved).clone();
        let (signing_in, busy) = *lock(&self.transient);
        let now = super::engine::now_ms();
        ScriptStatus { consent: saved.consent, connected: saved.connected, signing_in, busy, limited_until: if saved.limited_until > now { saved.limited_until } else { 0 }, last_error: saved.last_error }
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
            Err(GenError::new(ErrorKind::BadRequest, "Please read and accept the notice about the script writer first (Settings, Script writer)."))
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

    /// Opens the person's own browser on Claude's sign-in page. When the window is closed (or "I have signed in" is pressed)
    /// the page is checked in the background.
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
        let mut window = PlainWindow::open(exe, &self.profile_dir(), &config.script.login_url).await.map_err(|e| GenError::new(ErrorKind::Session, e))?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(15 * 60);
        loop {
            match window.state() {
                WindowState::Closed => return Ok(()),
                WindowState::EndedAtOnce => return Err(GenError::new(ErrorKind::Session, "The browser closed right away. The Claude sign-in may already be open in another window. Please close it and try again.")),
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

    /// Checks (in the background browser) that Claude's message box is there, that is: the sign-in works.
    pub async fn check(&self, browser: &BrowserChoice, config: &EngineConfig) -> Result<(), GenError> {
        self.require_consent()?;
        let _turn = self.turn.lock().await;
        self.check_inner(browser, config).await
    }

    async fn check_inner(&self, browser: &BrowserChoice, config: &EngineConfig) -> Result<(), GenError> {
        let engine = engine_for_script(config);
        let result = match self.open_browser(browser).await {
            Ok(session) => {
                let found = match session.open_tab().await {
                    Ok(tab) => {
                        let found = Self::signed_in_on(&session, &tab, &engine).await;
                        session.close_tab(&tab).await;
                        found
                    }
                    Err(e) => Err(chat::from_cdp(&e, "Opening the Claude page")),
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
                logging::info(LOG, "Claude sign-in works");
                Ok(())
            }
            Err(error) => {
                let error = rename(error);
                self.update(|s| {
                    s.connected = false;
                    s.last_error = error.message.clone();
                });
                logging::warn(LOG, &format!("Claude check failed ({:?}): {}", error.kind, error.message));
                Err(error)
            }
        }
    }

    async fn signed_in_on(session: &Session, tab: &super::browser::session::Tab, engine: &EngineConfig) -> Result<(), GenError> {
        let chat = &engine.chat;
        session.navigate_tab(tab, &chat.url, Duration::from_millis(chat.timing.page_ready_ms)).await.map_err(|e| chat::from_cdp(&e, "Opening the Claude page"))?;
        let deadline = tokio::time::Instant::now() + Duration::from_millis(chat.timing.page_ready_ms);
        let probe = format!("(function () {{ return {{ url: location.href, input: !!document.querySelector({}) }}; }})()", chat::js(&chat.selectors.input));
        loop {
            let value = session.eval_in(&tab.frame, &probe).await.map_err(|e| chat::from_cdp(&e, "Reading the Claude page"))?;
            if value["input"].as_bool() == Some(true) {
                return Ok(());
            }
            let url = value["url"].as_str().unwrap_or_default();
            if url.contains("/login") || url.contains("/logout") || url.contains("/signup") {
                return Err(GenError::new(ErrorKind::Auth, "Claude is signed out. Press Sign in and sign in again."));
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(GenError::new(ErrorKind::PageChanged, "Claude's chat page did not open as expected. It may have changed, or it is asking for a check in a normal window. Press Sign in to look at it."));
            }
            tokio::time::sleep(Duration::from_millis(chat.timing.poll_ms)).await;
        }
    }

    /// Writes one answer: a fresh chat with the prompt. Resting after a usage limit is respected.
    pub async fn ask(&self, browser: &BrowserChoice, config: &EngineConfig, prompt: &str, timeout: Duration, progress: chat::Progress<'_>) -> Result<ChatReply, GenError> {
        self.require_consent()?;
        {
            let saved = lock(&self.saved);
            if !saved.connected {
                return Err(GenError::new(ErrorKind::Auth, "Claude is not connected. Open Settings, Script writer, and press Sign in."));
            }
            let now = super::engine::now_ms();
            if saved.limited_until > now {
                let minutes = (saved.limited_until - now).div_ceil(60_000).max(1);
                return Err(GenError::new(ErrorKind::RateLimit, format!("Claude says its usage limit is reached. Try again in about {minutes} minute(s).")));
            }
        }
        let _turn = self.turn.lock().await;
        self.set_transient(|t| t.1 = true);
        let engine = engine_for_script(config);
        let result = match self.open_browser(browser).await {
            Ok(session) => {
                let answer = match session.open_tab().await {
                    Ok(tab) => {
                        let signed = Self::signed_in_on(&session, &tab, &engine).await;
                        session.close_tab(&tab).await;
                        match signed {
                            Ok(()) => chat::ask_full(&session, &engine, prompt, &[], timeout, progress).await,
                            Err(error) => Err(error),
                        }
                    }
                    Err(e) => Err(chat::from_cdp(&e, "Opening the Claude page")),
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
                logging::warn(LOG, &format!("script question failed ({:?}): {}", error.kind, error.message));
                Err(error)
            }
        }
    }

    /// Opens the background browser on the Claude profile. The caller stops it when done (a script is rare enough that a lingering browser is not worth it).
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
    use crate::imagegen::testserver::{temp_dir, test_args, test_browser};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    const PAGE: &str = include_str!("testdata/claude_chat.html");

    /// A local imitation of Claude's page: `/new` is the chat, `/login` has no message box.
    async fn serve() -> u16 {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else { return };
                tokio::spawn(async move {
                    let mut buffer = vec![0u8; 4096];
                    let count = socket.read(&mut buffer).await.unwrap_or(0);
                    let request = String::from_utf8_lossy(&buffer[..count]).to_string();
                    let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let body = if path.starts_with("/login") { "<html><head><title>Log in</title></head><body>Log in to continue</body></html>" } else { PAGE };
                    let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                    let _ = socket.write_all(reply.as_bytes()).await;
                });
            }
        });
        port
    }

    fn setup(name: &str, port: u16, path: &str) -> Option<(ScriptChat, BrowserChoice, EngineConfig, PathBuf)> {
        let exe = test_browser()?;
        let dir = temp_dir(name);
        let chat = ScriptChat::new(dir.clone());
        let mut config = EngineConfig::bundled();
        config.script.url = format!("http://127.0.0.1:{port}{path}");
        config.script.timing.stable_ms = 1500;
        Some((chat, BrowserChoice { exe, mode: Mode::Hidden, extra_args: test_args() }, config, dir))
    }

    #[test]
    fn the_script_writer_uses_its_own_chat_page_not_geminis() {
        let config = EngineConfig::bundled();
        let engine = engine_for_script(&config);
        assert_eq!(engine.chat, config.script);
        assert!(engine.chat.url.contains("claude.ai"));
        assert_ne!(engine.chat.url, config.chat.url);
        assert_eq!(rename(GenError::new(ErrorKind::Auth, "This Google account of Gemini's chat")).message, "This Claude account of Claude's chat");
    }

    #[tokio::test]
    async fn nothing_runs_before_the_notice_is_accepted_or_without_a_sign_in() {
        let dir = temp_dir("script-gate");
        let chat = ScriptChat::new(dir.clone());
        let browser = BrowserChoice { exe: PathBuf::from("/nonexistent"), mode: Mode::Hidden, extra_args: vec![] };
        let config = EngineConfig::bundled();
        let timeout = Duration::from_secs(1);
        assert_eq!(chat.ask(&browser, &config, "x", timeout, None).await.unwrap_err().kind, ErrorKind::BadRequest);
        chat.accept_consent();
        assert!(chat.status().consent && !chat.status().connected);
        assert_eq!(chat.ask(&browser, &config, "x", timeout, None).await.unwrap_err().kind, ErrorKind::Auth);
        // The notice stays accepted after a restart.
        assert!(ScriptChat::new(dir.clone()).status().consent);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn a_script_is_written_in_a_fresh_chat_and_a_signed_out_page_is_noticed() {
        let port = serve().await;
        let Some((chat, browser, config, dir)) = setup("script-ok", port, "/new") else {
            eprintln!("skipped: no Chromium found (set AVE_TEST_CHROME)");
            return;
        };
        chat.accept_consent();
        chat.check(&browser, &config).await.expect("the fake page has a message box");
        assert!(chat.status().connected);
        let reply = chat.ask(&browser, &config, "Write about\na fox", Duration::from_secs(60), None).await.expect("answer");
        assert!(reply.text.starts_with("Script for: Write about"), "{reply:?}");
        assert!(reply.text.ends_with("Second line of the script."), "{reply:?}");

        let (out, _, out_config, _) = setup("script-out", port, "/new?out=1").unwrap();
        out.accept_consent();
        let error = out.check(&browser, &out_config).await.unwrap_err();
        assert_eq!(error.kind, ErrorKind::Auth, "{error:?}");
        assert!(!out.status().connected);
        assert!(out.status().last_error.contains("signed out"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
