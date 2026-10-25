//! Text answers from Gemini's normal chat page, through a Google account in the browser.
//!
//! Every question opens a fresh chat in an extra tab (no memory of earlier questions), types the
//! prompt, presses Send and waits until the answer is finished. The page's selectors come from
//! `EngineConfig.chat`, so a changed page is fixed by a settings update, not a new app version.
//!
//! Like the image tool, a page that needs a person (captcha, terms, sign-in) is never worked around:
//! it becomes an error that pauses the account and is shown to the user.

use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};

use super::browser::cdp::CdpError;
use super::browser::session::{Session, Tab};
use super::config::{ChatConfig, EngineConfig};
use super::errors::{classify_browser_error, clip, contains_any, ErrorKind, GenError};
use super::tool_page;
use crate::logging;

const LOG: &str = "webchat";

/// The longest prompt the chat box is given (the page refuses very long text).
pub const MAX_PROMPT_CHARS: usize = 30_000;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ChatReply {
    /// The whole answer as text.
    pub text: String,
    /// The code blocks of the answer, in order, without the ``` lines.
    pub code: Vec<String>,
}

impl ChatReply {
    /// The first code block, or the whole text when the answer has none.
    pub fn first_code_or_text(&self) -> &str {
        self.code.first().map_or(self.text.as_str(), String::as_str)
    }
}

pub(super) fn js(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string())
}

pub(super) fn from_cdp(error: &CdpError, what: &str) -> GenError {
    classify_browser_error(&error.to_string(), what)
}

/// The code blocks of a markdown answer (used when the page gives no code elements).
pub fn code_from_markdown(text: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut current: Option<Vec<&str>> = None;
    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            match current.take() {
                Some(lines) => blocks.push(lines.join("\n")),
                None => current = Some(Vec::new()),
            }
        } else if let Some(lines) = current.as_mut() {
            lines.push(line);
        }
    }
    blocks
}

/// Takes the JSON (or any text) out of an answer: the first code block when there is one, else the text,
/// trimmed to the outermost `{ ... }` or `[ ... ]` when that is what it contains.
pub fn json_from_reply(reply: &ChatReply) -> Option<String> {
    let source = reply.first_code_or_text();
    let start = source.find(['{', '['])?;
    let end = source.rfind(['}', ']'])?;
    (end > start).then(|| source[start..=end].to_string())
}

/// What the chat page looks like right now.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PageState {
    pub answers: u32,
    pub text: String,
    pub code: Vec<String>,
    pub done: bool,
    pub has_input: bool,
    pub page_text: String,
    /// The Stop button is visible: Gemini is generating.
    pub stop_visible: bool,
    /// A thinking / loading indicator is visible.
    pub thinking: bool,
    /// The message box is empty (our message left it).
    pub input_empty: bool,
}

pub fn parse_state(value: &Value) -> PageState {
    PageState {
        answers: value["answers"].as_u64().unwrap_or(0) as u32,
        text: value["text"].as_str().unwrap_or_default().trim().to_string(),
        code: value["code"].as_array().map(|list| list.iter().filter_map(|c| c.as_str().map(|s| s.trim_end().to_string())).filter(|c| !c.is_empty()).collect()).unwrap_or_default(),
        done: value["done"].as_bool().unwrap_or(false),
        has_input: value["hasInput"].as_bool().unwrap_or(false),
        page_text: value["pageText"].as_str().unwrap_or_default().to_string(),
        stop_visible: value["stop"].as_bool().unwrap_or(false),
        thinking: value["thinking"].as_bool().unwrap_or(false),
        input_empty: value["inputEmpty"].as_bool().unwrap_or(false),
    }
}

/// The error a short answer stands for (usage limit or a failure), if any. Long answers are never judged.
pub fn judge_answer(chat: &ChatConfig, text: &str, has_code: bool) -> Option<GenError> {
    if has_code || text.chars().count() > 400 {
        return None;
    }
    if contains_any(text, &chat.soft_failure_texts) {
        return Some(GenError::new(ErrorKind::SoftFailure, "Gemini gave a generic error reply instead of an answer."));
    }
    if contains_any(text, &chat.limit_texts) {
        return Some(GenError::new(ErrorKind::RateLimit, "Gemini says the usage limit of this Google account is reached."));
    }
    if contains_any(text, &chat.error_texts) {
        return Some(GenError::new(ErrorKind::Server, "Gemini could not answer (a temporary problem on its side)."));
    }
    None
}

async fn read_state(session: &Session, tab: &Tab, chat: &ChatConfig) -> Result<PageState, GenError> {
    let s = &chat.selectors;
    let expression = format!(
        "(function () {{ var q = function (x, r) {{ return (r || document).querySelector(x); }}; var all = document.querySelectorAll({response}); var last = all.length ? all[all.length - 1] : null; var textEl = last ? q({text}, last) : null; var codes = last ? Array.prototype.map.call(last.querySelectorAll({code}), function (e) {{ return e.innerText; }}) : []; return {{ answers: all.length, text: textEl ? textEl.innerText : (last ? last.innerText : ''), code: codes, done: !!q({done}), hasInput: !!q({input}), stop: !!q({stop}), thinking: {thinking_expr}, inputEmpty: (function () {{ var i = q({input}); return !!i && i.innerText.trim() === ''; }})(), pageText: (document.body ? document.body.innerText : '').slice(0, 5000) }}; }})()",
        response = js(&s.response),
        text = js(&s.response_text),
        code = js(&s.code_block),
        done = js(&s.done),
        input = js(&s.input),
        stop = js(&s.stop),
        thinking_expr = if s.thinking.trim().is_empty() { "false".to_string() } else { format!("!!q({})", js(&s.thinking)) },
    );
    session.eval_in(&tab.frame, &expression).await.map(|v| parse_state(&v)).map_err(|e| from_cdp(&e, "Reading the chat page"))
}

/// What to say when the chat page did not behave: a page that needs a person, a signed-out account, or the page changed.
pub(super) async fn diagnose(session: &Session, tab: &Tab, engine: &EngineConfig, fallback: &str) -> GenError {
    if let Ok(state) = tool_page::sign_state_in(session, &tab.frame, engine).await {
        if let Some(error) = tool_page::human_error(engine, &format!("{}\n{}", state.title, state.text)) {
            return error;
        }
        if !state.signed_in && state.sign_in_visible {
            return GenError::new(ErrorKind::Auth, "This Google account is signed out. Please sign in again.");
        }
        if let Some(limit) = judge_answer(&engine.chat, &state.text.chars().take(400).collect::<String>(), false) {
            return limit;
        }
    }
    GenError::new(ErrorKind::PageChanged, fallback)
}

/// Waits for the message box to exist. The first thing on a fresh chat page.
pub(super) async fn wait_for_input(session: &Session, tab: &Tab, engine: &EngineConfig) -> Result<(), GenError> {
    let chat = &engine.chat;
    let deadline = tokio::time::Instant::now() + Duration::from_millis(chat.timing.page_ready_ms);
    loop {
        if read_state(session, tab, chat).await?.has_input {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(diagnose(session, tab, engine, "Gemini's chat page did not open as expected. The page may have changed.").await);
        }
        tokio::time::sleep(Duration::from_millis(chat.timing.poll_ms)).await;
    }
}

pub(super) async fn type_and_send(session: &Session, tab: &Tab, chat: &ChatConfig, prompt: &str) -> Result<(), GenError> {
    let focus = format!("(function () {{ var e = document.querySelector({}); if (!e) return false; e.focus(); return true; }})()", js(&chat.selectors.input));
    if session.eval_in(&tab.frame, &focus).await.map_err(|e| from_cdp(&e, "Opening the message box"))? != Value::Bool(true) {
        return Err(GenError::new(ErrorKind::Session, "Gemini's message box disappeared."));
    }
    session.cdp.call("Input.insertText", json!({ "text": prompt }), Some(&tab.frame.session)).await.map_err(|e| from_cdp(&e, "Typing the prompt"))?;

    let click = format!("(function () {{ var b = document.querySelector({}); if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return false; b.click(); return true; }})()", js(&chat.selectors.send));
    let deadline = tokio::time::Instant::now() + Duration::from_millis(chat.timing.send_enable_ms);
    loop {
        if session.eval_in(&tab.frame, &click).await.map_err(|e| from_cdp(&e, "Pressing Send"))? == Value::Bool(true) {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(GenError::new(ErrorKind::PageChanged, "Gemini's Send button did not become available. The page may have changed."));
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// Reports what the chat is doing ("Gemini is thinking... 42 s").
pub type Progress<'a> = Option<&'a (dyn Fn(String) + Send + Sync)>;

/// Waits for the answer and NEVER interrupts it: no reload, no new chat, no second send.
/// Started = Stop button, a new answer element or a thinking indicator (up to `reply_start_ms`).
/// While Stop is visible only waiting happens (up to `think_max_ms`).
/// Finished = Stop gone and the text unchanged for `finish_stable_ms`.
async fn wait_for_answer(session: &Session, tab: &Tab, engine: &EngineConfig, timeout: Duration, answers_before: u32, progress: Progress<'_>) -> Result<PageState, GenError> {
    let chat = &engine.chat;
    let poll = Duration::from_millis(chat.timing.poll_ms);
    let began = tokio::time::Instant::now();
    let start_by = began + Duration::from_millis(chat.timing.reply_start_ms);
    let mut deadline = began + timeout.max(Duration::from_millis(chat.timing.think_max_ms));
    let mut started_at: Option<tokio::time::Instant> = None;
    let mut last_text = String::new();
    let mut unchanged_since = tokio::time::Instant::now();
    let mut last_report = 0u64;
    let mut saw_stop = false;
    loop {
        let state = read_state(session, tab, chat).await?;
        saw_stop |= state.stop_visible;
        let has_answer = state.answers > answers_before;
        let started = state.stop_visible || has_answer || state.thinking;
        if started && started_at.is_none() {
            started_at = Some(tokio::time::Instant::now());
            deadline = tokio::time::Instant::now() + Duration::from_millis(chat.timing.think_max_ms).max(timeout);
            logging::info(LOG, &format!("wait: Gemini started after {} s (stop={}, answer={}, thinking={})", began.elapsed().as_secs(), state.stop_visible, has_answer, state.thinking));
        }
        let Some(started_at) = started_at else {
            if tokio::time::Instant::now() >= start_by {
                logging::warn(LOG, &format!("wait: no sign of an answer after {} s", chat.timing.reply_start_ms / 1000));
                return Err(diagnose_kind(session, tab, engine, ErrorKind::NoResponse, "Gemini did not start an answer. Nothing was resent; please try again.").await);
            }
            tokio::time::sleep(poll).await;
            continue;
        };
        let secs = started_at.elapsed().as_secs();
        if state.stop_visible && secs >= last_report + 5 {
            last_report = secs;
            if let Some(report) = progress {
                report(format!("Gemini is thinking... {secs} s"));
            }
        }
        let text_ready = !state.text.is_empty() || !state.code.is_empty();
        if state.text != last_text {
            last_text = state.text.clone();
            unchanged_since = tokio::time::Instant::now();
        }
        if !state.stop_visible && has_answer && text_ready {
            let quiet = unchanged_since.elapsed();
            // With a Stop button seen, "Stop gone + 2 s quiet" is enough. Without one (page changed), be more careful.
            let needed = if saw_stop || state.done { chat.timing.finish_stable_ms } else { chat.timing.stable_ms.max(chat.timing.finish_stable_ms) };
            if quiet >= Duration::from_millis(needed) {
                logging::info(LOG, &format!("wait: finished after {} s, {} chars", began.elapsed().as_secs(), state.text.chars().count()));
                return Ok(state);
            }
        }
        if tokio::time::Instant::now() >= deadline {
            logging::warn(LOG, "wait: Gemini was still busy at the longest wait");
            return Err(diagnose_kind(session, tab, engine, ErrorKind::ResponseTimeout, "Gemini took too long to answer. It was not interrupted or resent.").await);
        }
        tokio::time::sleep(poll).await;
    }
}

/// Saves a screenshot and a short page summary of a failed chat into the log folder.
async fn save_failure_report(session: &Session, tab: &Tab, chat: &ChatConfig, kind: ErrorKind) {
    let Some(dir) = logging::dir() else { return };
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let base = dir.join(format!("webchat-fail-{stamp}"));
    if let Ok(jpeg) = session.snapshot_tab(tab).await {
        let _ = std::fs::write(base.with_extension("jpg"), jpeg);
    }
    if let Ok(state) = read_state(session, tab, chat).await {
        let summary = format!(
            "kind: {kind:?}\nanswers: {}\nstop visible: {}\nthinking: {}\nhas input: {}\ninput empty: {}\nlast answer (start): {}\npage text (start): {}\n",
            state.answers, state.stop_visible, state.thinking, state.has_input, state.input_empty,
            clip(&state.text, 400), clip(&state.page_text, 600),
        );
        let _ = std::fs::write(base.with_extension("txt"), logging::redact(&summary));
    }
    logging::warn(LOG, &format!("failure report saved: {}", base.display()));
}

async fn diagnose_kind(session: &Session, tab: &Tab, engine: &EngineConfig, kind: ErrorKind, message: &str) -> GenError {
    let error = diagnose(session, tab, engine, message).await;
    let error = if error.kind == ErrorKind::PageChanged { GenError::new(kind, message) } else { error };
    save_failure_report(session, tab, &engine.chat, error.kind).await;
    error
}

/// The most pictures one question may carry.
pub const MAX_IMAGES: usize = 10;

/// Asks one question in a fresh chat and returns the finished answer. The pictures (files on this computer) are uploaded into the message first,
/// through the page's own upload button.
/// Where a question goes: a stored thread (conversation address) and the batch id to look for first.
#[derive(Debug, Clone, Default)]
pub struct ThreadOpts {
    pub url: Option<String>,
    pub batch_id: Option<String>,
}

pub async fn ask_full(session: &Session, engine: &EngineConfig, prompt: &str, images: &[PathBuf], timeout: Duration, progress: Progress<'_>) -> Result<ChatReply, GenError> {
    ask_thread(session, engine, prompt, images, timeout, progress, &ThreadOpts::default()).await.map(|(reply, _)| reply)
}

/// Like `ask_full`, in a stored thread when `opts.url` is set. Returns the answer and the thread's address.
pub async fn ask_thread(session: &Session, engine: &EngineConfig, prompt: &str, images: &[PathBuf], timeout: Duration, progress: Progress<'_>, opts: &ThreadOpts) -> Result<(ChatReply, String), GenError> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err(GenError::new(ErrorKind::BadRequest, "The prompt is empty."));
    }
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err(GenError::new(ErrorKind::BadRequest, format!("The prompt is too long for the chat ({} characters, the limit is {MAX_PROMPT_CHARS}).", prompt.chars().count())));
    }
    if images.len() > MAX_IMAGES || images.iter().any(|p| !p.is_absolute() || !p.is_file()) {
        return Err(GenError::new(ErrorKind::BadRequest, "The pictures for the chat could not be found."));
    }
    logging::info(LOG, &format!("ask: opening a new chat tab ({} chars, {} pictures, timeout {} s)", prompt.chars().count(), images.len(), timeout.as_secs()));
    let tab = session.open_tab().await.map_err(|e| from_cdp(&e, "Opening a chat tab"))?;
    let result = ask_in(session, &tab, engine, prompt, images, timeout, progress, opts).await;
    match &result {
        Ok((reply, _)) => logging::info(LOG, &format!("ask: finished, answer {} chars, {} code blocks; closing the tab", reply.text.chars().count(), reply.code.len())),
        Err(error) => logging::warn(LOG, &format!("ask: failed ({:?}): {}; closing the tab", error.kind, error.message)),
    }
    session.close_tab(&tab).await;
    result
}

/// The remote object id of the first element an expression gives (None when it gives nothing).
async fn object_id(session: &Session, tab: &Tab, expression: &str) -> Result<Option<String>, GenError> {
    let mut params = json!({ "expression": expression, "returnByValue": false });
    if let Some(id) = tab.frame.context_id {
        params["contextId"] = json!(id);
    }
    let result = session.cdp.call("Runtime.evaluate", params, Some(&tab.frame.session)).await.map_err(|e| from_cdp(&e, "Finding the upload button"))?;
    Ok(result.pointer("/result/objectId").and_then(Value::as_str).map(str::to_string))
}

pub(super) async fn click(session: &Session, tab: &Tab, selector: &str) -> Result<bool, GenError> {
    let expression = format!("(function () {{ var b = document.querySelector({}); if (!b) return false; b.click(); return true; }})()", js(selector));
    Ok(session.eval_in(&tab.frame, &expression).await.map_err(|e| from_cdp(&e, "Opening the upload menu"))? == Value::Bool(true))
}

/// Finds the page's file input. The page makes it only when the upload entry is used and then opens the system
/// file window; that window is held back (the input is remembered instead) so the files can be handed over directly.
async fn find_file_input(session: &Session, tab: &Tab, chat: &ChatConfig) -> Result<String, GenError> {
    let s = &chat.selectors;
    let hook = "(function () { if (window.__avPick !== undefined) return true; window.__avPick = null; var original = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type === 'file') { window.__avPick = this; return; } return original.apply(this, arguments); }; return true; })()";
    session.eval_in(&tab.frame, hook).await.map_err(|e| from_cdp(&e, "Preparing the upload"))?;
    if let Some(id) = object_id(session, tab, &format!("document.querySelector({})", js(&s.file_input))).await? {
        return Ok(id);
    }
    if !click(session, tab, &s.attach).await? {
        return Err(GenError::new(ErrorKind::NoImage, "Gemini's upload button was not found. The chat page may have changed."));
    }
    let deadline = tokio::time::Instant::now() + Duration::from_millis(chat.timing.send_enable_ms);
    let mut item_clicked = false;
    loop {
        if !item_clicked {
            item_clicked = click(session, tab, &s.upload_item).await?;
        }
        if let Some(id) = object_id(session, tab, "window.__avPick || document.querySelector('input[type=file]')").await? {
            return Ok(id);
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(GenError::new(ErrorKind::NoImage, "Gemini's upload menu did not open as expected. The chat page may have changed."));
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// Uploads the pictures into the message and waits until the page shows all of them.
pub(super) async fn attach_images(session: &Session, tab: &Tab, engine: &EngineConfig, images: &[PathBuf]) -> Result<(), GenError> {
    let chat = &engine.chat;
    let input = find_file_input(session, tab, chat).await?;
    let files: Vec<String> = images.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    session.cdp.call("DOM.setFileInputFiles", json!({ "files": files, "objectId": input }), Some(&tab.frame.session)).await.map_err(|e| from_cdp(&e, "Uploading the pictures"))?;
    if chat.selectors.attachment.trim().is_empty() {
        tokio::time::sleep(Duration::from_secs(4)).await;
        return Ok(());
    }
    let count = format!("document.querySelectorAll({}).length", js(&chat.selectors.attachment));
    let deadline = tokio::time::Instant::now() + Duration::from_millis(chat.timing.upload_ms);
    loop {
        let seen = session.eval_in(&tab.frame, &count).await.map_err(|e| from_cdp(&e, "Checking the uploaded pictures"))?.as_u64().unwrap_or(0);
        if seen as usize >= images.len() {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(diagnose(session, tab, engine, "Gemini did not accept the pictures.").await);
        }
        tokio::time::sleep(Duration::from_millis(chat.timing.poll_ms)).await;
    }
}

async fn ask_in(session: &Session, tab: &Tab, engine: &EngineConfig, prompt: &str, images: &[PathBuf], timeout: Duration, progress: Progress<'_>, opts: &ThreadOpts) -> Result<(ChatReply, String), GenError> {
    let chat = &engine.chat;
    let open_url = opts.url.as_deref().filter(|u| u.starts_with(chat.url.trim_end_matches("/app")) || u.starts_with("http://127.0.0.1")).unwrap_or(&chat.url);
    logging::info(LOG, &format!("step: open {} chat", if opts.url.is_some() { "the stored" } else { "a new" }));
    session.navigate_tab(tab, open_url, Duration::from_millis(chat.timing.page_ready_ms)).await.map_err(|e| from_cdp(&e, "Opening Gemini's chat"))?;
    wait_for_input(session, tab, engine).await?;
    if !images.is_empty() {
        attach_images(session, tab, engine, images).await?;
    }
    logging::info(LOG, "step: message box ready; inserting text and pressing Send");
    let before_state = read_state(session, tab, chat).await?;
    let before = before_state.answers;
    // Our message may already be in this thread (an earlier run sent it): wait for its answer instead of sending again.
    let already = match opts.batch_id.as_deref() {
        Some(id) if opts.url.is_some() => count_in_page(session, tab, &format!("BATCH_ID: {id}")).await? > 0,
        _ => false,
    };
    let state = if already {
        logging::info(LOG, "step: this batch is already in the thread; waiting for its answer, not sending again");
        wait_for_answer(session, tab, engine, timeout, before.saturating_sub(1), progress).await?
    } else {
        type_and_send(session, tab, chat, prompt).await?;
        logging::info(LOG, "step: sent; waiting for the answer");
        wait_for_answer(session, tab, engine, timeout, before, progress).await?
    };
    let url = session.eval_in(&tab.frame, "location.href").await.ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default();
    let code = if state.code.is_empty() { code_from_markdown(&state.text) } else { state.code.clone() };
    if let Some(error) = judge_answer(chat, &state.text, !code.is_empty()) {
        return Err(error);
    }
    if let Some(error) = tool_page::human_error(engine, &clip(&state.page_text, 3000)).filter(|e| e.kind == ErrorKind::Flagged) {
        return Err(error);
    }
    Ok((ChatReply { text: state.text, code }, url))
}

/// How often a text appears on the page.
async fn count_in_page(session: &Session, tab: &Tab, needle: &str) -> Result<usize, GenError> {
    let expression = format!("(function () {{ var t = document.body ? document.body.innerText : ''; return t.split({}).length - 1; }})()", js(needle));
    Ok(session.eval_in(&tab.frame, &expression).await.map_err(|e| from_cdp(&e, "Reading the chat page"))?.as_u64().unwrap_or(0) as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chat() -> ChatConfig {
        ChatConfig::default()
    }

    #[test]
    fn code_blocks_are_found_in_markdown() {
        let text = "Here:\n```html\n<p>a</p>\n<p>b</p>\n```\ntext\n```\nsecond\n```\n";
        assert_eq!(code_from_markdown(text), vec!["<p>a</p>\n<p>b</p>".to_string(), "second".to_string()]);
        assert!(code_from_markdown("no code").is_empty());
        assert!(code_from_markdown("```\nnever closed").is_empty());
    }

    #[test]
    fn json_is_cut_out_of_an_answer() {
        let reply = ChatReply { text: "Sure! {\"a\": [1, 2]} Hope it helps".into(), code: vec![] };
        assert_eq!(json_from_reply(&reply).as_deref(), Some("{\"a\": [1, 2]}"));
        let in_code = ChatReply { text: "x".into(), code: vec!["json\n[{\"a\":1}]".into()] };
        assert_eq!(json_from_reply(&in_code).as_deref(), Some("[{\"a\":1}]"));
        assert_eq!(json_from_reply(&ChatReply { text: "nothing".into(), code: vec![] }), None);
    }

    #[test]
    fn short_limit_and_error_answers_are_judged_but_long_ones_are_not() {
        assert_eq!(judge_answer(&chat(), "You've reached your limit for today.", false).map(|e| e.kind), Some(ErrorKind::RateLimit));
        assert_eq!(judge_answer(&chat(), "Something went wrong.", false).map(|e| e.kind), Some(ErrorKind::Server));
        assert!(judge_answer(&chat(), "You've reached your limit", true).is_none(), "an answer with code is real");
        let long = format!("usage limit {}", "word ".repeat(200));
        assert!(judge_answer(&chat(), &long, false).is_none());
        assert!(judge_answer(&chat(), "Here is your story", false).is_none());
    }

    #[test]
    fn the_page_state_is_read_from_the_page_value() {
        let state = parse_state(&json!({ "answers": 1, "text": " hi ", "code": ["a \n", ""], "done": true, "hasInput": true }));
        assert_eq!((state.answers, state.text.as_str(), state.done, state.has_input), (1, "hi", true, true));
        assert_eq!(state.code, vec!["a".to_string()]);
        assert_eq!(parse_state(&Value::Null), PageState::default());
    }

    #[test]
    fn first_code_or_text_prefers_code() {
        assert_eq!(ChatReply { text: "t".into(), code: vec!["c".into()] }.first_code_or_text(), "c");
        assert_eq!(ChatReply { text: "t".into(), code: vec![] }.first_code_or_text(), "t");
    }
}
