//! The sign-in window: the person's own browser on the account's profile folder, opened on Google's
//! normal sign-in page. It is a plain window: no debugging port, no automation switches, nothing that
//! hides anything. The person signs in and finishes any check (2-step verification) themselves.
//! The app never sees a password; Google's cookies stay in the profile folder.
//!
//! Windows: the window title is watched, and when it shows Gemini the window is closed politely so the
//! browser writes its cookies. Elsewhere the person closes the window or presses "I have signed in".

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::process::{Child, Command};

pub fn plain_args(profile: &Path, url: &str) -> Vec<String> {
    vec![format!("--user-data-dir={}", profile.display()), "--no-first-run".to_string(), "--no-default-browser-check".to_string(), url.to_string()]
}

#[cfg(any(windows, test))]
/// The window title out of `tasklist /v /fo csv /nh` output for one process (the last CSV field).
pub fn parse_tasklist_title(output: &str) -> Option<String> {
    let line = output.lines().map(str::trim).find(|l| l.starts_with('"'))?;
    let fields: Vec<&str> = line.trim_matches('"').split("\",\"").collect();
    let title = fields.last()?.trim();
    (fields.len() >= 9 && !title.is_empty() && title != "N/A").then(|| title.to_string())
}

pub struct PlainWindow {
    child: Child,
    pid: u32,
    started: tokio::time::Instant,
}

#[derive(Debug, PartialEq, Eq)]
pub enum WindowState {
    Open,
    /// Closed by the person (or by us) after at least a few seconds.
    Closed,
    /// Ended almost at once: the profile is probably open in another window already.
    EndedAtOnce,
}

impl PlainWindow {
    pub async fn open(exe: &Path, profile: &Path, url: &str) -> Result<Self, String> {
        std::fs::create_dir_all(profile).map_err(|e| e.to_string())?;
        let child = Command::new(exe).args(plain_args(profile, url)).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|e| format!("The browser could not be started: {e}"))?;
        let pid = child.id().unwrap_or(0);
        Ok(Self { child, pid, started: tokio::time::Instant::now() })
    }

    pub fn state(&mut self) -> WindowState {
        match self.child.try_wait() {
            Ok(Some(_)) => {
                if self.started.elapsed() < Duration::from_millis(2500) {
                    WindowState::EndedAtOnce
                } else {
                    WindowState::Closed
                }
            }
            _ => WindowState::Open,
        }
    }

    /// The title of the window (Windows only).
    pub fn title(&self) -> Option<String> {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let output = std::process::Command::new("tasklist").args(["/v", "/fo", "csv", "/nh", "/fi", &format!("PID eq {}", self.pid)]).creation_flags(0x0800_0000).output().ok()?;
            parse_tasklist_title(&String::from_utf8_lossy(&output.stdout))
        }
        #[cfg(not(windows))]
        {
            None
        }
    }

    /// Asks the browser to close like a person would (so the cookies are written). Never kills it.
    pub fn close_politely(&self) {
        if self.pid == 0 {
            return;
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill").args(["/PID", &self.pid.to_string()]).creation_flags(0x0800_0000).output();
        }
        #[cfg(not(windows))]
        {
            let _ = std::process::Command::new("kill").args(["-TERM", &self.pid.to_string()]).output();
        }
    }

    /// Waits until the window is gone (up to `timeout`). `true` when it ended.
    pub async fn wait_closed(&mut self, timeout: Duration) -> bool {
        tokio::time::timeout(timeout, self.child.wait()).await.is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_plain_window_has_no_debugging_or_automation_switches() {
        let args = plain_args(Path::new("/p/acc1"), "https://accounts.google.com/ServiceLogin");
        assert_eq!(args.len(), 4);
        let text = args.join(" ").to_lowercase();
        for forbidden in ["remote-debugging", "headless", "enable-automation", "user-agent", "disable-blink-features", "webdriver"] {
            assert!(!text.contains(forbidden), "{forbidden}");
        }
        assert!(args[0].starts_with("--user-data-dir="));
    }

    #[test]
    fn the_title_is_the_last_csv_field() {
        let line = "\"chrome.exe\",\"1234\",\"Console\",\"1\",\"123,456 K\",\"Running\",\"PC\\me\",\"0:00:03\",\"Sign in - Google Accounts - Google Chrome\"\r\n";
        assert_eq!(parse_tasklist_title(line).as_deref(), Some("Sign in - Google Accounts - Google Chrome"));
        assert_eq!(parse_tasklist_title("INFO: No tasks are running which match the specified criteria."), None);
        assert_eq!(parse_tasklist_title("\"chrome.exe\",\"1\",\"Console\",\"1\",\"1 K\",\"Running\",\"u\",\"0:00:01\",\"N/A\""), None);
    }

    #[tokio::test]
    async fn a_program_that_ends_at_once_is_reported_as_such() {
        let exe = if cfg!(windows) { "cmd" } else { "true" };
        let mut window = PlainWindow::open(Path::new(exe), &std::env::temp_dir().join("ave-signin-test"), "https://example.com").await.unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(window.state(), WindowState::EndedAtOnce);
    }
}
