//! Closing a browser that still holds an account's profile folder.
//!
//! A second Chrome started on a profile that is already open does not start: it hands its address to the first
//! one (which opens an `about:blank` tab) and ends at once with exit code 0. That happens when the sign-in window
//! was left open, or when an earlier run of the app left its browser behind without a reachable DevTools port.
//! Only processes whose command line names exactly this profile folder are closed.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

/// The program and arguments that close every browser started with `--user-data-dir=<profile>`.
pub fn kill_command(profile: &Path) -> (String, Vec<String>) {
    let path = profile.display().to_string();
    if cfg!(windows) {
        let script = format!(
            "$p = [regex]::Escape('{}'); Get-CimInstance Win32_Process | Where-Object {{ $_.CommandLine -and ($_.CommandLine -match ('--user-data-dir=\"?' + $p + '\"?(\\s|$)')) }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}",
            path.replace('\'', "''")
        );
        ("powershell".to_string(), vec!["-NoProfile".into(), "-NonInteractive".into(), "-Command".into(), script])
    } else {
        ("pkill".to_string(), vec!["-f".into(), "--".into(), format!("--user-data-dir={}( |$)", escape_ere(&path))])
    }
}

/// Escapes a text for a POSIX extended regular expression.
pub fn escape_ere(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars() {
        if "\\.^$|?*+()[]{}".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Closes the browsers that hold this profile. Returns after they had a moment to end.
pub async fn close_browsers_of(profile: &Path) {
    let (program, args) = kill_command(profile);
    let mut command = tokio::process::Command::new(program);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let _ = tokio::time::timeout(Duration::from_secs(15), async { command.status().await }).await;
    tokio::time::sleep(Duration::from_millis(900)).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_profile_path_is_matched_exactly() {
        let (program, args) = kill_command(Path::new("/data/profiles/a.b"));
        if cfg!(windows) {
            assert_eq!(program, "powershell");
        } else {
            assert_eq!(program, "pkill");
            assert!(args.last().unwrap().contains("a\\.b( |$)"), "the dot is escaped and the name must end there: {args:?}");
        }
        assert_eq!(escape_ere("a+b(c)"), "a\\+b\\(c\\)");
    }
}
