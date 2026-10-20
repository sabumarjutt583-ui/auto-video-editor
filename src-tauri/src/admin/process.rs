//! Turning a downloaded sound into a library sound: trim, one common loudness, short fades, WAV.

use std::path::Path;

use crate::commands::error::AppError;
use crate::ffmpeg_job::{run, RunOptions};
use crate::jobs::Job;

/// The loudness every library sound is brought to.
pub const TARGET_LUFS: f64 = -16.0;
pub const TRUE_PEAK: f64 = -1.5;
/// Fade at both ends so sounds never click.
pub const FADE_SECONDS: f64 = 0.010;
pub const MAX_SECONDS: f64 = 15.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Trim {
    pub start: f64,
    /// Seconds; None = until the end.
    pub end: Option<f64>,
}

/// The length of the sound after trimming, given the length of the source.
pub fn trimmed_length(source: f64, trim: Trim) -> Result<f64, AppError> {
    let end = trim.end.unwrap_or(source).min(source);
    let length = end - trim.start.max(0.0);
    if !length.is_finite() || length < 0.05 {
        return Err(AppError::new("The trimmed sound would be too short. Please choose a longer part.", format!("start {} end {end}", trim.start)));
    }
    if length > MAX_SECONDS {
        return Err(AppError::new(format!("Library sounds can be at most {MAX_SECONDS} seconds. Please trim it."), format!("{length:.2}s")));
    }
    Ok(length)
}

/// The FFmpeg options (input and output) for one sound.
pub fn args(input: &Path, output: &Path, trim: Trim, length: f64) -> Vec<String> {
    let fade_out_start = (length - FADE_SECONDS).max(0.0);
    // Trim first, then level, then fade, so the fades are part of the final sound.
    let filter = format!(
        "loudnorm=I={TARGET_LUFS}:TP={TRUE_PEAK}:LRA=11,aresample=44100,atrim=0:{length:.4},afade=t=in:st=0:d={FADE_SECONDS},afade=t=out:st={fade_out_start:.4}:d={FADE_SECONDS}"
    );
    let mut list = vec!["-ss".to_string(), format!("{:.4}", trim.start.max(0.0)), "-i".into(), input.to_string_lossy().into_owned()];
    list.extend(["-t".into(), format!("{:.4}", length), "-af".into(), filter, "-ac".into(), "1".into(), "-ar".into(), "44100".into(), "-c:a".into(), "pcm_s16le".into(), output.to_string_lossy().into_owned()]);
    list
}

/// The length of an audio file in seconds.
pub async fn probe_seconds(path: &Path) -> Result<f64, AppError> {
    let text = crate::probe::probe_text(path, "This sound file could not be read.").await?;
    crate::probe::parse_info(&text)
        .duration
        .filter(|d| *d > 0.0)
        .ok_or_else(|| AppError::new("This sound file could not be read.", format!("{}: no length found", path.display())))
}

/// Writes the finished WAV and returns its length in seconds.
pub async fn make_sound(job: &Job, input: &Path, output: &Path, trim: Trim) -> Result<f64, AppError> {
    let source = probe_seconds(input).await?;
    let length = trimmed_length(source, trim)?;
    let mut options = RunOptions::new("Normalizing the sound", Some(length), 0.0, 100.0);
    options.failure_message = "The sound could not be processed. The file may be damaged.".to_string();
    run(job, &args(input, output, trim, length), &options).await?;
    probe_seconds(output).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffmpeg::{command, Tool};
    use crate::ffmpeg_job::sidecars_for_tests;
    use crate::jobs::{test_job, JobRegistry};
    use std::path::PathBuf;

    #[test]
    fn lengths_are_checked() {
        assert!((trimmed_length(2.0, Trim { start: 0.5, end: None }).unwrap() - 1.5).abs() < 1e-9);
        assert!((trimmed_length(2.0, Trim { start: 0.0, end: Some(9.0) }).unwrap() - 2.0).abs() < 1e-9);
        assert!(trimmed_length(2.0, Trim { start: 1.99, end: None }).is_err());
        assert!(trimmed_length(40.0, Trim { start: 0.0, end: None }).is_err());
    }

    #[test]
    fn the_filter_levels_and_fades() {
        let a = args(Path::new("in.mp3"), Path::new("out.wav"), Trim { start: 0.25, end: None }, 1.0).join(" ");
        assert!(a.contains("loudnorm=I=-16"));
        assert!(a.contains("afade=t=in:st=0:d=0.01"));
        assert!(a.contains("afade=t=out:st=0.9900:d=0.01"));
        assert!(a.contains("-ss 0.2500"));
    }

    async fn loudness(path: &Path) -> f64 {
        let mut cmd = command(Tool::Ffmpeg).unwrap();
        cmd.args(["-hide_banner", "-nostats", "-i"]).arg(path).args(["-af", "ebur128=peak=true", "-f", "null", "-"]);
        let out = cmd.output().await.unwrap();
        let text = String::from_utf8_lossy(&out.stderr).to_string();
        let summary = text.rsplit("Integrated loudness:").next().unwrap().to_string();
        let line = summary.lines().find(|l| l.trim_start().starts_with("I:")).unwrap().to_string();
        line.split_whitespace().nth(1).unwrap().parse().unwrap()
    }

    #[tokio::test]
    async fn a_quiet_and_a_loud_sound_end_up_at_the_same_level() {
        if !sidecars_for_tests() {
            return;
        }
        let dir: PathBuf = std::env::temp_dir().join(format!("ave-admin-proc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut results = Vec::new();
        for (name, volume) in [("quiet", 0.02), ("loud", 0.8)] {
            let input = dir.join(format!("{name}.wav"));
            let mut cmd = command(Tool::Ffmpeg).unwrap();
            cmd.args(["-y", "-f", "lavfi", "-i", &format!("sine=frequency=440:duration=2,volume={volume}")]).arg(&input);
            assert!(cmd.output().await.unwrap().status.success());
            let output = dir.join(format!("{name}-out.wav"));
            let registry = JobRegistry::default();
            let (job, _) = test_job(&registry, name);
            let length = make_sound(&job, &input, &output, Trim { start: 0.2, end: Some(1.7) }).await.unwrap();
            assert!((length - 1.5).abs() < 0.05, "{length}");
            results.push(loudness(&output).await);
        }
        assert!((results[0] - TARGET_LUFS).abs() < 2.0, "quiet: {}", results[0]);
        assert!((results[1] - TARGET_LUFS).abs() < 2.0, "loud: {}", results[1]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
