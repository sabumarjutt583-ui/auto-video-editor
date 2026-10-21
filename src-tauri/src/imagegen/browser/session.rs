//! One automation browser on one account profile: start (or re-attach to) the user's browser with a
//! DevTools port, keep one work tab, find the tool's iframe, take a snapshot, show/hide the window, stop.
//!
//! The browser is started honestly: its own user agent, no switches that hide automation.
//! Headless mode is `--headless=new`; if Google does not accept the session that way, the caller
//! switches to a minimized normal window (`Mode::Window`).

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use super::cdp::{Cdp, CdpError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// No window (`--headless=new`).
    Hidden,
    /// A normal window, minimized.
    Window,
}

#[derive(Debug, Clone)]
pub struct Launch {
    pub exe: PathBuf,
    pub profile: PathBuf,
    pub mode: Mode,
    /// Only for tests (for example `--no-sandbox` when running as root in a container).
    pub extra_args: Vec<String>,
}

/// A frame the page can be driven in: its own session (a separate process) or an execution context
/// of the page session (same process).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub session: String,
    pub context_id: Option<i64>,
}

/// An extra tab (its own DevTools session) in the account's browser.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tab {
    pub target: String,
    pub frame: Frame,
}

pub struct Session {
    pub cdp: Cdp,
    child: Mutex<Option<Child>>,
    pub profile: PathBuf,
    pub page_target: String,
    pub page_session: String,
}

pub fn launch_args(launch: &Launch) -> Vec<String> {
    let mut args = vec![
        format!("--user-data-dir={}", launch.profile.display()),
        "--remote-debugging-port=0".to_string(),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        // A hidden or covered tab must keep running at full speed.
        "--disable-background-timer-throttling".to_string(),
        "--disable-backgrounding-occluded-windows".to_string(),
        "--disable-renderer-backgrounding".to_string(),
        "--disable-features=CalculateNativeWinOcclusion".to_string(),
        "--window-size=1400,1000".to_string(),
    ];
    if launch.mode == Mode::Hidden {
        args.push("--headless=new".to_string());
    }
    args.extend(launch.extra_args.iter().cloned());
    args.push("about:blank".to_string());
    args
}

/// `DevToolsActivePort`: first line the port, second line the browser's WebSocket path.
pub fn parse_active_port(text: &str) -> Option<(u16, String)> {
    let mut lines = text.lines();
    let port = lines.next()?.trim().parse::<u16>().ok().filter(|p| *p > 0)?;
    let path = lines.next()?.trim().to_string();
    path.starts_with('/').then_some((port, path))
}

fn active_port_file(profile: &Path) -> PathBuf {
    profile.join("DevToolsActivePort")
}

async fn reachable(port: u16) -> bool {
    matches!(tokio::time::timeout(Duration::from_millis(600), tokio::net::TcpStream::connect(("127.0.0.1", port))).await, Ok(Ok(_)))
}

fn session_error(error: impl std::fmt::Display) -> CdpError {
    CdpError::Other(error.to_string())
}

impl Session {
    /// Starts the browser on the profile, or attaches to one an earlier run left open.
    pub async fn open(launch: &Launch) -> Result<Self, CdpError> {
        std::fs::create_dir_all(&launch.profile).map_err(session_error)?;
        let file = active_port_file(&launch.profile);
        if let Some((port, path)) = std::fs::read_to_string(&file).ok().and_then(|t| parse_active_port(&t)) {
            if reachable(port).await {
                if let Ok(cdp) = Cdp::connect(port, &path).await {
                    return Self::with_tab(cdp, None, &launch.profile).await;
                }
            }
        }
        let _ = std::fs::remove_file(&file);

        let mut command = Command::new(&launch.exe);
        command.args(launch_args(launch)).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).kill_on_drop(false);
        let mut child = command.spawn().map_err(|e| session_error(format!("The browser could not be started: {e}")))?;

        let mut found = None;
        for _ in 0..200 {
            if let Some(found_port) = std::fs::read_to_string(&file).ok().and_then(|t| parse_active_port(&t)) {
                found = Some(found_port);
                break;
            }
            if let Ok(Some(status)) = child.try_wait() {
                return Err(session_error(format!("The browser closed right after it started ({status}). The profile may already be open in another window.")));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let Some((port, path)) = found else {
            let _ = child.kill().await;
            return Err(CdpError::Timeout("the browser did not report its DevTools port".into()));
        };
        let cdp = match Cdp::connect(port, &path).await {
            Ok(cdp) => cdp,
            Err(error) => {
                let _ = child.kill().await;
                return Err(error);
            }
        };
        Self::with_tab(cdp, Some(child), &launch.profile).await
    }

    async fn with_tab(cdp: Cdp, child: Option<Child>, profile: &Path) -> Result<Self, CdpError> {
        let targets = cdp.call("Target.getTargets", json!({}), None).await?;
        let pages: Vec<String> = targets["targetInfos"]
            .as_array()
            .map(|list| list.iter().filter(|t| t["type"] == "page").filter_map(|t| t["targetId"].as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        let target = match pages.split_first() {
            Some((first, extra)) => {
                // One work tab per account: close any other tab.
                for id in extra {
                    let _ = cdp.call("Target.closeTarget", json!({ "targetId": id }), None).await;
                }
                first.clone()
            }
            None => cdp.call("Target.createTarget", json!({ "url": "about:blank" }), None).await?["targetId"].as_str().unwrap_or_default().to_string(),
        };
        let attached = cdp.call("Target.attachToTarget", json!({ "targetId": target, "flatten": true }), None).await?;
        let session = attached["sessionId"].as_str().ok_or_else(|| session_error("the browser gave no tab session"))?.to_string();
        cdp.call("Page.enable", json!({}), Some(&session)).await?;
        Ok(Self { cdp, child: Mutex::new(child), profile: profile.to_path_buf(), page_target: target, page_session: session })
    }

    /// Goes to `url` and waits until the document is loaded (or `timeout` passes).
    pub async fn navigate(&self, url: &str, timeout: Duration) -> Result<(), CdpError> {
        self.navigate_on(&self.page_session, url, timeout).await
    }

    /// Opens an extra tab in the same browser (the chat uses one, so the image tool page stays untouched).
    pub async fn open_tab(&self) -> Result<Tab, CdpError> {
        let created = self.cdp.call("Target.createTarget", json!({ "url": "about:blank" }), None).await?;
        let target = created["targetId"].as_str().ok_or_else(|| session_error("the browser opened no tab"))?.to_string();
        let attached = self.cdp.call("Target.attachToTarget", json!({ "targetId": target, "flatten": true }), None).await?;
        let session = attached["sessionId"].as_str().ok_or_else(|| session_error("the browser gave no tab session"))?.to_string();
        self.cdp.call("Page.enable", json!({}), Some(&session)).await?;
        Ok(Tab { target, frame: Frame { session, context_id: None } })
    }

    pub async fn close_tab(&self, tab: &Tab) {
        let _ = self.cdp.call("Target.closeTarget", json!({ "targetId": tab.target }), None).await;
    }

    pub async fn navigate_tab(&self, tab: &Tab, url: &str, timeout: Duration) -> Result<(), CdpError> {
        self.navigate_on(&tab.frame.session, url, timeout).await
    }

    async fn navigate_on(&self, session: &str, url: &str, timeout: Duration) -> Result<(), CdpError> {
        let result = self.cdp.call_with_timeout("Page.navigate", json!({ "url": url }), Some(session), timeout).await?;
        if let Some(error) = result["errorText"].as_str().filter(|e| !e.is_empty()) {
            return Err(CdpError::Other(error.to_string()));
        }
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let state = self.cdp.evaluate(session, "document.readyState").await.unwrap_or(Value::Null);
            if state == "complete" || state == "interactive" {
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(CdpError::Timeout(format!("loading {url}")));
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }

    pub async fn eval(&self, expression: &str) -> Result<Value, CdpError> {
        self.cdp.evaluate(&self.page_session, expression).await
    }

    pub async fn eval_in(&self, frame: &Frame, expression: &str) -> Result<Value, CdpError> {
        self.cdp.evaluate_in(&frame.session, frame.context_id, expression).await
    }

    /// Every frame the page could be driven in: the tab itself, cross-site iframes (own processes, found
    /// as `iframe` targets) and, for frames in the same process, an isolated world per frame.
    pub async fn frames(&self) -> Result<Vec<Frame>, CdpError> {
        let mut frames = vec![Frame { session: self.page_session.clone(), context_id: None }];
        let targets = self.cdp.call("Target.getTargets", json!({}), None).await?;
        for info in targets["targetInfos"].as_array().into_iter().flatten() {
            if info["type"] != "iframe" {
                continue;
            }
            let Some(id) = info["targetId"].as_str() else { continue };
            let attached = self.cdp.call("Target.attachToTarget", json!({ "targetId": id, "flatten": true }), None).await;
            if let Some(session) = attached.ok().and_then(|a| a["sessionId"].as_str().map(str::to_string)) {
                frames.push(Frame { session, context_id: None });
            }
        }
        if let Ok(tree) = self.cdp.call("Page.getFrameTree", json!({}), Some(&self.page_session)).await {
            let mut ids = Vec::new();
            collect_child_frames(&tree["frameTree"], &mut ids, true);
            for frame_id in ids {
                let world = self.cdp.call("Page.createIsolatedWorld", json!({ "frameId": frame_id, "worldName": "auto-editor" }), Some(&self.page_session)).await;
                if let Some(context) = world.ok().and_then(|w| w["executionContextId"].as_i64()) {
                    frames.push(Frame { session: self.page_session.clone(), context_id: Some(context) });
                }
            }
        }
        Ok(frames)
    }

    /// The first frame where `expression` is true (for example `!!document.querySelector('#x')`).
    pub async fn find_frame(&self, expression: &str) -> Result<Option<Frame>, CdpError> {
        for frame in self.frames().await? {
            if self.eval_in(&frame, expression).await.is_ok_and(|v| v == Value::Bool(true)) {
                return Ok(Some(frame));
            }
        }
        Ok(None)
    }

    /// A JPEG of the work tab for the "Show background browser" view. Does not touch the page.
    pub async fn snapshot(&self) -> Result<Vec<u8>, CdpError> {
        let shot = self.cdp.call("Page.captureScreenshot", json!({ "format": "jpeg", "quality": 60 }), Some(&self.page_session)).await?;
        shot["data"].as_str().and_then(crate::api::base64::decode).ok_or_else(|| session_error("no screenshot"))
    }

    /// Brings the window to the front (only a normal window has one).
    pub async fn show(&self) -> Result<(), CdpError> {
        self.set_window_state("normal").await?;
        self.cdp.call("Page.bringToFront", json!({}), Some(&self.page_session)).await.map(|_| ())
    }

    pub async fn minimize(&self) -> Result<(), CdpError> {
        self.set_window_state("minimized").await
    }

    async fn set_window_state(&self, state: &str) -> Result<(), CdpError> {
        let window = self.cdp.call("Browser.getWindowForTarget", json!({ "targetId": self.page_target }), None).await?;
        let id = window["windowId"].as_i64().ok_or_else(|| session_error("no window"))?;
        self.cdp.call("Browser.setWindowBounds", json!({ "windowId": id, "bounds": { "windowState": state } }), None).await.map(|_| ())
    }

    /// Closes the browser: politely over DevTools, then by force after four seconds.
    pub async fn stop(&self) {
        let _ = self.cdp.call_with_timeout("Browser.close", json!({}), None, Duration::from_secs(4)).await;
        self.cdp.close().await;
        if let Some(mut child) = self.child.lock().await.take() {
            if tokio::time::timeout(Duration::from_secs(4), child.wait()).await.is_err() {
                let _ = child.kill().await;
                let _ = child.wait().await;
            }
        }
        let _ = std::fs::remove_file(active_port_file(&self.profile));
    }
}

fn collect_child_frames(node: &Value, out: &mut Vec<String>, is_root: bool) {
    if !is_root {
        if let Some(id) = node["frame"]["id"].as_str() {
            out.push(id.to_string());
        }
    }
    for child in node["childFrames"].as_array().into_iter().flatten() {
        collect_child_frames(child, out, false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_active_port_file() {
        assert_eq!(parse_active_port("43211\n/devtools/browser/abc-123\n"), Some((43211, "/devtools/browser/abc-123".into())));
        assert_eq!(parse_active_port("0\n/devtools/browser/x"), None);
        assert_eq!(parse_active_port("abc\n/x"), None);
        assert_eq!(parse_active_port("123"), None);
        assert_eq!(parse_active_port("123\nno-slash"), None);
    }

    #[test]
    fn launch_arguments_are_honest_and_mode_dependent() {
        let launch = Launch { exe: "chrome".into(), profile: "/p/acc1".into(), mode: Mode::Hidden, extra_args: vec!["--no-sandbox".into()] };
        let args = launch_args(&launch);
        assert!(args.contains(&"--user-data-dir=/p/acc1".to_string()));
        assert!(args.contains(&"--remote-debugging-port=0".to_string()));
        assert!(args.contains(&"--headless=new".to_string()));
        assert_eq!(args.last().map(String::as_str), Some("about:blank"));
        let text = args.join(" ").to_lowercase();
        for hiding in ["user-agent", "automationcontrolled", "enable-automation", "webdriver", "disable-blink-features"] {
            assert!(!text.contains(hiding), "{hiding} would hide the automation");
        }
        let window = launch_args(&Launch { mode: Mode::Window, ..launch });
        assert!(!window.iter().any(|a| a.starts_with("--headless")));
    }

    #[test]
    fn child_frames_are_collected_without_the_root() {
        let tree = json!({ "frame": { "id": "root" }, "childFrames": [ { "frame": { "id": "a" }, "childFrames": [ { "frame": { "id": "b" } } ] }, { "frame": { "id": "c" } } ] });
        let mut ids = Vec::new();
        collect_child_frames(&tree, &mut ids, true);
        assert_eq!(ids, ["a", "b", "c"]);
    }
}
