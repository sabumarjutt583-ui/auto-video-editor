//! Draws a motion graphic frame by frame in a throw-away browser: no account, no network, a transparent
//! page of the exact video size. Before the real frames are drawn, three test frames are checked, so a
//! broken or empty graphic is found in seconds and can be sent back to the AI.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};

use super::png::{coverage, verdict, Coverage};
use crate::commands::error::AppError;
use crate::imagegen::browser::cdp::CdpError;
use crate::imagegen::browser::session::{Launch, Mode, Session};
use crate::jobs::Job;

pub struct CaptureSpec {
    pub exe: PathBuf,
    /// Only for tests (for example `--no-sandbox` when running as root).
    pub extra_args: Vec<String>,
    /// The wrapped page (see `contract::wrap_html`).
    pub html: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub seconds: f64,
    /// Where `frames/00000.png ...` are written. `None` = only check the graphic.
    pub out_dir: Option<PathBuf>,
}

#[derive(Debug)]
pub enum CaptureError {
    /// The graphic is wrong. The text is written for the AI, so it can fix it.
    Problem(String),
    /// Something on this computer failed (the browser, the disk). Not the AI's fault.
    Failed(AppError),
}

fn failed(message: &str, details: impl std::fmt::Display) -> CaptureError {
    CaptureError::Failed(AppError::new(message, details.to_string()))
}

fn browser_error(error: &CdpError) -> CaptureError {
    failed("The motion graphic could not be drawn (the browser stopped).", error)
}

pub fn frame_count(seconds: f64, fps: u32) -> u32 {
    (seconds * f64::from(fps)).round().max(1.0) as u32
}

pub fn frame_name(index: u32) -> String {
    format!("{index:05}.png")
}

/// `file:///...` for a local path (spaces and non-ASCII letters escaped).
pub fn file_url(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    let mut out = String::from("file://");
    if !text.starts_with('/') {
        out.push('/');
    }
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~' | b'/' | b':') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Sets the page to time `t` (seconds): `renderFrame(t)` when the graphic has it, and every CSS, Web
/// Animations or SVG animation is frozen at `t`. Returns an error text, or "".
const FRAME_FN: &str = "window.__aveFrame = async function (t) { var err = ''; try { if (typeof window.renderFrame === 'function') window.renderFrame(t); } catch (e) { err = 'renderFrame(' + t.toFixed(2) + ') threw: ' + String((e && e.message) || e); } try { document.getAnimations().forEach(function (a) { a.pause(); a.currentTime = t * 1000; }); document.querySelectorAll('svg').forEach(function (s) { if (s.pauseAnimations) { s.pauseAnimations(); s.setCurrentTime(t); } }); } catch (e) {} await Promise.race([new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }), new Promise(function (r) { setTimeout(r, 300); })]); return err; }; true";

const ANIMATED: &str = "(typeof window.renderFrame === 'function') || document.getAnimations().length > 0 || document.querySelectorAll('animate,animateTransform,animateMotion,set').length > 0";

async fn screenshot(session: &Session) -> Result<Vec<u8>, CaptureError> {
    let shot = session.cdp.call("Page.captureScreenshot", json!({ "format": "png", "fromSurface": true, "captureBeyondViewport": false }), Some(&session.page_session)).await.map_err(|e| browser_error(&e))?;
    shot["data"].as_str().and_then(crate::api::base64::decode).ok_or_else(|| failed("The motion graphic could not be drawn.", "the browser returned no screenshot"))
}

async fn set_time(session: &Session, t: f64) -> Result<(), CaptureError> {
    let message = session.eval(&format!("window.__aveFrame({t})")).await.map_err(|e| match e {
        CdpError::Script(text) => CaptureError::Problem(format!("The page threw an error: {text}")),
        other => browser_error(&other),
    })?;
    match message.as_str().filter(|m| !m.is_empty()) {
        Some(text) => Err(CaptureError::Problem(text.to_string())),
        None => Ok(()),
    }
}

/// Opens the offline page and checks it with three test frames.
async fn open_and_check(session: &Session, spec: &CaptureSpec, page: &Path) -> Result<(), CaptureError> {
    let call = |method: &'static str, params: Value| async move { session.cdp.call(method, params, Some(&session.page_session)).await.map_err(|e| browser_error(&e)) };
    call("Emulation.setDeviceMetricsOverride", json!({ "width": spec.width, "height": spec.height, "deviceScaleFactor": 1, "mobile": false })).await?;
    call("Emulation.setDefaultBackgroundColorOverride", json!({ "color": { "r": 0, "g": 0, "b": 0, "a": 0 } })).await?;
    call("Network.enable", json!({})).await?;
    call("Network.emulateNetworkConditions", json!({ "offline": true, "latency": 0, "downloadThroughput": 0, "uploadThroughput": 0 })).await?;
    session.navigate(&file_url(page), Duration::from_secs(20)).await.map_err(|e| browser_error(&e))?;
    session.eval(FRAME_FN).await.map_err(|e| browser_error(&e))?;

    let errors = session.eval("(window.__errors || []).join(' | ')").await.map_err(|e| browser_error(&e))?;
    if let Some(text) = errors.as_str().filter(|t| !t.is_empty()) {
        return Err(CaptureError::Problem(format!("The page has a script error: {text}")));
    }
    if session.eval(ANIMATED).await.map_err(|e| browser_error(&e))? != Value::Bool(true) {
        return Err(CaptureError::Problem("Nothing is animated: there is no window.renderFrame function and no CSS @keyframes or SVG animation.".into()));
    }
    let mut shots = Vec::new();
    let mut seen: Vec<Coverage> = Vec::new();
    for t in [0.0, spec.seconds * 0.5, spec.seconds * 0.85] {
        set_time(session, t).await?;
        let png = screenshot(session).await?;
        seen.push(coverage(&png).map_err(|e| failed("The motion graphic could not be checked.", e))?);
        shots.push(png);
    }
    if let Some(message) = verdict(&seen) {
        return Err(CaptureError::Problem(message.to_string()));
    }
    if shots.windows(2).all(|pair| pair[0] == pair[1]) {
        return Err(CaptureError::Problem("The graphic does not move: the frames at the start, middle and end are identical.".into()));
    }
    let late_errors = session.eval("(window.__errors || []).join(' | ')").await.map_err(|e| browser_error(&e))?;
    if let Some(text) = late_errors.as_str().filter(|t| !t.is_empty()) {
        return Err(CaptureError::Problem(format!("The page has a script error: {text}")));
    }
    Ok(())
}

async fn draw_all(session: &Session, spec: &CaptureSpec, job: Option<&Job>, progress: &(dyn Fn(u32, u32) + Sync)) -> Result<u32, CaptureError> {
    let Some(out) = spec.out_dir.as_deref() else { return Ok(0) };
    let temporary = out.join("frames.tmp");
    let _ = std::fs::remove_dir_all(&temporary);
    std::fs::create_dir_all(&temporary).map_err(|e| failed("The frames folder could not be made.", e))?;
    let total = frame_count(spec.seconds, spec.fps);
    for index in 0..total {
        if let Some(job) = job {
            job.check().map_err(CaptureError::Failed)?;
        }
        set_time(session, f64::from(index) / f64::from(spec.fps)).await?;
        let png = screenshot(session).await?;
        std::fs::write(temporary.join(frame_name(index)), png).map_err(|e| failed("A frame could not be saved.", e))?;
        progress(index + 1, total);
    }
    let frames = out.join("frames");
    let _ = std::fs::remove_dir_all(&frames);
    std::fs::rename(&temporary, &frames).map_err(|e| failed("The frames could not be saved.", e))?;
    Ok(total)
}

/// Checks the graphic and, when `out_dir` is set, draws all frames. Returns the number of frames.
pub async fn draw(spec: &CaptureSpec, job: Option<&Job>, progress: &(dyn Fn(u32, u32) + Sync)) -> Result<u32, CaptureError> {
    let work = std::env::temp_dir().join(format!("ave-motion-{}-{:x}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos())));
    std::fs::create_dir_all(&work).map_err(|e| failed("A temporary folder could not be made.", e))?;
    let page = work.join("page.html");
    std::fs::write(&page, &spec.html).map_err(|e| failed("The graphic could not be written.", e))?;
    let launch = Launch { exe: spec.exe.clone(), profile: work.join("profile"), mode: Mode::Hidden, extra_args: spec.extra_args.clone() };
    let result = match Session::open(&launch).await {
        Ok(session) => {
            let result = match open_and_check(&session, spec, &page).await {
                Ok(()) => draw_all(&session, spec, job, progress).await,
                Err(error) => Err(error),
            };
            session.stop().await;
            result
        }
        Err(error) => Err(failed("The browser for the motion graphic could not be started.", error)),
    };
    let _ = std::fs::remove_dir_all(&work);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::imagegen::testserver::{temp_dir, test_args, test_browser};
    use crate::motion::contract::wrap_html;

    fn spec(html: &str, out: Option<PathBuf>) -> Option<CaptureSpec> {
        let exe = test_browser().or_else(|| {
            eprintln!("skipped: no Chromium found (set AVE_TEST_CHROME)");
            None
        })?;
        Some(CaptureSpec { exe, extra_args: test_args(), html: wrap_html(html, 320, 180), width: 320, height: 180, fps: 10, seconds: 1.0, out_dir: out })
    }

    const GOOD_CSS: &str = "<html><body><div id=b style=\"position:absolute;left:20px;top:20px;width:80px;height:40px;background:#e94560;animation:go 1s both\"></div><style>@keyframes go{from{transform:translateX(0)}to{transform:translateX(150px)}}</style></body></html>";

    #[test]
    fn file_urls_escape_spaces_and_keep_drive_letters() {
        assert_eq!(file_url(Path::new("/tmp/a b/c.html")), "file:///tmp/a%20b/c.html");
        assert_eq!(file_url(Path::new("C:\\Users\\Sa Mu\\p.html")), "file:///C:/Users/Sa%20Mu/p.html");
    }

    #[test]
    fn frames_are_counted_and_named_in_order() {
        assert_eq!(frame_count(3.0, 30), 90);
        assert_eq!(frame_count(0.01, 30), 1);
        assert_eq!(frame_name(7), "00007.png");
    }

    #[tokio::test]
    async fn a_css_animation_is_drawn_frame_by_frame_with_transparency() {
        let out = temp_dir("motion-ok");
        let Some(spec) = spec(GOOD_CSS, Some(out.clone())) else { return };
        let done = std::sync::atomic::AtomicU32::new(0);
        let frames = draw(&spec, None, &|n, _| done.store(n, std::sync::atomic::Ordering::SeqCst)).await.expect("draws");
        assert_eq!((frames, done.load(std::sync::atomic::Ordering::SeqCst)), (10, 10));
        let first = std::fs::read(out.join("frames").join("00000.png")).unwrap();
        let last = std::fs::read(out.join("frames").join("00009.png")).unwrap();
        assert_ne!(first, last, "the box moves between the first and the last frame");
        let c = coverage(&first).unwrap();
        assert!(c.drawn > 0.01 && c.drawn < 0.5 && c.solid > 0.01, "a small box on a transparent page: {c:?}");
        assert!(!out.join("frames.tmp").exists());
        let _ = std::fs::remove_dir_all(out);
    }

    #[tokio::test]
    async fn render_frame_graphics_are_drawn_too() {
        let html = "<html><body><canvas id=c width=320 height=180></canvas><script>var x=document.getElementById('c').getContext('2d');window.renderFrame=function(t){x.clearRect(0,0,320,180);x.fillStyle='#38f';x.fillRect(10+t*100,40,50,50);};</script></body></html>";
        let Some(spec) = spec(html, None) else { return };
        assert_eq!(draw(&spec, None, &|_, _| {}).await.expect("check only").min(1), 0, "without an output folder only the check runs");
    }

    async fn problem(html: &str) -> String {
        let Some(spec) = spec(html, None) else { return "skipped".into() };
        match draw(&spec, None, &|_, _| {}).await {
            Err(CaptureError::Problem(text)) => text,
            other => panic!("expected a problem, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn broken_graphics_are_sent_back_with_a_reason() {
        let blank = problem("<html><body><style>@keyframes a{to{opacity:0}}</style><div style=\"animation:a 1s both\"></div></body></html>").await;
        assert!(blank == "skipped" || blank.contains("nothing") || blank.contains("drew nothing"), "{blank}");
        let cover = problem("<html><body><div style=\"position:absolute;inset:0;background:#000;animation:a 1s both\"></div><style>@keyframes a{from{opacity:.9}to{opacity:1}}</style></body></html>").await;
        assert!(cover == "skipped" || cover.contains("covers the screen"), "{cover}");
        let still = problem("<html><body><div style=\"width:50px;height:50px;background:red\"></div><script>window.renderFrame=function(t){}</script></body></html>").await;
        assert!(still == "skipped" || still.contains("does not move"), "{still}");
        let throws = problem("<html><body><script>window.renderFrame=function(t){ undefinedFunction(); }</script></body></html>").await;
        assert!(throws == "skipped" || throws.contains("threw"), "{throws}");
        let nothing = problem("<html><body><div style=\"width:50px;height:50px;background:red\"></div></body></html>").await;
        assert!(nothing == "skipped" || nothing.contains("Nothing is animated"), "{nothing}");
        let load_error = problem("<html><body><script>nope(;</script></body></html>").await;
        assert!(load_error == "skipped" || load_error.contains("script error"), "{load_error}");
    }

    #[tokio::test]
    async fn the_page_cannot_reach_the_network() {
        let html = "<html><body><div id=d style=\"width:60px;height:60px;background:#0c0\"></div><script>window.renderFrame=function(t){document.getElementById('d').style.marginLeft=(t*100)+'px'; if(!window.__tried){window.__tried=1; fetch('http://127.0.0.1:9/x').then(function(){window.__net='reached'}).catch(function(){window.__net='blocked'});}};</script></body></html>";
        let Some(spec) = spec(html, None) else { return };
        draw(&spec, None, &|_, _| {}).await.expect("the graphic itself is fine");
    }
}
