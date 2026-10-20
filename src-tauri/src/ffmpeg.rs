//! Locating and running the bundled FFmpeg sidecar binary.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy)]
pub enum Tool {
    Ffmpeg,
}

impl Tool {
    pub fn name(self) -> &'static str {
        match self {
            Tool::Ffmpeg => "ffmpeg",
        }
    }

    fn file_name(self) -> String {
        if cfg!(windows) {
            format!("{}.exe", self.name())
        } else {
            self.name().to_string()
        }
    }
}

/// Tauri installs sidecars next to the app executable, without the target triple.
/// The `AVE_SIDECAR_DIR` environment variable points somewhere else (used by the tests).
pub fn sidecar_path(tool: Tool) -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("AVE_SIDECAR_DIR") {
        return Ok(PathBuf::from(dir).join(tool.file_name()));
    }
    let exe =
        std::env::current_exe().map_err(|e| format!("Could not find the app location: {e}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "The app location has no parent folder".to_string())?;
    Ok(dir.join(tool.file_name()))
}

/// A ready-to-use command for the sidecar: no stdin, no console window on Windows,
/// and the process is killed if the command is dropped.
pub fn command(tool: Tool) -> Result<Command, String> {
    let mut cmd = Command::new(sidecar_path(tool)?);
    cmd.stdin(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    Ok(cmd)
}

/// Runs `<tool> -version` and returns the version token, e.g. "n8.1".
pub async fn version(tool: Tool) -> Result<String, String> {
    let path = sidecar_path(tool)?;
    if !path.exists() {
        return Err(format!("{} not found at {}", tool.name(), path.display()));
    }

    let mut cmd = command(tool)?;
    cmd.arg("-version");
    let output = timeout(PROBE_TIMEOUT, cmd.output())
        .await
        .map_err(|_| {
            format!(
                "{} did not answer within {} seconds",
                tool.name(),
                PROBE_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| format!("{} could not be started ({}): {e}", tool.name(), path.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "{} exited with {}: {}",
            tool.name(),
            output.status,
            stderr.trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_version(tool, &stdout).ok_or_else(|| {
        format!(
            "Unexpected output from {} -version: {}",
            tool.name(),
            stdout.lines().next().unwrap_or("(empty)")
        )
    })
}

/// Reads the version out of the first line, e.g. "ffmpeg version n8.1 Copyright ...".
fn parse_version(tool: Tool, output: &str) -> Option<String> {
    let mut words = output.lines().next()?.split_whitespace();
    if words.next()? != tool.name() || words.next()? != "version" {
        return None;
    }
    words.next().map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_release_version() {
        let out = "ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers\nbuilt with gcc";
        assert_eq!(parse_version(Tool::Ffmpeg, out).as_deref(), Some("6.1.1-3ubuntu5"));
    }

    #[test]
    fn parses_git_build_version() {
        let out = "ffmpeg version N-118000-g1a2b3c4d5e Copyright (c) 2007-2026 the FFmpeg developers";
        assert_eq!(
            parse_version(Tool::Ffmpeg, out).as_deref(),
            Some("N-118000-g1a2b3c4d5e")
        );
    }

    #[test]
    fn rejects_output_from_another_program() {
        assert_eq!(parse_version(Tool::Ffmpeg, "ffprobe version 8.1"), None);
        assert_eq!(parse_version(Tool::Ffmpeg, "hello world"), None);
    }

    #[test]
    fn rejects_empty_or_truncated_output() {
        assert_eq!(parse_version(Tool::Ffmpeg, ""), None);
        assert_eq!(parse_version(Tool::Ffmpeg, "ffmpeg version"), None);
    }
}
