//! Text answers from Gemini's normal chat page, through a Google account in the browser.
//!
//! Every question opens a fresh chat in an extra tab (no memory of earlier questions), types the
//! prompt, presses Send and waits until the answer is finished. The page's selectors come from
//! `EngineConfig.chat`, so a changed page is fixed by a settings update, not a new app version.
//!
//! Like the image tool, a page that needs a person (captcha, terms, sign-in) is never worked around:
//! it becomes an error that pauses the account and is shown to the user.

use std::time::Duration;

use serde_json::{json, Value};

use super::browser::cdp::CdpError;
use super::browser::session::{Session, Tab};
use super::config::{ChatConfig, EngineConfig};
use super::errors::{classify_browser_error, clip, contains_any, ErrorKind, GenError};
use super::tool_page;

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

fn js(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string())
}

fn from_cdp(error: &CdpError, what: &str) -> GenError {
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
}

pub fn parse_state(value: &Value) -> PageState {
    PageState {
        answers: value["answers"].as_u64().unwrap_or(0) as u32,
        text: value["text"].as_str().unwrap_or_default().trim().to_string(),
        code: value["code"].as_array().map(|list| list.iter().filter_map(|c| c.as_str().map(|s| s.trim_end().to_string())).filter(|c| !c.is_empty()).collect()).unwrap_or_default(),
        done: value["done"].as_bool().unwrap_or(false),
        has_input: value["hasInput"].as_bool().unwrap_or(false),
        page_text: value["pageText"].as_str().unwrap_or_default().to_string(),
    }
}

/// The error a short answer stands for (usage limit or a failure), if any. Long answers are never judged.
pub fn judge_answer(chat: &ChatConfig, text: &str, has_code: bool) -> Option<GenError> {
    if has_code || text.chars().count() > 400 {
        return None;
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
        "(function () {{ var q = function (x, r) {{ return (r || document).querySelector(x); }}; var all = document.querySelectorAll({response}); var last = all.length ? all[all.length - 1] : null; var textEl = last ? q({text}, last) : null; var codes = last ? Array.prototype.map.call(last.querySelectorAll({code}), function (e) {{ return e.innerText; }}) : []; return {{ answers: all.length, text: textEl ? textEl.innerText : (last ? last.innerText : ''), code: codes, done: !!q({done}), hasInput: !!q({input}), pageText: (document.body ? document.body.innerText : '').slice(0, 5000) }}; }})()",
        response = js(&s.response),
        text = js(&s.response_text),
        code = js(&s.code_block),
        done = js(&s.done),
        input = js(&s.input),
    );
    session.eval_in(&tab.frame, &expression).await.map(|v| parse_state(&v)).map_err(|e| from_cdp(&e, "Reading the chat page"))
}

/// What to say when the chat page did not behave: a page that needs a person, a signed-out account, or the page changed.
async fn diagnose(session: &Session, tab: &Tab, engine: &EngineConfig, fallback: &str) -> GenError {
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
    GenError::new(ErrorKind::NoImage, fallback)
}

/// Waits for the message box to exist. The first thing on a fresh chat page.
async fn wait_for_input(session: &Session, tab: &Tab, engine: &EngineConfig) -> Result<(), GenError> {
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

async fn type_and_send(session: &Session, tab: &Tab, chat: &ChatConfig, prompt: &str) -> Result<(), GenError> {
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
            return Err(GenError::new(ErrorKind::NoImage, "Gemini's Send button did not become available."));
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

async fn wait_for_answer(session: &Session, tab: &Tab, engine: &EngineConfig, timeout: Duration) -> Result<PageState, GenError> {
    let chat = &engine.chat;
    let poll = Duration::from_millis(chat.timing.poll_ms);
    let started_by = tokio::time::Instant::now() + Duration::from_millis(chat.timing.reply_start_ms);
    let deadline = tokio::time::Instant::now() + timeout;
    let mut last_text = String::new();
    let mut unchanged_since = tokio::time::Instant::now();
    loop {
        let state = read_state(session, tab, chat).await?;
        if state.answers == 0 {
            if tokio::time::Instant::now() >= started_by {
                return Err(diagnose(session, tab, engine, "Gemini did not start an answer.").await);
            }
        } else if !state.text.is_empty() || !state.code.is_empty() {
            if state.done {
                return Ok(state);
            }
            if state.text != last_text {
                last_text = state.text.clone();
                unchanged_since = tokio::time::Instant::now();
            } else if unchanged_since.elapsed() >= Duration::from_millis(chat.timing.stable_ms) {
                return Ok(state);
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(GenError::new(ErrorKind::Timeout, "Gemini took too long to answer."));
        }
        tokio::time::sleep(poll).await;
    }
}

/// Asks one question in a fresh chat and returns the finished answer.
pub async fn ask(session: &Session, engine: &EngineConfig, prompt: &str, timeout: Duration) -> Result<ChatReply, GenError> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err(GenError::new(ErrorKind::BadRequest, "The prompt is empty."));
    }
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err(GenError::new(ErrorKind::BadRequest, format!("The prompt is too long for the chat ({} characters, the limit is {MAX_PROMPT_CHARS}).", prompt.chars().count())));
    }
    let tab = session.open_tab().await.map_err(|e| from_cdp(&e, "Opening a chat tab"))?;
    let result = ask_in(session, &tab, engine, prompt, timeout).await;
    session.close_tab(&tab).await;
    result
}

async fn ask_in(session: &Session, tab: &Tab, engine: &EngineConfig, prompt: &str, timeout: Duration) -> Result<ChatReply, GenError> {
    let chat = &engine.chat;
    session.navigate_tab(tab, &chat.url, Duration::from_millis(chat.timing.page_ready_ms)).await.map_err(|e| from_cdp(&e, "Opening Gemini's chat"))?;
    wait_for_input(session, tab, engine).await?;
    type_and_send(session, tab, chat, prompt).await?;
    let state = wait_for_answer(session, tab, engine, timeout).await?;
    let code = if state.code.is_empty() { code_from_markdown(&state.text) } else { state.code.clone() };
    if let Some(error) = judge_answer(chat, &state.text, !code.is_empty()) {
        return Err(error);
    }
    if let Some(error) = tool_page::human_error(engine, &clip(&state.page_text, 3000)).filter(|e| e.kind == ErrorKind::Flagged) {
        return Err(error);
    }
    Ok(ChatReply { text: state.text, code })
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
