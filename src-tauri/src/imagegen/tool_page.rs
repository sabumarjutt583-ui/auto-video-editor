//! The steps on the Gemini page and in the shared image tool: check the account is signed in, press
//! Gemini's "Continue", find the tool's frame, set the options, send one prompt, read the result cards,
//! take a finished picture. Everything about the page (selectors, texts) comes from `EngineConfig`.
//!
//! Page text that needs a person (captcha, "unusual activity", terms, a sign-in request) is never
//! worked around: it becomes an error that pauses the account and is shown to the user.

use std::time::Duration;

use serde_json::Value;

use super::browser::cdp::CdpError;
use super::browser::session::{Frame, Session};
use super::config::{EngineConfig, Selector};
use super::errors::{classify_browser_error, classify_card_error, ErrorKind, GenError};

fn js(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string())
}

fn from_cdp(error: &CdpError, what: &str) -> GenError {
    classify_browser_error(&error.to_string(), what)
}

/// JavaScript that finds an element by CSS and, when the selector has one, by its text.
fn find_expr(selector: &Selector) -> String {
    match selector {
        Selector::Css(css) => format!("document.querySelector({})", js(css)),
        Selector::WithText { css, text } => {
            format!("[...document.querySelectorAll({})].find(function (e) {{ return new RegExp({}, 'i').test(e.textContent || ''); }})", js(css), js(text))
        }
    }
}

const SET_VALUE: &str = "function setValue(el, value) { var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignState {
    pub signed_in: bool,
    pub sign_in_visible: bool,
    pub email: String,
    pub title: String,
    pub text: String,
}

pub fn parse_sign_state(value: &Value) -> SignState {
    SignState {
        signed_in: value["signedIn"].as_bool().unwrap_or(false),
        sign_in_visible: value["signInVisible"].as_bool().unwrap_or(false),
        email: value["email"].as_str().unwrap_or_default().to_string(),
        title: value["title"].as_str().unwrap_or_default().to_string(),
        text: value["text"].as_str().unwrap_or_default().to_string(),
    }
}

pub async fn sign_state(session: &Session, config: &EngineConfig) -> Result<SignState, GenError> {
    let expression = format!(
        "(function () {{ var account = document.querySelector({account}); var visible = Array.prototype.some.call(document.querySelectorAll({link}), function (e) {{ return e.getClientRects().length > 0; }}); var label = account ? (account.getAttribute('aria-label') || '') : ''; var match = label.match(/\\(([^)]+@[^)]+)\\)/); return {{ signedIn: !!account, signInVisible: visible && !account, email: match ? match[1] : '', title: document.title, text: (document.body ? document.body.innerText : '').slice(0, 6000) }}; }})()",
        account = js(&config.selectors.account_button),
        link = js(&config.selectors.sign_in_link),
    );
    session.eval(&expression).await.map(|v| parse_sign_state(&v)).map_err(|e| from_cdp(&e, "Reading the Google page"))
}

/// The error for a page that needs the user, if the text shows one.
pub fn human_error(config: &EngineConfig, text: &str) -> Option<GenError> {
    config.human_check(text).map(|check| GenError::new(check.kind, check.message.clone()))
}

/// Waits (up to `timeout`) until the page shows a signed-in account. Signed out for more than four
/// seconds is `Auth`; a page that needs a person is reported as it says (never worked around).
pub async fn check_signed_in(session: &Session, config: &EngineConfig, timeout: Duration) -> Result<SignState, GenError> {
    let deadline = tokio::time::Instant::now() + timeout;
    let mut signed_out_since: Option<tokio::time::Instant> = None;
    loop {
        let state = sign_state(session, config).await?;
        if state.signed_in {
            return Ok(state);
        }
        if let Some(error) = human_error(config, &format!("{}\n{}", state.title, state.text)) {
            return Err(error);
        }
        if state.sign_in_visible {
            let since = *signed_out_since.get_or_insert_with(tokio::time::Instant::now);
            if since.elapsed() > Duration::from_secs(4) {
                return Err(GenError::new(ErrorKind::Auth, "This Google account is signed out. Please sign in again."));
            }
        } else {
            signed_out_since = None;
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(GenError::new(ErrorKind::NoImage, "The Google page did not show an account (the page did not load as expected)."));
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
}

async fn click_continue(session: &Session, config: &EngineConfig) -> bool {
    let expression = format!("(function () {{ var b = {}; if (!b) return false; b.click(); return true; }})()", find_expr(&config.selectors.continue_button));
    session.eval(&expression).await.is_ok_and(|v| v == Value::Bool(true))
}

fn tool_probe(config: &EngineConfig) -> String {
    format!("!!document.querySelector({})", js(&config.selectors.submit))
}

/// Opens the tool page and returns the frame the tool runs in, plus the account's e-mail.
pub async fn open_tool(session: &Session, config: &EngineConfig) -> Result<(Frame, String), GenError> {
    let timeout = Duration::from_millis(config.timing.page_load_timeout_ms);
    session.navigate(&config.tool_url, timeout).await.map_err(|e| from_cdp(&e, "Opening the image tool"))?;
    let state = check_signed_in(session, config, Duration::from_secs(20)).await?;

    let deadline = tokio::time::Instant::now() + timeout;
    let mut clicked = false;
    loop {
        if let Some(frame) = session.find_frame(&tool_probe(config)).await.map_err(|e| from_cdp(&e, "Looking for the image tool"))? {
            return Ok((frame, state.email));
        }
        // The one notice that is pressed: Gemini's "This app was created by another person" -> Continue.
        if !clicked && click_continue(session, config).await {
            clicked = true;
        }
        if tokio::time::Instant::now() >= deadline {
            let text = sign_state(session, config).await.map(|s| format!("{}\n{}", s.title, s.text)).unwrap_or_default();
            return Err(human_error(config, &text).unwrap_or_else(|| GenError::new(ErrorKind::NoImage, "The image tool did not open. The page may have changed.")));
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

/// Sets "parallel images" and the aspect ratio in the tool.
pub async fn prepare(session: &Session, frame: &Frame, config: &EngineConfig, parallel: u32, ratio: &str) -> Result<(), GenError> {
    let parallel = parallel.clamp(1, config.max_parallel);
    let expression = format!(
        "(function () {{ {SET_VALUE} var p = document.querySelector({parallel_sel}); if (p) setValue(p, String({parallel})); var r = document.querySelector({ratio_sel}); if (r && !r.classList.contains('active')) r.click(); return !!r || {no_ratio}; }})()",
        parallel_sel = js(&config.selectors.parallel),
        ratio_sel = js(&config.ratio_button_selector(ratio)),
        no_ratio = !config.tool_aspect_ratios.iter().any(|r| r == ratio),
    );
    let ok = session.eval_in(frame, &expression).await.map_err(|e| from_cdp(&e, "Setting the image options"))?;
    if ok == Value::Bool(true) {
        Ok(())
    } else {
        Err(GenError::new(ErrorKind::BadRequest, format!("The image tool has no button for the aspect ratio {ratio}.")))
    }
}

/// Sends one prompt. Returns the number the tool gave it (its count + 1), which finds the result card later.
pub async fn submit(session: &Session, frame: &Frame, config: &EngineConfig, prompt: &str) -> Result<u32, GenError> {
    let one_line = prompt.split_whitespace().collect::<Vec<_>>().join(" ");
    let s = &config.selectors;
    let expression = format!(
        "(async function (prompt) {{ {SET_VALUE} var q = function (x) {{ return document.querySelector(x); }}; var all = q({all}); if (all) all.click(); var search = q({search}); if (search && search.value) setValue(search, ''); var tab = q({tab}); if (tab) tab.click(); var total = q({total}); var input = q({input}); var send = q({submit}); if (!total || !input || !send) return {{ ok: false, why: 'missing' }}; var before = parseInt(total.textContent, 10) || 0; setValue(input, 'Prompt ' + (before + 1) + ': ' + prompt); send.click(); var end = Date.now() + {confirm}; while (Date.now() < end) {{ if ((parseInt(total.textContent, 10) || 0) > before) return {{ ok: true, number: before + 1 }}; await new Promise(function (r) {{ setTimeout(r, 120); }}); }} return {{ ok: false, why: 'not-added' }}; }})({prompt})",
        all = js(&s.all_filter),
        search = js(&s.search),
        tab = js(&s.prompts_tab),
        total = js(&s.total),
        input = js(&s.prompt_input),
        submit = js(&s.submit),
        confirm = config.timing.submit_confirm_ms,
        prompt = js(&one_line),
    );
    let result = session.eval_in(frame, &expression).await.map_err(|e| from_cdp(&e, "Sending the prompt"))?;
    if result["ok"] == Value::Bool(true) {
        return result["number"].as_u64().map(|n| n as u32).ok_or_else(|| GenError::new(ErrorKind::NoImage, "The image tool gave no prompt number."));
    }
    let why = result["why"].as_str().unwrap_or("unknown");
    Err(GenError::new(
        if why == "missing" { ErrorKind::Session } else { ErrorKind::NoImage },
        if why == "missing" { "The image tool page lost its controls (it was reloaded)." } else { "The image tool did not accept the prompt." },
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardStatus {
    Queued,
    Generating,
    Completed,
    Failed,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Card {
    pub number: u32,
    pub status: CardStatus,
    pub error: String,
    pub has_image: bool,
}

pub fn parse_cards(value: &Value) -> Vec<Card> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|card| {
            let number = card["number"].as_u64()? as u32;
            let status = match card["status"].as_str().unwrap_or("").to_uppercase().as_str() {
                "QUEUED" | "PENDING" | "WAITING" => CardStatus::Queued,
                "GENERATING" | "RUNNING" | "PROCESSING" => CardStatus::Generating,
                "COMPLETED" | "DONE" | "SUCCESS" => CardStatus::Completed,
                "FAILED" | "ERROR" => CardStatus::Failed,
                _ => CardStatus::Other,
            };
            Some(Card { number, status, error: card["error"].as_str().unwrap_or_default().trim().to_string(), has_image: card["hasImage"].as_bool().unwrap_or(false) })
        })
        .collect()
}

/// Every result card of the tool.
pub async fn poll(session: &Session, frame: &Frame, config: &EngineConfig) -> Result<Vec<Card>, GenError> {
    let expression = format!(
        "Array.prototype.map.call(document.querySelectorAll({grid} + ' > div'), function (card) {{ var text = card.innerText || ''; var m = text.match(/Prompt\\s+(\\d+)\\s+([A-Za-z]+)/); var err = card.querySelector({error}); return {{ number: m ? parseInt(m[1], 10) : 0, status: m ? m[2] : '', error: err ? err.textContent : '', hasImage: !!card.querySelector('img[src^=\"data:image/\"]') }}; }}).filter(function (c) {{ return c.number > 0; }})",
        grid = js(&config.selectors.grid),
        error = js(&config.selectors.card_error),
    );
    let value = session.eval_in(frame, &expression).await.map_err(|e| from_cdp(&e, "Reading the results"))?;
    Ok(parse_cards(&value))
}

/// Takes the picture of a finished card.
pub async fn read_image(session: &Session, frame: &Frame, config: &EngineConfig, number: u32) -> Result<Vec<u8>, GenError> {
    let expression = format!(
        "(function () {{ var cards = document.querySelectorAll({grid} + ' > div'); for (var i = 0; i < cards.length; i++) {{ var m = (cards[i].innerText || '').match(/Prompt\\s+(\\d+)/); if (m && parseInt(m[1], 10) === {number}) {{ var img = cards[i].querySelector('img[src^=\"data:image/\"]'); return img ? img.src : ''; }} }} return ''; }})()",
        grid = js(&config.selectors.grid),
    );
    let value = session.eval_in(frame, &expression).await.map_err(|e| from_cdp(&e, "Reading the picture"))?;
    decode_data_url(value.as_str().unwrap_or_default()).ok_or_else(|| GenError::new(ErrorKind::NoImage, "The picture could not be read from the page."))
}

/// `data:image/png;base64,....` to bytes.
pub fn decode_data_url(url: &str) -> Option<Vec<u8>> {
    let (head, body) = url.split_once(',')?;
    if !head.starts_with("data:image/") || !head.contains("base64") {
        return None;
    }
    crate::api::base64::decode(body)
}

/// Empties the tool's list when it is idle and `finished` prompts piled up (memory of the tab).
pub async fn clear_if_idle(session: &Session, frame: &Frame, config: &EngineConfig) -> Result<bool, GenError> {
    let s = &config.selectors;
    let expression = format!(
        "(function () {{ var n = function (x) {{ var e = document.querySelector(x); return e ? (parseInt(e.textContent, 10) || 0) : 0; }}; if (n({queued}) > 0 || n({generating}) > 0) return false; var b = document.querySelector({clear}); if (!b) return false; b.click(); return true; }})()",
        queued = js(&s.queued),
        generating = js(&s.generating),
        clear = js(&s.clear_batch),
    );
    session.eval_in(frame, &expression).await.map(|v| v == Value::Bool(true)).map_err(|e| from_cdp(&e, "Clearing the list"))
}

/// What a failed card means. `signed_out` is whether the page itself shows the account signed out.
pub fn card_error(config: &EngineConfig, card: &Card, signed_out: bool) -> GenError {
    let text = if card.error.is_empty() { "Generation failed" } else { card.error.as_str() };
    classify_card_error(&config.error_patterns, text, signed_out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn data_urls_are_decoded_and_other_text_is_rejected() {
        let url = format!("data:image/png;base64,{}", crate::api::base64::encode(&[1, 2, 3, 4, 5]));
        assert_eq!(decode_data_url(&url), Some(vec![1, 2, 3, 4, 5]));
        assert_eq!(decode_data_url("https://example.com/a.png"), None);
        assert_eq!(decode_data_url("data:text/html;base64,AAAA"), None);
        assert_eq!(decode_data_url(""), None);
    }

    #[test]
    fn cards_are_read_with_their_status_and_error() {
        let cards = parse_cards(&json!([
            { "number": 1, "status": "COMPLETED", "error": "", "hasImage": true },
            { "number": 2, "status": "Failed", "error": " API Error 429 ", "hasImage": false },
            { "number": 3, "status": "QUEUED" },
            { "status": "COMPLETED" },
            { "number": 4, "status": "weird" }
        ]));
        assert_eq!(cards.len(), 4);
        assert_eq!((cards[0].status, cards[0].has_image), (CardStatus::Completed, true));
        assert_eq!((cards[1].status, cards[1].error.as_str()), (CardStatus::Failed, "API Error 429"));
        assert_eq!(cards[2].status, CardStatus::Queued);
        assert_eq!(cards[3].status, CardStatus::Other);
    }

    #[test]
    fn card_errors_use_the_config_rules() {
        let config = EngineConfig::bundled();
        let card = |text: &str| Card { number: 1, status: CardStatus::Failed, error: text.into(), has_image: false };
        assert_eq!(card_error(&config, &card("API Error 429"), false).kind, ErrorKind::RateLimit);
        assert_eq!(card_error(&config, &card("API Error 403"), false).kind, ErrorKind::Access);
        assert_eq!(card_error(&config, &card("API Error 403"), true).kind, ErrorKind::Auth);
        assert_eq!(card_error(&config, &card("API Error 503"), false).kind, ErrorKind::Server);
        assert_eq!(card_error(&config, &card(""), false).kind, ErrorKind::Unknown);
    }

    #[test]
    fn pages_that_need_a_person_are_reported_not_worked_around() {
        let config = EngineConfig::bundled();
        assert_eq!(human_error(&config, "Our systems have detected unusual traffic").map(|e| e.kind), Some(ErrorKind::Flagged));
        assert!(human_error(&config, "Gemini: ask me anything").is_none());
    }

    #[test]
    fn sign_state_is_read_from_the_page_value() {
        let state = parse_sign_state(&json!({ "signedIn": true, "email": "a@b.com", "title": "Gemini", "text": "hi" }));
        assert!(state.signed_in && !state.sign_in_visible);
        assert_eq!(state.email, "a@b.com");
        assert!(!parse_sign_state(&Value::Null).signed_in);
    }

    #[test]
    fn selectors_with_text_build_a_regex_search() {
        let config = EngineConfig::bundled();
        assert!(find_expr(&config.selectors.continue_button).contains("RegExp"));
        assert!(find_expr(&Selector::Css("#a".into())).starts_with("document.querySelector(\"#a\")"));
    }
}
