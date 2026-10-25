//! Making one video in Google Flow (flow.google.com), through a Google account in the browser.
//!
//! Every account keeps one Flow project (made the first time, then reused while the app runs). A video is made like
//! a person does it: open the settings of the prompt box and choose Video, Frames, the model, the size and "x1";
//! put the picture in the "Start" frame (Upload media); type the prompt; press Send; wait until the tile's progress
//! label is gone; then move over the new tile, press its "..." button and take Download, 720p Original size.
//!
//! Flow's markup has no stable names, so buttons are found by their visible text (regular expressions in
//! `EngineConfig.flow`) and pressed with a real mouse click. A changed page is fixed by a settings update.
//! The credits are read from the page ("Generating will use 10 credits"); a video that would cost more than
//! `maxCreditsPerVideo` is never started. A page that needs a person (captcha, "unusual activity") is never
//! worked around: the account is paused and the message is shown.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};

use super::browser::session::{Session, Tab};
use super::chat::{self, Progress};
use super::config::{EngineConfig, FlowConfig};
use super::errors::{contains_any, ErrorKind, GenError};
use super::video::looks_like_video;
use crate::logging;

const LOG: &str = "flowvideo";

/// What the page says right now (pure, so it is easy to test).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Waiting,
    NoCredits,
    Failed,
    NeedsPerson,
}

pub fn judge(cfg: &FlowConfig, page_text: &str) -> Verdict {
    if contains_any(page_text, &cfg.block_texts) {
        return Verdict::NeedsPerson;
    }
    if contains_any(page_text, &cfg.limit_texts) {
        return Verdict::NoCredits;
    }
    if contains_any(page_text, &cfg.error_texts) {
        return Verdict::Failed;
    }
    Verdict::Waiting
}

#[cfg(test)]
/// Reads the first number (with thousands commas) of a regex's first group: "Generating will use 24 credits" -> 24.
pub fn credits_from(text: &str, pattern: &str) -> Option<u32> {
    let re = simple_group(text, pattern)?;
    re.replace(',', "").trim().parse().ok()
}

#[cfg(test)]
/// Runs the regex on the text and returns group 1. Written without a regex crate: the pattern is the page's own
/// (JavaScript) one, so it is run by the page in `read_credit`; this helper only handles the two shapes used here
/// by looking for the digits that stand before or after the fixed words.
fn simple_group(text: &str, pattern: &str) -> Option<String> {
    // "...use\s+([\d,]+)\s+credits": digits come after the words before the group.
    // "([\d,]+)\s+Google Flow credits": digits come before the words after the group.
    let group_at = pattern.find('(')?;
    let before: String = pattern[..group_at].replace("\\s+", " ").replace("\\s*", " ").trim().to_string();
    let after_start = pattern.find(')')? + 1;
    let after: String = pattern[after_start..].replace("\\s+", " ").replace("\\s*", " ").trim().to_string();
    let lower = text.to_lowercase();
    let digits = |s: &str| s.chars().take_while(|c| c.is_ascii_digit() || *c == ',').collect::<String>();
    if !before.is_empty() {
        let at = lower.find(&before.to_lowercase())? + before.len();
        let rest = text[at..].trim_start();
        let d = digits(rest);
        return (!d.is_empty()).then_some(d);
    }
    let at = lower.find(&after.to_lowercase())?;
    let head = text[..at].trim_end();
    let d: String = head.chars().rev().take_while(|c| c.is_ascii_digit() || *c == ',').collect::<Vec<_>>().into_iter().rev().collect();
    (!d.is_empty()).then_some(d)
}

fn from_cdp(error: &super::browser::cdp::CdpError, what: &str) -> GenError {
    chat::from_cdp(error, what)
}

async fn eval(session: &Session, tab: &Tab, expression: &str, what: &str) -> Result<Value, GenError> {
    session.eval_in(&tab.frame, expression).await.map_err(|e| from_cdp(&e, what))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// One project address per account browser (by its profile folder), kept while the app runs.
fn projects() -> &'static Mutex<HashMap<PathBuf, String>> {
    static MAP: OnceLock<Mutex<HashMap<PathBuf, String>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone, Copy)]
struct Spot {
    x: f64,
    y: f64,
}

/// All visible elements whose own text matches the regex (the deepest ones), as click points, top to bottom.
async fn find_spots(session: &Session, tab: &Tab, pattern: &str) -> Result<Vec<Spot>, GenError> {
    let expression = format!(
        "(function (rx) {{ var re = new RegExp(rx, 'i'); var els = document.querySelectorAll('button,[role=button],[role=tab],[role=option],[role=menuitem],[role=radio],li,a,div,span,p,h1,h2,h3'); var out = []; for (var i = 0; i < els.length; i++) {{ var e = els[i]; var t = (e.innerText || '').trim(); if (!t || !re.test(t)) continue; var deeper = false; for (var j = 0; j < e.children.length; j++) {{ var c = (e.children[j].innerText || '').trim(); if (c && re.test(c)) {{ deeper = true; break; }} }} if (deeper) continue; var b = e.getBoundingClientRect(); if (b.width < 2 || b.height < 2) continue; if (b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth) continue; out.push({{ x: b.left + b.width / 2, y: b.top + b.height / 2 }}); }} out.sort(function (a, b) {{ return a.y - b.y; }}); return out; }})({})",
        chat::js(pattern)
    );
    let value = eval(session, tab, &expression, "Looking for a button").await?;
    Ok(value.as_array().map(|a| a.iter().filter_map(|v| Some(Spot { x: v["x"].as_f64()?, y: v["y"].as_f64()? })).collect()).unwrap_or_default())
}

/// The click point of the first element of a CSS selector (buttons with an aria-label), even when it only shows on hover.
async fn css_spot(session: &Session, tab: &Tab, css: &str) -> Result<Option<Spot>, GenError> {
    let expression = format!(
        "(function (sel) {{ var e = document.querySelector(sel); if (!e) return null; e.scrollIntoView({{ block: 'nearest' }}); var b = e.getBoundingClientRect(); return {{ x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }}; }})({})",
        chat::js(css)
    );
    let value = eval(session, tab, &expression, "Looking for a button").await?;
    if value.is_null() || value["w"].as_f64().unwrap_or(0.0) < 1.0 {
        return Ok(None);
    }
    Ok(Some(Spot { x: value["x"].as_f64().unwrap_or(0.0), y: value["y"].as_f64().unwrap_or(0.0) }))
}

async fn mouse(session: &Session, tab: &Tab, kind: &str, spot: Spot, pressed: bool) -> Result<(), GenError> {
    let mut params = json!({ "type": kind, "x": spot.x, "y": spot.y });
    if pressed || kind == "mousePressed" || kind == "mouseReleased" {
        params["button"] = json!("left");
        params["clickCount"] = json!(1);
    }
    session.cdp.call("Input.dispatchMouseEvent", params, Some(&tab.frame.session)).await.map(|_| ()).map_err(|e| from_cdp(&e, "Using the mouse"))
}

async fn hover(session: &Session, tab: &Tab, spot: Spot) -> Result<(), GenError> {
    mouse(session, tab, "mouseMoved", spot, false).await
}

async fn press(session: &Session, tab: &Tab, spot: Spot) -> Result<(), GenError> {
    hover(session, tab, spot).await?;
    tokio::time::sleep(Duration::from_millis(120)).await;
    mouse(session, tab, "mousePressed", spot, true).await?;
    mouse(session, tab, "mouseReleased", spot, false).await
}

async fn key(session: &Session, tab: &Tab, name: &str, code: u32) -> Result<(), GenError> {
    for kind in ["keyDown", "keyUp"] {
        let mut params = json!({ "type": kind, "key": name, "code": name, "windowsVirtualKeyCode": code });
        if name == "Enter" && kind == "keyDown" {
            params["text"] = json!("\r");
        }
        session.cdp.call("Input.dispatchKeyEvent", params, Some(&tab.frame.session)).await.map_err(|e| from_cdp(&e, "Pressing a key"))?;
    }
    Ok(())
}

/// Presses the button with this visible text (waits up to `ms` for it). `lowest`: take the one lowest on the page
/// (the prompt box is at the bottom); otherwise the first from the top.
async fn press_text(session: &Session, tab: &Tab, pattern: &str, ms: u64, lowest: bool) -> Result<bool, GenError> {
    let deadline = tokio::time::Instant::now() + Duration::from_millis(ms);
    loop {
        let spots = find_spots(session, tab, pattern).await?;
        let pick = if lowest { spots.last() } else { spots.first() };
        if let Some(spot) = pick {
            press(session, tab, *spot).await?;
            return Ok(true);
        }
        if tokio::time::Instant::now() >= deadline {
            return Ok(false);
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

async fn page_text(session: &Session, tab: &Tab) -> Result<String, GenError> {
    let value = eval(session, tab, "(document.body ? document.body.innerText : '').slice(0, 20000)", "Reading the page").await?;
    Ok(value.as_str().unwrap_or_default().to_string())
}

/// Runs the page's own regex on the page text and returns group 1 as a number.
async fn read_number(session: &Session, tab: &Tab, pattern: &str) -> Result<Option<u32>, GenError> {
    let expression = format!(
        "(function (rx) {{ var m = new RegExp(rx, 'i').exec(document.body ? document.body.innerText : ''); return m ? m[1] : null; }})({})",
        chat::js(pattern)
    );
    let value = eval(session, tab, &expression, "Reading the credits").await?;
    Ok(value.as_str().and_then(|t| t.replace(',', "").trim().parse().ok()))
}

fn flow_error(kind: ErrorKind, message: impl Into<String>) -> GenError {
    GenError::new(kind, message)
}

fn changed(what: &str) -> GenError {
    flow_error(ErrorKind::PageChanged, format!("Google Flow's {what} was not found. The Flow page may have changed."))
}

/// Opens (or makes) this account's project and waits for the prompt box.
async fn open_project(session: &Session, tab: &Tab, engine: &EngineConfig) -> Result<(), GenError> {
    let cfg = &engine.flow;
    let wait = Duration::from_millis(engine.chat.timing.page_ready_ms);
    let known = projects().lock().ok().and_then(|m| m.get(&session.profile).cloned());
    session.navigate_tab(tab, known.as_deref().unwrap_or(&cfg.url), wait).await.map_err(|e| from_cdp(&e, "Opening Google Flow"))?;
    let text = page_text(session, tab).await?;
    if contains_any(&text, &cfg.block_texts) {
        return Err(flow_error(ErrorKind::Flagged, "Google is asking for a check (captcha or unusual activity). Open this account's browser window and finish it yourself. The account is paused."));
    }
    let here = eval(session, tab, "location.href", "Reading the address").await?.as_str().unwrap_or_default().to_string();
    if !here.contains(&cfg.project_url_part) {
        logging::info(LOG, "step: making this account's Flow project");
        if !press_text(session, tab, &cfg.new_project_text, 20_000, false).await? {
            if text.to_lowercase().contains("sign in") {
                return Err(flow_error(ErrorKind::Auth, "This Google account is signed out of Flow. Click Sign in for it in Settings."));
            }
            return Err(changed("\"New project\" button"));
        }
        let deadline = tokio::time::Instant::now() + Duration::from_millis(30_000);
        loop {
            let now_url = eval(session, tab, "location.href", "Reading the address").await?.as_str().unwrap_or_default().to_string();
            if now_url.contains(&cfg.project_url_part) {
                if let Ok(mut map) = projects().lock() {
                    map.insert(session.profile.clone(), now_url);
                }
                break;
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(changed("new project"));
            }
            tokio::time::sleep(Duration::from_millis(400)).await;
        }
    } else if let Ok(mut map) = projects().lock() {
        map.insert(session.profile.clone(), here);
    }
    wait_prompt_box(session, tab, cfg).await
}

async fn wait_prompt_box(session: &Session, tab: &Tab, cfg: &FlowConfig) -> Result<(), GenError> {
    let expression = format!("(function (s) {{ var e = document.querySelectorAll(s); for (var i = e.length - 1; i >= 0; i--) {{ var b = e[i].getBoundingClientRect(); if (b.width > 40 && b.height > 10) return true; }} return false; }})({})", chat::js(&cfg.prompt_input));
    let deadline = tokio::time::Instant::now() + Duration::from_millis(30_000);
    loop {
        if eval(session, tab, &expression, "Looking for the prompt box").await? == Value::Bool(true) {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            let text = page_text(session, tab).await?;
            if let Some(error) = block_error(&cfg.block_texts, &text) {
                return Err(error);
            }
            return Err(changed("prompt box"));
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
}

fn block_error(block_texts: &[String], text: &str) -> Option<GenError> {
    contains_any(text, block_texts).then(|| flow_error(ErrorKind::Flagged, "Google is asking for a check (captcha or unusual activity). Open this account's browser window and finish it yourself. The account is paused."))
}

/// Opens the settings of the prompt box. The button shows what is chosen now ("Video · 720p · 8s ... x1").
async fn open_settings(session: &Session, tab: &Tab, cfg: &FlowConfig) -> Result<(), GenError> {
    if !press_text(session, tab, &cfg.chip_text, 15_000, true).await? {
        return Err(changed("settings button"));
    }
    tokio::time::sleep(Duration::from_millis(400)).await;
    Ok(())
}

/// Chooses Video, Frames (or Ingredients without a picture), the shape, model, size, seconds and "x1".
/// Returns the cost the page shows. Everything is read back: a wrong cost stops the video before it starts.
async fn choose_settings(session: &Session, tab: &Tab, cfg: &FlowConfig, with_picture: bool) -> Result<u32, GenError> {
    open_settings(session, tab, cfg).await?;
    if !press_text(session, tab, &cfg.video_tab, 5_000, false).await? {
        return Err(changed("\"Video\" tab"));
    }
    let mode = if with_picture { &cfg.frames_tab } else { &cfg.ingredients_tab };
    if !press_text(session, tab, mode, 5_000, false).await? {
        return Err(changed("\"Frames\" tab"));
    }
    press_text(session, tab, &format!("^\\s*{}\\s*$", regex_escape(&cfg.ratio)), 3_000, false).await?;
    // The model: open the list from its button, then press the wanted name (when it is the one shown, just close).
    let labels = find_spots(session, tab, &cfg.model_label).await?;
    if let Some(button) = labels.first().copied() {
        press(session, tab, button).await?;
        tokio::time::sleep(Duration::from_millis(350)).await;
        let wanted = find_spots(session, tab, &format!("^\\s*{}\\s*$", regex_escape(&cfg.model))).await?;
        match wanted.iter().find(|s| (s.y - button.y).abs() > 12.0 || (s.x - button.x).abs() > 12.0) {
            Some(spot) => press(session, tab, *spot).await?,
            None => key(session, tab, "Escape", 27).await?,
        }
        tokio::time::sleep(Duration::from_millis(350)).await;
    }
    press_text(session, tab, &format!("^\\s*{}\\s*$", regex_escape(&cfg.resolution)), 3_000, false).await?;
    press_text(session, tab, &format!("^\\s*{}s\\s*$", cfg.seconds), 3_000, false).await?;
    press_text(session, tab, &format!("^\\s*x{}\\s*$", cfg.count), 3_000, false).await?;
    tokio::time::sleep(Duration::from_millis(400)).await;
    let cost = read_number(session, tab, &cfg.cost_regex).await?.ok_or_else(|| changed("credit cost line (\"Generating will use ... credits\")"))?;
    logging::info(LOG, &format!("step: settings chosen; the page says {cost} credits"));
    key(session, tab, "Escape", 27).await?;
    tokio::time::sleep(Duration::from_millis(300)).await;
    if cost > cfg.max_credits_per_video {
        return Err(flow_error(ErrorKind::BadRequest, format!("Flow would use {cost} credits for one video, more than the limit of {} credits. Nothing was started. Check the Flow video settings.", cfg.max_credits_per_video)));
    }
    Ok(cost)
}

fn regex_escape(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars() {
        if "\\.^$|?*+()[]{}-".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// The credit balance shown in the account menu (None when it cannot be read; the video is then just tried).
async fn read_balance(session: &Session, tab: &Tab, cfg: &FlowConfig) -> Option<u32> {
    let spot = css_spot(session, tab, &cfg.account_button).await.ok()??;
    press(session, tab, spot).await.ok()?;
    tokio::time::sleep(Duration::from_millis(700)).await;
    let balance = read_number(session, tab, &cfg.balance_regex).await.ok()?;
    let _ = key(session, tab, "Escape", 27).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    balance
}

/// Puts the picture into the "Start" frame: Start -> Upload media (the system file window is held back and the file is
/// handed over directly) -> Add to prompt. Checks that the Start slot is filled.
async fn set_start_frame(session: &Session, tab: &Tab, cfg: &FlowConfig, image: &Path) -> Result<(), GenError> {
    if !press_text(session, tab, &cfg.start_slot, 8_000, true).await? {
        return Err(changed("\"Start\" frame slot"));
    }
    tokio::time::sleep(Duration::from_millis(600)).await;
    let hook = "(function () { if (window.__avPick !== undefined) { window.__avPick = null; return true; } window.__avPick = null; var original = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type === 'file') { window.__avPick = this; return; } return original.apply(this, arguments); }; return true; })()";
    eval(session, tab, hook, "Preparing the upload").await?;
    if !press_text(session, tab, &cfg.upload_text, 8_000, false).await? {
        return Err(changed("\"Upload media\" button"));
    }
    let deadline = tokio::time::Instant::now() + Duration::from_millis(8_000);
    let input = loop {
        if let Some(id) = chat::object_id(session, tab, "window.__avPick || document.querySelector('input[type=file]')").await? {
            break id;
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(changed("file chooser"));
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    };
    session
        .cdp
        .call("DOM.setFileInputFiles", json!({ "files": [image.to_string_lossy()], "objectId": input }), Some(&tab.frame.session))
        .await
        .map_err(|e| from_cdp(&e, "Uploading the picture"))?;
    logging::info(LOG, "step: picture uploaded; adding it to the prompt");
    // The picture appears in the list; it may need a click before "Add to prompt" works.
    if !press_text(session, tab, &cfg.add_to_prompt, 10_000, false).await? {
        let first = "(function () { var imgs = document.querySelectorAll('img'); var best = null; for (var i = 0; i < imgs.length; i++) { var b = imgs[i].getBoundingClientRect(); if (b.width > 20 && b.height > 20 && b.left < innerWidth * 0.5 && b.top > 120 && b.top < innerHeight - 60 && (best === null || b.top < best.y)) { best = { x: b.left + b.width / 2, y: b.top + b.height / 2 }; } } return best; })()";
        let value = eval(session, tab, first, "Choosing the uploaded picture").await?;
        if let (Some(x), Some(y)) = (value["x"].as_f64(), value["y"].as_f64()) {
            press(session, tab, Spot { x, y }).await?;
        }
        if !press_text(session, tab, &cfg.add_to_prompt, 8_000, false).await? {
            return Err(changed("\"Add to prompt\" button"));
        }
    }
    // The Start slot shows the picture instead of the word "Start".
    let deadline = tokio::time::Instant::now() + Duration::from_millis(8_000);
    loop {
        if find_spots(session, tab, &cfg.start_slot).await?.is_empty() {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(flow_error(ErrorKind::PageChanged, "The picture did not appear in Flow's Start frame, so no video was started."));
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
}

async fn type_prompt(session: &Session, tab: &Tab, cfg: &FlowConfig, prompt: &str) -> Result<(), GenError> {
    let focus = format!("(function (s) {{ var e = document.querySelectorAll(s); for (var i = e.length - 1; i >= 0; i--) {{ var b = e[i].getBoundingClientRect(); if (b.width > 40 && b.height > 10) {{ e[i].focus(); return true; }} }} return false; }})({})", chat::js(&cfg.prompt_input));
    if eval(session, tab, &focus, "Opening the prompt box").await? != Value::Bool(true) {
        return Err(changed("prompt box"));
    }
    session.cdp.call("Input.insertText", json!({ "text": prompt }), Some(&tab.frame.session)).await.map_err(|e| from_cdp(&e, "Typing the prompt"))?;
    tokio::time::sleep(Duration::from_millis(500)).await;
    Ok(())
}

/// Presses Send (its button when there is one, else Enter).
async fn send(session: &Session, tab: &Tab, cfg: &FlowConfig) -> Result<(), GenError> {
    if let Some(spot) = css_spot(session, tab, &cfg.send_button).await? {
        press(session, tab, spot).await
    } else {
        key(session, tab, "Enter", 13).await
    }
}

async fn progress_labels(session: &Session, tab: &Tab, cfg: &FlowConfig) -> Result<usize, GenError> {
    Ok(find_spots(session, tab, &cfg.progress_regex).await?.len())
}

/// Moves over the newest tile, presses "...", then Download and the 720p entry, and reads the file that arrives.
async fn download_newest(session: &Session, tab: &Tab, cfg: &FlowConfig) -> Result<Vec<u8>, GenError> {
    let dir = std::env::temp_dir().join(format!("avedit-flow-{}-{}", std::process::id(), now_ms()));
    std::fs::create_dir_all(&dir).map_err(|e| flow_error(ErrorKind::Storage, format!("A temporary folder could not be made: {e}")))?;
    let result = download_into(session, tab, cfg, &dir).await;
    let _ = std::fs::remove_dir_all(&dir);
    result
}

async fn download_into(session: &Session, tab: &Tab, cfg: &FlowConfig, dir: &Path) -> Result<Vec<u8>, GenError> {
    session
        .cdp
        .call("Browser.setDownloadBehavior", json!({ "behavior": "allow", "downloadPath": dir.to_string_lossy() }), None)
        .await
        .map_err(|e| from_cdp(&e, "Preparing the download"))?;
    // The "..." button only shows when the mouse is over the tile: move there first. The newest tile is the first one.
    let more = css_spot(session, tab, &cfg.more_button).await?.ok_or_else(|| changed("tile \"...\" button"))?;
    hover(session, tab, Spot { x: more.x - 60.0, y: more.y + 80.0 }).await?;
    tokio::time::sleep(Duration::from_millis(500)).await;
    press(session, tab, more).await?;
    tokio::time::sleep(Duration::from_millis(600)).await;
    let menu = page_text(session, tab).await?;
    if menu.contains(&cfg.image_menu_marker) && !menu.contains(&cfg.video_menu_marker) {
        return Err(flow_error(ErrorKind::NoImage, "Flow's newest item is a picture, not a video (the video may have failed). Nothing was downloaded."));
    }
    if !press_text(session, tab, &cfg.download_text, 8_000, false).await? {
        return Err(changed("\"Download\" entry"));
    }
    tokio::time::sleep(Duration::from_millis(500)).await;
    if !press_text(session, tab, &cfg.quality_text, 8_000, false).await? {
        return Err(changed("\"720p\" download entry"));
    }
    let deadline = tokio::time::Instant::now() + Duration::from_millis(cfg.download_ms);
    loop {
        let found = std::fs::read_dir(dir).ok().and_then(|entries| {
            entries.flatten().map(|e| e.path()).find(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("mp4") || x.eq_ignore_ascii_case("webm") || x.eq_ignore_ascii_case("mov")))
        });
        if let Some(path) = found {
            tokio::time::sleep(Duration::from_millis(800)).await;
            let bytes = std::fs::read(&path).map_err(|e| flow_error(ErrorKind::Storage, format!("The downloaded video could not be read: {e}")))?;
            if looks_like_video(&bytes) {
                return Ok(bytes);
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(flow_error(ErrorKind::Timeout, "The video download did not finish in time."));
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

/// An account without enough credits rests; its credits come back later (daily or monthly).
fn no_credits(cfg: &FlowConfig, balance: Option<u32>, cost: u32) -> GenError {
    let mut error = flow_error(
        ErrorKind::RateLimit,
        match balance {
            Some(b) => format!("This Google account has {b} Flow credits left, but one video needs {cost}."),
            None => "This Google account has no Flow credits left for now.".to_string(),
        },
    );
    error.retry_after_ms = cfg.default_rest_minutes * 60_000;
    error
}

/// Makes one video. `image` (a file on this computer) is the Start frame. Returns the video file's bytes.
pub async fn make(session: &Session, engine: &EngineConfig, prompt: &str, image: Option<&Path>, timeout: Duration, progress: Progress<'_>) -> Result<Vec<u8>, GenError> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err(flow_error(ErrorKind::BadRequest, "The video prompt is empty."));
    }
    if prompt.chars().count() > chat::MAX_PROMPT_CHARS {
        return Err(flow_error(ErrorKind::BadRequest, "The video prompt is too long."));
    }
    if image.is_some_and(|p| !p.is_absolute() || !p.is_file()) {
        return Err(flow_error(ErrorKind::BadRequest, "The picture to animate could not be found."));
    }
    logging::info(LOG, &format!("make: opening a tab ({} chars, picture: {})", prompt.chars().count(), image.is_some()));
    let tab = session.open_tab().await.map_err(|e| from_cdp(&e, "Opening a tab"))?;
    let result = make_in(session, &tab, engine, prompt, image, timeout, progress).await;
    match &result {
        Ok(bytes) => logging::info(LOG, &format!("make: finished, {} bytes; closing the tab", bytes.len())),
        Err(error) => logging::warn(LOG, &format!("make: failed ({:?}): {}; closing the tab", error.kind, error.message)),
    }
    session.close_tab(&tab).await;
    result
}

async fn make_in(session: &Session, tab: &Tab, engine: &EngineConfig, prompt: &str, image: Option<&Path>, timeout: Duration, progress: Progress<'_>) -> Result<Vec<u8>, GenError> {
    let cfg = &engine.flow;
    open_project(session, tab, engine).await?;
    let balance = read_balance(session, tab, cfg).await;
    let cost = choose_settings(session, tab, cfg, image.is_some()).await?;
    if balance.is_some_and(|b| b < cost) {
        return Err(no_credits(cfg, balance, cost));
    }
    if let Some(image) = image {
        set_start_frame(session, tab, cfg, image).await?;
    }
    type_prompt(session, tab, cfg, prompt).await?;
    let before = progress_labels(session, tab, cfg).await?;
    send(session, tab, cfg).await?;
    logging::info(LOG, &format!("step: sent ({cost} credits); waiting for the video"));

    let began = tokio::time::Instant::now();
    let start_by = began + Duration::from_millis(cfg.start_wait_ms);
    let deadline = began + Duration::from_millis(cfg.max_wait_ms).max(timeout);
    let mut started = false;
    let mut last_report = 0u64;
    loop {
        let labels = progress_labels(session, tab, cfg).await?;
        let text = page_text(session, tab).await?;
        match judge(cfg, &text) {
            Verdict::NeedsPerson => return Err(block_error(&cfg.block_texts, &text).unwrap_or_else(|| flow_error(ErrorKind::Flagged, "Google is asking for a check."))),
            Verdict::NoCredits => return Err(no_credits(cfg, None, cost)),
            Verdict::Failed => return Err(flow_error(ErrorKind::Server, "Flow could not make this video (a temporary problem or a prompt it will not make).")),
            Verdict::Waiting => {}
        }
        if labels > before {
            started = true;
        }
        if started && labels <= before {
            break;
        }
        let secs = began.elapsed().as_secs();
        if secs >= last_report + 10 {
            last_report = secs;
            if let Some(report) = progress {
                report(format!("Flow is making the video... {secs} s{}", if started { "" } else { " (waiting for it to start)" }));
            }
        }
        if !started && tokio::time::Instant::now() >= start_by {
            return Err(flow_error(ErrorKind::NoResponse, "Flow did not start the video. Nothing was resent."));
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(flow_error(ErrorKind::Timeout, "Flow took too long to make the video. It was not interrupted or resent."));
        }
        tokio::time::sleep(Duration::from_millis(cfg.poll_ms)).await;
    }
    logging::info(LOG, &format!("step: the video is ready after {} s; downloading", began.elapsed().as_secs()));
    tokio::time::sleep(Duration::from_millis(1_500)).await;
    download_newest(session, tab, cfg).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_page_text_is_judged() {
        let c = FlowConfig::default();
        assert_eq!(judge(&c, "Start creating or drop media"), Verdict::Waiting);
        assert_eq!(judge(&c, "You don't have enough credits. Not enough credits to generate"), Verdict::NoCredits);
        assert_eq!(judge(&c, "Something went wrong"), Verdict::Failed);
        assert_eq!(judge(&c, "We detected unusual activity from your network"), Verdict::NeedsPerson);
        assert_eq!(judge(&c, "This site is protected by reCAPTCHA and the Google Privacy Policy and Terms of Service apply."), Verdict::Waiting, "the footer is not a captcha");
    }

    #[test]
    fn credits_are_read_from_the_page_text() {
        let c = FlowConfig::default();
        assert_eq!(credits_from("Generating will use 24 credits", &c.cost_regex), Some(24));
        assert_eq!(credits_from("x\n1,030 Google Flow credits\nUpgrade", &c.balance_regex), Some(1030));
        assert_eq!(credits_from("nothing here", &c.cost_regex), None);
    }

    #[test]
    fn names_are_escaped_for_the_page_regex() {
        assert_eq!(regex_escape("Veo 3.1 - Lite"), "Veo 3\\.1 \\- Lite");
        assert_eq!(regex_escape("16:9"), "16:9");
    }

    #[test]
    fn an_account_without_credits_rests() {
        let c = FlowConfig::default();
        let e = no_credits(&c, Some(4), 10);
        assert_eq!(e.kind, ErrorKind::RateLimit);
        assert_eq!(e.retry_after_ms, c.default_rest_minutes * 60_000);
        assert!(e.message.contains("4") && e.message.contains("10"));
    }
}
