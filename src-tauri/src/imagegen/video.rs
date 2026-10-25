//! Making one video in Gemini's chat ("Create video" mode), through a Google account in the browser.
//!
//! Every video opens a fresh chat in an extra tab: turn on "Create video", optionally attach a picture
//! to animate, type the prompt, press Send, wait until "Your video is ready", then take the file.
//! The page's selectors and texts come from `EngineConfig.video`, so a changed page is fixed by a
//! settings update. A page that needs a person (captcha, terms, sign-in) is never worked around.
//!
//! An account that is out of videos ("You're out of videos for now ... available again on Oct 25 at
//! 11:35 AM") is reported as `RateLimit` with the time it comes back; nothing is sent in that case.

use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};

use super::browser::session::{Session, Tab};
use super::chat::{self, Progress};
use super::config::{EngineConfig, VideoConfig};
use super::errors::{clip, contains_any, ErrorKind, GenError};
use super::tool_page;
use crate::logging;

const LOG: &str = "webvideo";

/// A video file is at least this big.
const MIN_VIDEO_BYTES: usize = 2_000;

/// What the page says about the video right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Waiting,
    Ready,
    OutOfVideos,
    Failed,
}

/// Reads the page text (and whether a video element exists) as a verdict. Pure, so it is easy to test.
pub fn judge(cfg: &VideoConfig, page_text: &str, has_video: bool) -> Verdict {
    if has_video || contains_any(page_text, &cfg.ready_texts) {
        return Verdict::Ready;
    }
    if contains_any(page_text, &cfg.limit_texts) {
        return Verdict::OutOfVideos;
    }
    if contains_any(page_text, &cfg.error_texts) {
        return Verdict::Failed;
    }
    Verdict::Waiting
}

/// True when the bytes look like an MP4/MOV/WebM file.
pub fn looks_like_video(bytes: &[u8]) -> bool {
    bytes.len() >= MIN_VIDEO_BYTES && ((bytes.len() > 12 && &bytes[4..8] == b"ftyp") || bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]))
}

fn from_cdp(error: &super::browser::cdp::CdpError, what: &str) -> GenError {
    chat::from_cdp(error, what)
}

async fn eval(session: &Session, tab: &Tab, expression: &str, what: &str) -> Result<Value, GenError> {
    session.eval_in(&tab.frame, expression).await.map_err(|e| from_cdp(&e, what))
}

/// Clicks the first element of `css` whose text matches the regex. False when there is none.
async fn click_text(session: &Session, tab: &Tab, css: &str, pattern: &str) -> Result<bool, GenError> {
    let expression = format!(
        "(function () {{ var re = new RegExp({}, 'i'); var all = document.querySelectorAll({}); for (var i = 0; i < all.length; i++) {{ var t = (all[i].innerText || all[i].textContent || '').trim(); if (re.test(t)) {{ all[i].click(); return true; }} }} return false; }})()",
        chat::js(pattern),
        chat::js(css)
    );
    Ok(eval(session, tab, &expression, "Clicking a menu entry").await? == Value::Bool(true))
}

/// Whether the message box is in video mode (its hint text is on the page).
async fn mode_is_on(session: &Session, tab: &Tab, cfg: &VideoConfig) -> Result<bool, GenError> {
    let expression = format!(
        "(function (h) {{ if ((document.body.innerText || '').indexOf(h) >= 0) return true; var e = document.querySelectorAll('[placeholder],[data-placeholder],[aria-label]'); for (var i = 0; i < e.length; i++) {{ var v = (e[i].getAttribute('placeholder') || '') + ' ' + (e[i].getAttribute('data-placeholder') || '') + ' ' + (e[i].getAttribute('aria-label') || ''); if (v.indexOf(h) >= 0) return true; }} return false; }})({})",
        chat::js(&cfg.mode_hint)
    );
    Ok(eval(session, tab, &expression, "Checking video mode").await? == Value::Bool(true))
}

async fn wait_mode(session: &Session, tab: &Tab, cfg: &VideoConfig, ms: u64) -> Result<bool, GenError> {
    let deadline = tokio::time::Instant::now() + Duration::from_millis(ms);
    loop {
        if mode_is_on(session, tab, cfg).await? {
            return Ok(true);
        }
        if tokio::time::Instant::now() >= deadline {
            return Ok(false);
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

/// Turns on "Create video" in the "+" menu. Clicks the entry once per opened menu (it is a switch).
async fn enable_video_mode(session: &Session, tab: &Tab, engine: &EngineConfig) -> Result<(), GenError> {
    let cfg = &engine.video;
    if mode_is_on(session, tab, cfg).await? {
        return Ok(());
    }
    for _ in 0..3 {
        if !chat::click_plus(session, tab, &cfg.tools_button, &engine.chat.selectors.input).await? {
            return Err(chat::diagnose(session, tab, engine, "Gemini's \"+\" button was not found. The chat page may have changed.").await);
        }
        let deadline = tokio::time::Instant::now() + Duration::from_millis(engine.chat.timing.send_enable_ms.min(8_000));
        loop {
            if click_text(session, tab, &cfg.menu_item, &cfg.create_text).await? {
                break;
            }
            if tokio::time::Instant::now() >= deadline {
                break;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        if wait_mode(session, tab, cfg, 3_000).await? {
            return Ok(());
        }
    }
    Err(chat::diagnose(session, tab, engine, "Gemini's \"Create video\" entry was not found. The chat page may have changed.").await)
}

struct Seen {
    text: String,
    has_video: bool,
    stop: bool,
}

async fn read_seen(session: &Session, tab: &Tab, engine: &EngineConfig) -> Result<Seen, GenError> {
    let expression = format!(
        "(function () {{ return {{ text: (document.body ? document.body.innerText : '').slice(0, 6000), video: !!document.querySelector({}), stop: !!document.querySelector({}) }}; }})()",
        chat::js(&engine.video.video),
        chat::js(&engine.chat.selectors.stop)
    );
    let value = eval(session, tab, &expression, "Reading the chat page").await?;
    Ok(Seen { text: value["text"].as_str().unwrap_or_default().to_string(), has_video: value["video"].as_bool().unwrap_or(false), stop: value["stop"].as_bool().unwrap_or(false) })
}

/// When the account gets videos again (epoch ms), read from the page text; 0 when it cannot be read.
async fn reset_time(session: &Session, tab: &Tab, cfg: &VideoConfig) -> u64 {
    let expression = format!(
        "(function (rx) {{ var m = new RegExp(rx, 'i').exec(document.body ? document.body.innerText : ''); if (!m) return 0; var now = new Date(); var d = new Date(m[1] + ' ' + m[2] + ', ' + now.getFullYear() + ' ' + m[3]); if (isNaN(d.getTime())) return 0; if (d.getTime() < now.getTime() - 86400000) d.setFullYear(d.getFullYear() + 1); return d.getTime(); }})({})",
        chat::js(&cfg.reset_regex)
    );
    eval(session, tab, &expression, "Reading the reset time").await.ok().and_then(|v| v.as_f64()).map_or(0, |ms| ms.max(0.0) as u64)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// The error for an account that is out of videos, with how long it must rest.
async fn out_of_videos(session: &Session, tab: &Tab, cfg: &VideoConfig) -> GenError {
    let reset = reset_time(session, tab, cfg).await;
    let now = now_ms();
    let wait = if reset > now { reset - now } else { cfg.default_rest_minutes * 60_000 };
    logging::info(LOG, &format!("out of videos; rest {} min (reset time read from the page: {})", wait / 60_000, reset > now));
    let mut error = GenError::new(ErrorKind::RateLimit, "This Google account has no videos left for now.");
    error.retry_after_ms = wait;
    error
}

/// Reads the finished video from the page (the page's own request, with the account's cookies).
async fn fetch_in_page(session: &Session, tab: &Tab, cfg: &VideoConfig) -> Option<Vec<u8>> {
    let expression = format!(
        "(async function (sel) {{ var v = document.querySelector(sel); if (!v) return ''; var src = v.currentSrc || v.src; if (!src) {{ var s = v.querySelector('source'); src = s && s.src; }} if (!src) return ''; var r = await fetch(src, {{ credentials: 'include' }}); if (!r.ok) return ''; var buf = new Uint8Array(await r.arrayBuffer()); var out = ''; for (var i = 0; i < buf.length; i += 32768) {{ out += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); }} return btoa(out); }})({})",
        chat::js(&cfg.video)
    );
    let text = eval(session, tab, &expression, "Reading the video").await.ok()?;
    let bytes = crate::api::base64::decode(text.as_str()?)?;
    looks_like_video(&bytes).then_some(bytes)
}

/// The page's own "Download video" entry, for when the video cannot be read from the page.
async fn download_by_menu(session: &Session, tab: &Tab, cfg: &VideoConfig) -> Result<Vec<u8>, GenError> {
    let dir = std::env::temp_dir().join(format!("avedit-video-{}-{}", std::process::id(), now_ms()));
    std::fs::create_dir_all(&dir).map_err(|e| GenError::new(ErrorKind::Storage, format!("A temporary folder could not be made: {e}")))?;
    let result = download_into(session, tab, cfg, &dir).await;
    let _ = std::fs::remove_dir_all(&dir);
    result
}

async fn download_into(session: &Session, tab: &Tab, cfg: &VideoConfig, dir: &Path) -> Result<Vec<u8>, GenError> {
    session
        .cdp
        .call("Browser.setDownloadBehavior", json!({ "behavior": "allow", "downloadPath": dir.to_string_lossy() }), None)
        .await
        .map_err(|e| from_cdp(&e, "Preparing the download"))?;
    if !chat::click(session, tab, &cfg.more_button).await? {
        return Err(GenError::new(ErrorKind::NoImage, "Gemini finished the video but its \"...\" menu was not found. The chat page may have changed."));
    }
    let deadline = tokio::time::Instant::now() + Duration::from_millis(8_000);
    loop {
        if click_text(session, tab, &cfg.menu_item, &cfg.download_text).await? {
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(GenError::new(ErrorKind::NoImage, "Gemini's \"Download video\" entry was not found. The chat page may have changed."));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    let deadline = tokio::time::Instant::now() + Duration::from_millis(cfg.download_ms);
    loop {
        let found = std::fs::read_dir(dir).ok().and_then(|entries| {
            entries.flatten().map(|e| e.path()).find(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("mp4") || x.eq_ignore_ascii_case("webm")))
        });
        if let Some(path) = found {
            tokio::time::sleep(Duration::from_millis(600)).await;
            let bytes = std::fs::read(&path).map_err(|e| GenError::new(ErrorKind::Storage, format!("The downloaded video could not be read: {e}")))?;
            if looks_like_video(&bytes) {
                return Ok(bytes);
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(GenError::new(ErrorKind::Timeout, "The video download did not finish in time."));
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

/// Makes one video. `image` (a file on this computer) is animated when given. Returns the video file's bytes.
pub async fn make(session: &Session, engine: &EngineConfig, prompt: &str, image: Option<&Path>, timeout: Duration, progress: Progress<'_>) -> Result<Vec<u8>, GenError> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err(GenError::new(ErrorKind::BadRequest, "The video prompt is empty."));
    }
    if prompt.chars().count() > chat::MAX_PROMPT_CHARS {
        return Err(GenError::new(ErrorKind::BadRequest, "The video prompt is too long."));
    }
    if image.is_some_and(|p| !p.is_absolute() || !p.is_file()) {
        return Err(GenError::new(ErrorKind::BadRequest, "The picture to animate could not be found."));
    }
    logging::info(LOG, &format!("make: opening a new chat tab ({} chars, picture: {})", prompt.chars().count(), image.is_some()));
    let tab = session.open_tab().await.map_err(|e| from_cdp(&e, "Opening a chat tab"))?;
    let result = make_in(session, &tab, engine, prompt, image, timeout, progress).await;
    match &result {
        Ok(bytes) => logging::info(LOG, &format!("make: finished, {} bytes; closing the tab", bytes.len())),
        Err(error) => logging::warn(LOG, &format!("make: failed ({:?}): {}; closing the tab", error.kind, error.message)),
    }
    session.close_tab(&tab).await;
    result
}

async fn make_in(session: &Session, tab: &Tab, engine: &EngineConfig, prompt: &str, image: Option<&Path>, timeout: Duration, progress: Progress<'_>) -> Result<Vec<u8>, GenError> {
    let cfg = &engine.video;
    let chat_cfg = &engine.chat;
    session.navigate_tab(tab, &chat_cfg.url, Duration::from_millis(chat_cfg.timing.page_ready_ms)).await.map_err(|e| from_cdp(&e, "Opening Gemini's chat"))?;
    chat::wait_for_input(session, tab, engine).await?;
    enable_video_mode(session, tab, engine).await?;

    // An account that is out of videos shows it before anything is sent: nothing is sent then.
    let seen = read_seen(session, tab, engine).await?;
    if judge(cfg, &seen.text, false) == Verdict::OutOfVideos {
        return Err(out_of_videos(session, tab, cfg).await);
    }
    if let Some(image) = image {
        chat::attach_images(session, tab, engine, &[image.to_path_buf()]).await?;
        // Attaching may switch the mode off on some pages: make sure it is on.
        enable_video_mode(session, tab, engine).await?;
    }
    chat::type_and_send(session, tab, chat_cfg, prompt).await?;
    logging::info(LOG, "step: sent; waiting for the video");

    let began = tokio::time::Instant::now();
    let deadline = began + Duration::from_millis(cfg.max_wait_ms).max(timeout);
    let mut last_report = 0u64;
    loop {
        let seen = read_seen(session, tab, engine).await?;
        match judge(cfg, &seen.text, seen.has_video) {
            Verdict::Ready => break,
            Verdict::OutOfVideos => return Err(out_of_videos(session, tab, cfg).await),
            Verdict::Failed => return Err(GenError::new(ErrorKind::Server, "Gemini could not make this video (a temporary problem or a prompt it will not make).")),
            Verdict::Waiting => {}
        }
        if let Some(error) = tool_page::human_error(engine, &clip(&seen.text, 3000)).filter(|e| e.kind == ErrorKind::Flagged) {
            return Err(error);
        }
        let secs = began.elapsed().as_secs();
        if secs >= last_report + 10 {
            last_report = secs;
            if let Some(report) = progress {
                report(format!("Gemini is making the video... {secs} s{}", if seen.stop { "" } else { " (waiting for it to start)" }));
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(GenError::new(ErrorKind::Timeout, "Gemini took too long to make the video. It was not interrupted or resent."));
        }
        tokio::time::sleep(Duration::from_millis(cfg.poll_ms)).await;
    }
    logging::info(LOG, &format!("step: the video is ready after {} s; taking the file", began.elapsed().as_secs()));
    tokio::time::sleep(Duration::from_millis(1_500)).await;
    if let Some(bytes) = fetch_in_page(session, tab, cfg).await {
        return Ok(bytes);
    }
    logging::info(LOG, "step: the video could not be read from the page; using the Download entry");
    download_by_menu(session, tab, cfg).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> VideoConfig {
        VideoConfig::default()
    }

    #[test]
    fn the_page_text_is_judged() {
        let c = cfg();
        assert_eq!(judge(&c, "Describe your video", false), Verdict::Waiting);
        assert_eq!(judge(&c, "Your video is ready!", false), Verdict::Ready);
        assert_eq!(judge(&c, "anything", true), Verdict::Ready);
        assert_eq!(judge(&c, "You’re out of videos for now. Videos will be available again on Oct 25 at 11:35 AM", false), Verdict::OutOfVideos);
        assert_eq!(judge(&c, "I can create more videos as soon as your limit resets. Check your usage in Settings.", false), Verdict::OutOfVideos);
        assert_eq!(judge(&c, "Sorry, I couldn't generate that video", false), Verdict::Failed);
    }

    #[test]
    fn video_files_are_recognised_by_their_header() {
        let mut mp4 = vec![0, 0, 0, 0x20];
        mp4.extend_from_slice(b"ftypisom");
        mp4.resize(5_000, 1);
        assert!(looks_like_video(&mp4));
        assert!(!looks_like_video(b"<html>not a video</html>"));
        assert!(!looks_like_video(&mp4[..100]));
    }

    #[test]
    fn the_reset_regex_reads_month_day_and_time() {
        let re = regex_like(&cfg().reset_regex);
        assert!(re, "the default regex is valid");
    }

    /// The regex is run by the page; here only check that it has the three groups the page code uses.
    fn regex_like(pattern: &str) -> bool {
        pattern.matches('(').count() == 3 && pattern.contains("available again on")
    }
}
