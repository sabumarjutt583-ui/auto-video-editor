//! Runs FFmpeg as a background job: progress goes to the UI, Cancel stops the process.

use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

use crate::commands::error::AppError;
use crate::ffmpeg::{command, Tool};
use crate::jobs::Job;

const STDERR_LIMIT: usize = 4 * 1024 * 1024;
const ERROR_TAIL_CHARS: usize = 1500;

pub struct RunOptions {
    /// Shown to the user while running, e.g. "Cutting silences".
    pub stage: String,
    /// Length of the output in seconds, used to turn FFmpeg's time into a percentage.
    pub total_seconds: Option<f64>,
    /// The part of the whole job (0 to 100) this FFmpeg run covers.
    pub from_percent: f64,
    pub to_percent: f64,
    /// Sentence shown when FFmpeg fails.
    pub failure_message: String,
}

impl RunOptions {
    pub fn new(stage: &str, total_seconds: Option<f64>, from_percent: f64, to_percent: f64) -> Self {
        Self {
            stage: stage.to_string(),
            total_seconds,
            from_percent,
            to_percent,
            failure_message: "The audio could not be processed. The file may be damaged.".to_string(),
        }
    }
}

/// Reads FFmpeg's `-progress` output line: `out_time_us=1234567` gives seconds.
pub fn parse_progress_line(line: &str) -> Option<f64> {
    let microseconds: f64 = line.trim().strip_prefix("out_time_us=")?.trim().parse().ok()?;
    (microseconds >= 0.0).then_some(microseconds / 1_000_000.0)
}

fn tail(text: &str) -> String {
    let count = text.chars().count();
    if count <= ERROR_TAIL_CHARS {
        return text.trim().to_string();
    }
    let skipped: String = text.chars().skip(count - ERROR_TAIL_CHARS).collect();
    format!("…{}", skipped.trim())
}

/// Runs FFmpeg with `args` (input and output options). Returns what FFmpeg printed on stderr.
pub async fn run(job: &Job, args: &[String], options: &RunOptions) -> Result<String, AppError> {
    job.check()?;
    let mut cmd = command(Tool::Ffmpeg).map_err(engine_error)?;
    cmd.args(["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats"])
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| engine_error(e.to_string()))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stderr_task = tokio::spawn(async move {
        let mut text = String::new();
        if let Some(stderr) = stderr {
            let mut bytes = Vec::new();
            let _ = stderr.take(STDERR_LIMIT as u64).read_to_end(&mut bytes).await;
            text = String::from_utf8_lossy(&bytes).into_owned();
        }
        text
    });

    let span = options.to_percent - options.from_percent;
    let progress_reader = async {
        let Some(stdout) = stdout else { return };
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let (Some(seconds), Some(total)) = (parse_progress_line(&line), options.total_seconds) {
                if total > 0.0 {
                    let fraction = (seconds / total).clamp(0.0, 1.0);
                    job.progress(&options.stage, options.from_percent + span * fraction);
                }
            }
        }
    };

    job.progress(&options.stage, options.from_percent);
    let status = tokio::select! {
        () = job.cancelled() => {
            let _ = child.kill().await;
            stderr_task.abort();
            return Err(AppError::cancelled());
        }
        status = async {
            progress_reader.await;
            child.wait().await
        } => status.map_err(|e| engine_error(e.to_string()))?,
    };

    let stderr_text = stderr_task.await.unwrap_or_default();
    if !status.success() {
        return Err(AppError::new(options.failure_message.clone(), format!("FFmpeg exited with {status}: {}", tail(&stderr_text))));
    }
    job.progress(&options.stage, options.to_percent);
    Ok(stderr_text)
}

fn engine_error(details: String) -> AppError {
    AppError::new("The video engine (FFmpeg) is missing or could not start.", details)
}

/// Makes the bundled FFmpeg/FFprobe usable in tests by pointing `AVE_SIDECAR_DIR` at links to
/// the binaries in `src-tauri/binaries`. Returns false (so the test can skip) when they are missing.
#[cfg(test)]
pub fn sidecars_for_tests() -> bool {
    use std::sync::OnceLock;
    static READY: OnceLock<bool> = OnceLock::new();
    *READY.get_or_init(|| {
        let binaries = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries");
        let find = |prefix: &str| {
            std::fs::read_dir(&binaries).ok()?.flatten().map(|e| e.path()).find(|p| {
                p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with(prefix))
            })
        };
        let (Some(ffmpeg), Some(ffprobe)) = (find("ffmpeg-"), find("ffprobe-")) else {
            eprintln!("skipped: FFmpeg sidecars are not in src-tauri/binaries");
            return false;
        };
        let dir = std::env::temp_dir().join(format!("ave-sidecars-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let link = |from: &std::path::Path, name: &str| {
            let target = dir.join(if cfg!(windows) { format!("{name}.exe") } else { name.to_string() });
            let _ = std::fs::remove_file(&target);
            #[cfg(unix)]
            let result = std::os::unix::fs::symlink(from, &target);
            #[cfg(windows)]
            let result = std::fs::copy(from, &target).map(|_| ());
            result.is_ok()
        };
        if link(&ffmpeg, "ffmpeg") && link(&ffprobe, "ffprobe") {
            std::env::set_var("AVE_SIDECAR_DIR", &dir);
            true
        } else {
            false
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jobs::{test_job, JobRegistry};

    #[test]
    fn reads_progress_lines() {
        assert_eq!(parse_progress_line("out_time_us=2500000"), Some(2.5));
        assert_eq!(parse_progress_line("out_time_us=N/A"), None);
        assert_eq!(parse_progress_line("progress=continue"), None);
        assert_eq!(parse_progress_line("out_time_us=-9223372036854775807"), None);
    }

    #[tokio::test]
    async fn runs_reports_progress_and_returns_stderr() {
        if !sidecars_for_tests() {
            return;
        }
        let registry = JobRegistry::default();
        let (job, log) = test_job(&registry, "run");
        let args: Vec<String> = ["-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-f", "null", "-"]
            .iter().map(|s| s.to_string()).collect();
        let stderr = run(&job, &args, &RunOptions::new("Testing", Some(1.0), 10.0, 90.0)).await.unwrap();
        assert!(!stderr.is_empty());
        let log = log.lock().unwrap();
        assert_eq!(log.first().unwrap().percent, 10.0);
        assert_eq!(log.last().unwrap().percent, 90.0);
    }

    #[tokio::test]
    async fn a_failing_run_gives_a_friendly_error_with_details() {
        if !sidecars_for_tests() {
            return;
        }
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "fail");
        let args: Vec<String> = ["-i", "/definitely/not/here.wav", "-f", "null", "-"].iter().map(|s| s.to_string()).collect();
        let error = run(&job, &args, &RunOptions::new("Testing", None, 0.0, 100.0)).await.unwrap_err();
        assert!(error.message.contains("could not be processed"));
        assert!(error.details.contains("No such file"), "{}", error.details);
    }

    #[tokio::test]
    async fn cancel_stops_a_long_run_quickly() {
        if !sidecars_for_tests() {
            return;
        }
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "cancel");
        let canceller = registry.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            canceller.cancel("cancel");
        });
        // Without Cancel this would take a long time (it is read at normal speed).
        let args: Vec<String> = ["-re", "-f", "lavfi", "-i", "sine=frequency=440:duration=600", "-f", "null", "-"]
            .iter().map(|s| s.to_string()).collect();
        let started = std::time::Instant::now();
        let error = run(&job, &args, &RunOptions::new("Testing", Some(600.0), 0.0, 100.0)).await.unwrap_err();
        assert_eq!(error.code.as_deref(), Some("cancelled"));
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
    }
}
