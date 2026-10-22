//! One Google account in the free engine: one browser, one work tab, one tool page. Several prompts can
//! be in flight at once (the tool makes `parallel` pictures at the same time); each waits on a "ticket"
//! that a single poller settles by reading the tool's result cards.
//!
//! A job is never lost by a browser problem: the ticket fails with a typed error and the scheduler
//! queues the job again.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use tokio::sync::{oneshot, Mutex};

use super::browser::session::{Frame, Launch, Mode, Session};
use super::chat::{self, ChatReply};
use super::config::EngineConfig;
use super::errors::{classify_browser_error, ErrorKind, GenError};
use super::tool_page::{self, CardStatus};

pub type Picture = Result<Vec<u8>, GenError>;

#[derive(Clone)]
pub struct WorkerConfig {
    pub exe: PathBuf,
    pub profile: PathBuf,
    pub mode: Mode,
    pub extra_args: Vec<String>,
    pub engine: Arc<EngineConfig>,
}

struct Ready {
    session: Arc<Session>,
    frame: Frame,
    email: String,
    /// What was last set in the tool (`parallel`, `ratio`): not set again.
    prepared: Option<(u32, String)>,
}

struct Ticket {
    sender: oneshot::Sender<Picture>,
    deadline: Instant,
    missing_since: Option<Instant>,
}

struct Inner {
    config: StdMutex<WorkerConfig>,
    ready: Mutex<Option<Ready>>,
    open_lock: Mutex<()>,
    submit_lock: Mutex<()>,
    /// One chat question at a time per account (each has its own tab).
    chat_lock: Mutex<()>,
    chat_busy: AtomicU32,
    tickets: StdMutex<HashMap<u32, Ticket>>,
    poller_running: AtomicBool,
    finished_since_clear: AtomicU32,
    last_used: StdMutex<Instant>,
}

#[derive(Clone)]
pub struct FreeWorker {
    inner: Arc<Inner>,
}

impl FreeWorker {
    pub fn new(config: WorkerConfig) -> Self {
        Self {
            inner: Arc::new(Inner {
                config: StdMutex::new(config),
                ready: Mutex::new(None),
                open_lock: Mutex::new(()),
                submit_lock: Mutex::new(()),
                chat_lock: Mutex::new(()),
                chat_busy: AtomicU32::new(0),
                tickets: StdMutex::new(HashMap::new()),
                poller_running: AtomicBool::new(false),
                finished_since_clear: AtomicU32::new(0),
                last_used: StdMutex::new(Instant::now()),
            }),
        }
    }

    fn config(&self) -> WorkerConfig {
        self.inner.config.lock().map(|c| c.clone()).unwrap_or_else(|e| e.into_inner().clone())
    }

    pub fn mode(&self) -> Mode {
        self.config().mode
    }

    pub fn idle_for(&self) -> Duration {
        let busy = self.inner.tickets.lock().map(|t| !t.is_empty()).unwrap_or(false) || self.inner.chat_busy.load(Ordering::SeqCst) > 0;
        if busy {
            return Duration::ZERO;
        }
        self.inner.last_used.lock().map(|t| t.elapsed()).unwrap_or_default()
    }

    fn touch(&self) {
        if let Ok(mut last) = self.inner.last_used.lock() {
            *last = Instant::now();
        }
    }

    /// Opens the browser and the tool page when needed. Returns the account's e-mail.
    pub async fn ensure_ready(&self) -> Result<String, GenError> {
        self.ready().await.map(|(_, _, email)| email)
    }

    async fn ready(&self) -> Result<(Arc<Session>, Frame, String), GenError> {
        let _open = self.inner.open_lock.lock().await;
        {
            let guard = self.inner.ready.lock().await;
            if let Some(ready) = guard.as_ref() {
                if !ready.session.cdp.is_closed() {
                    return Ok((ready.session.clone(), ready.frame.clone(), ready.email.clone()));
                }
            }
        }
        // A browser that died or never started: clear what is left and open a fresh one.
        self.drop_session().await;
        let config = self.config();
        let launch = Launch { exe: config.exe.clone(), profile: config.profile.clone(), mode: config.mode, extra_args: config.extra_args.clone() };
        let session = Session::open(&launch).await.map_err(|e| classify_browser_error(&e.to_string(), "Starting the browser"))?;
        if config.mode == Mode::Window {
            // A normal window, but out of the way.
            let _ = session.minimize().await;
        }
        match tool_page::open_tool(&session, &config.engine).await {
            Ok((frame, email)) => {
                let session = Arc::new(session);
                *self.inner.ready.lock().await = Some(Ready { session: session.clone(), frame: frame.clone(), email: email.clone(), prepared: None });
                self.touch();
                Ok((session, frame, email))
            }
            Err(error) => {
                session.stop().await;
                Err(error)
            }
        }
    }

    async fn drop_session(&self) {
        let old = self.inner.ready.lock().await.take();
        if let Some(ready) = old {
            ready.session.stop().await;
        }
    }

    /// Makes one picture. `parallel` is how many the tool may make at the same time.
    pub async fn generate(&self, prompt: &str, aspect: &str, parallel: u32, timeout: Duration) -> Picture {
        let (session, frame, _) = self.ready().await?;
        let config = self.config();
        let receiver = {
            let _submit = self.inner.submit_lock.lock().await;
            let wanted = (parallel, aspect.to_string());
            let needs_prepare = self.inner.ready.lock().await.as_ref().is_some_and(|r| r.prepared.as_ref() != Some(&wanted));
            if needs_prepare {
                tool_page::prepare(&session, &frame, &config.engine, parallel, aspect).await?;
                if let Some(ready) = self.inner.ready.lock().await.as_mut() {
                    ready.prepared = Some(wanted);
                }
            }
            let number = tool_page::submit(&session, &frame, &config.engine, prompt).await?;
            let (sender, receiver) = oneshot::channel();
            if let Ok(mut tickets) = self.inner.tickets.lock() {
                tickets.insert(number, Ticket { sender, deadline: Instant::now() + timeout, missing_since: None });
            }
            self.touch();
            self.start_poller();
            receiver
        };
        match tokio::time::timeout(timeout + Duration::from_secs(5), receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(GenError::aborted()),
            Err(_) => Err(GenError::new(ErrorKind::Timeout, "The picture took too long.")),
        }
    }

    /// Asks Gemini's chat one question (a fresh chat in an extra tab of this account's browser).
    pub async fn chat(&self, prompt: &str, images: &[std::path::PathBuf], timeout: Duration) -> Result<ChatReply, GenError> {
        self.inner.chat_busy.fetch_add(1, Ordering::SeqCst);
        let result = self.chat_inner(prompt, images, timeout).await;
        self.inner.chat_busy.fetch_sub(1, Ordering::SeqCst);
        self.touch();
        result
    }

    async fn chat_inner(&self, prompt: &str, images: &[std::path::PathBuf], timeout: Duration) -> Result<ChatReply, GenError> {
        let (session, _, _) = self.ready().await?;
        let _turn = self.inner.chat_lock.lock().await;
        chat::ask_with_images(&session, &self.config().engine, prompt, images, timeout).await
    }

    fn start_poller(&self) {
        if !self.inner.poller_running.swap(true, Ordering::SeqCst) {
            let worker = self.clone();
            tokio::spawn(async move { worker.poll_loop().await });
        }
    }

    fn fail_all(&self, error: &GenError) {
        let all: Vec<Ticket> = self.inner.tickets.lock().map(|mut t| t.drain().map(|(_, v)| v).collect()).unwrap_or_default();
        for ticket in all {
            let _ = ticket.sender.send(Err(error.clone()));
        }
    }

    async fn poll_loop(self) {
        loop {
            let config = self.config();
            tokio::time::sleep(Duration::from_millis(config.engine.timing.poll_ms)).await;
            let has_tickets = self.inner.tickets.lock().map(|t| !t.is_empty()).unwrap_or(false);
            if !has_tickets {
                self.inner.poller_running.store(false, Ordering::SeqCst);
                // A ticket may have arrived while we were leaving.
                let again = self.inner.tickets.lock().map(|t| !t.is_empty()).unwrap_or(false);
                if again && !self.inner.poller_running.swap(true, Ordering::SeqCst) {
                    continue;
                }
                self.maybe_clear(&config).await;
                return;
            }
            let ready = {
                let guard = self.inner.ready.lock().await;
                guard.as_ref().map(|r| (r.session.clone(), r.frame.clone()))
            };
            let Some((session, frame)) = ready else {
                self.fail_all(&GenError::new(ErrorKind::Session, "The browser was closed."));
                self.inner.poller_running.store(false, Ordering::SeqCst);
                return;
            };
            match tool_page::poll(&session, &frame, &config.engine).await {
                Ok(cards) => self.settle(&session, &frame, &config, &cards).await,
                Err(error) => {
                    self.fail_all(&error);
                    // The page or the browser is gone: the next job opens a fresh one.
                    self.drop_session().await;
                    self.inner.poller_running.store(false, Ordering::SeqCst);
                    return;
                }
            }
        }
    }

    async fn settle(&self, session: &Session, frame: &Frame, config: &WorkerConfig, cards: &[tool_page::Card]) {
        let numbers: Vec<u32> = self.inner.tickets.lock().map(|t| t.keys().copied().collect()).unwrap_or_default();
        let lost_after = Duration::from_millis(config.engine.timing.lost_card_ms);
        let mut signed_out: Option<bool> = None;
        for number in numbers {
            let card = cards.iter().find(|c| c.number == number);
            let outcome: Option<Picture> = match card {
                Some(card) if card.status == CardStatus::Completed && card.has_image => Some(tool_page::read_image(session, frame, &config.engine, number).await),
                Some(card) if card.status == CardStatus::Failed => {
                    if signed_out.is_none() {
                        signed_out = Some(tool_page::sign_state(session, &config.engine).await.map(|s| !s.signed_in).unwrap_or(false));
                    }
                    Some(Err(tool_page::card_error(&config.engine, card, signed_out.unwrap_or(false))))
                }
                Some(_) => self.reset_missing_and_check_deadline(number),
                None => self.missing_or_expired(number, lost_after),
            };
            let Some(mut outcome) = outcome else { continue };
            if let Err(error) = &outcome {
                if matches!(error.kind, ErrorKind::NoImage | ErrorKind::Unknown | ErrorKind::Timeout | ErrorKind::Session) {
                    if let Some(better) = self.diagnose(session, &config.engine).await {
                        outcome = Err(better);
                    }
                }
            }
            let ticket = self.inner.tickets.lock().ok().and_then(|mut t| t.remove(&number));
            if let Some(ticket) = ticket {
                self.inner.finished_since_clear.fetch_add(1, Ordering::SeqCst);
                let _ = ticket.sender.send(outcome);
            }
        }
    }

    fn reset_missing_and_check_deadline(&self, number: u32) -> Option<Picture> {
        let mut tickets = self.inner.tickets.lock().ok()?;
        let ticket = tickets.get_mut(&number)?;
        ticket.missing_since = None;
        (Instant::now() >= ticket.deadline).then(|| Err(GenError::new(ErrorKind::Timeout, "The picture took too long.")))
    }

    fn missing_or_expired(&self, number: u32, lost_after: Duration) -> Option<Picture> {
        let mut tickets = self.inner.tickets.lock().ok()?;
        let ticket = tickets.get_mut(&number)?;
        if Instant::now() >= ticket.deadline {
            return Some(Err(GenError::new(ErrorKind::Timeout, "The picture took too long.")));
        }
        let since = *ticket.missing_since.get_or_insert_with(Instant::now);
        (since.elapsed() >= lost_after).then(|| Err(GenError::new(ErrorKind::Session, "The tool page lost its list (it was reloaded).")))
    }

    /// When a job failed without a clear reason: is the page asking the person for something?
    async fn diagnose(&self, session: &Session, config: &EngineConfig) -> Option<GenError> {
        let state = tool_page::sign_state(session, config).await.ok()?;
        if let Some(error) = tool_page::human_error(config, &format!("{}\n{}", state.title, state.text)) {
            return Some(error);
        }
        (!state.signed_in && state.sign_in_visible).then(|| GenError::new(ErrorKind::Auth, "This Google account is signed out. Please sign in again."))
    }

    async fn maybe_clear(&self, config: &WorkerConfig) {
        if self.inner.finished_since_clear.load(Ordering::SeqCst) < config.engine.timing.clear_after_tasks {
            return;
        }
        let Ok(_submit) = self.inner.submit_lock.try_lock() else { return };
        let ready = self.inner.ready.lock().await.as_ref().map(|r| (r.session.clone(), r.frame.clone()));
        if let Some((session, frame)) = ready {
            if tool_page::clear_if_idle(&session, &frame, &config.engine).await.unwrap_or(false) {
                self.inner.finished_since_clear.store(0, Ordering::SeqCst);
            }
        }
    }

    /// A JPEG of the work tab ("Show background browser"). `None` when no browser is open.
    pub async fn snapshot(&self) -> Option<Vec<u8>> {
        let session = self.inner.ready.lock().await.as_ref().map(|r| r.session.clone())?;
        session.snapshot().await.ok()
    }

    pub async fn show_window(&self) -> bool {
        let session = self.inner.ready.lock().await.as_ref().map(|r| r.session.clone());
        match session {
            Some(session) => session.show().await.is_ok(),
            None => false,
        }
    }

    /// Closes the browser. Waiting jobs fail with `Aborted` and are queued again by the scheduler.
    pub async fn close(&self) {
        self.fail_all(&GenError::aborted());
        let _open = self.inner.open_lock.lock().await;
        self.drop_session().await;
    }

    /// Hidden mode was refused for this account: use a minimized window from now on. `false` when already so.
    pub async fn switch_to_window(&self) -> bool {
        if self.mode() == Mode::Window {
            return false;
        }
        if let Ok(mut config) = self.inner.config.lock() {
            config.mode = Mode::Window;
        }
        self.close().await;
        true
    }

    #[cfg(test)]
    pub async fn eval_in_tool(&self, expression: &str) -> Option<serde_json::Value> {
        let (session, frame) = self.inner.ready.lock().await.as_ref().map(|r| (r.session.clone(), r.frame.clone()))?;
        session.eval_in(&frame, expression).await.ok()
    }
}
