//! Silence detection and building the cleaned voice file (`processed.wav`).

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::probe::AudioInfo;
use super::silence::{keep_segments, parse_silencedetect, plan_cuts, total_length};
use crate::commands::error::AppError;
use crate::ffmpeg_job::{run, RunOptions};
use crate::jobs::Job;
use crate::project::TimeRange;

/// Loudness target for voice-over, in LUFS.
const LOUDNESS_TARGET: &str = "loudnorm=I=-16:TP=-1.5:LRA=11";
const OUTPUT_RATE: u32 = 48_000;
/// Short fades on every kept piece so the joins do not click.
const FADE_SECONDS: f64 = 0.006;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupParams {
    pub threshold_db: f64,
    pub min_silence: f64,
    pub padding: f64,
    pub normalize: bool,
}

impl CleanupParams {
    pub fn validated(self) -> Result<Self, AppError> {
        let problem = if !(-80.0..=-10.0).contains(&self.threshold_db) {
            Some("The silence threshold must be between -80 and -10 dB.")
        } else if !(0.1..=10.0).contains(&self.min_silence) {
            Some("The shortest silence to cut must be between 0.1 and 10 seconds.")
        } else if !(0.0..=1.0).contains(&self.padding) {
            Some("The padding must be between 0 and 1 second.")
        } else {
            None
        };
        match problem {
            Some(message) => Err(AppError::new(message, format!("{self:?}"))),
            None => Ok(self),
        }
    }
}

/// What the Preview button shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SilenceReport {
    pub duration: f64,
    /// The silent stretches that will be removed.
    pub removed: Vec<TimeRange>,
    pub new_duration: f64,
}

/// What Apply/Skip returns.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    pub processed_path: String,
    pub duration: f64,
    pub removed: Vec<TimeRange>,
    pub sample_rate: u32,
    pub channels: u32,
}

/// Finds the silences and works out what would be removed.
pub async fn preview(job: &Job, file: &Path, info: &AudioInfo, params: CleanupParams, from: f64, to: f64) -> Result<SilenceReport, AppError> {
    let filter = format!("silencedetect=noise={}dB:d={}", params.threshold_db, params.min_silence);
    let args = vec!["-i".to_string(), path_arg(file), "-vn".into(), "-af".into(), filter, "-f".into(), "null".into(), "-".into()];
    let mut options = RunOptions::new("Finding silences", Some(info.duration), from, to);
    options.failure_message = "The silences could not be found. The file may be damaged.".to_string();
    let stderr = run(job, &args, &options).await?;

    let silences = parse_silencedetect(&stderr, info.duration);
    let removed = plan_cuts(&silences, info.duration, params.min_silence, params.padding);
    let new_duration = info.duration - total_length(&removed);
    Ok(SilenceReport { duration: info.duration, removed, new_duration })
}

fn path_arg(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// The FFmpeg filter that joins the kept pieces, applies the optional loudness step and
/// converts to 48 kHz. Written to a file because a long voice-over can have hundreds of pieces.
pub fn build_filter_script(keep: &[TimeRange], normalize: bool) -> String {
    let mut script = String::new();
    for (index, piece) in keep.iter().enumerate() {
        let length = piece.end - piece.start;
        script.push_str(&format!("[0:a]atrim=start={:.6}:end={:.6},asetpts=PTS-STARTPTS", piece.start, piece.end));
        if length > FADE_SECONDS * 4.0 {
            script.push_str(&format!(
                ",afade=t=in:st=0:d={FADE_SECONDS},afade=t=out:st={:.6}:d={FADE_SECONDS}",
                length - FADE_SECONDS
            ));
        }
        script.push_str(&format!("[a{index}];\n"));
    }
    for index in 0..keep.len() {
        script.push_str(&format!("[a{index}]"));
    }
    script.push_str(&format!("concat=n={}:v=0:a=1[joined];\n", keep.len()));
    script.push_str("[joined]");
    if normalize {
        script.push_str(LOUDNESS_TARGET);
        script.push(',');
    }
    script.push_str(&format!("aresample={OUTPUT_RATE}[out]"));
    script
}

/// Output options: 48 kHz 16-bit WAV with no leftover tags.
fn encode_args(output: &Path) -> Vec<String> {
    vec![
        "-map_metadata".into(),
        "-1".into(),
        "-c:a".into(),
        "pcm_s16le".into(),
        "-ar".into(),
        OUTPUT_RATE.to_string(),
        "-f".into(),
        "wav".into(),
        path_arg(output),
    ]
}

/// Builds the cleaned file by keeping only the speech pieces. Detects silences first.
pub async fn apply_cut(
    job: &Job,
    input: &Path,
    info: &AudioInfo,
    output: &Path,
    scratch: &Path,
    params: CleanupParams,
) -> Result<Vec<TimeRange>, AppError> {
    let report = preview(job, input, info, params, 0.0, 30.0).await?;
    let keep = keep_segments(&report.removed, info.duration);
    if keep.is_empty() || total_length(&keep) < 0.2 {
        return Err(AppError::new(
            "No speech was found with these settings. Try a lower threshold (for example -50 dB).",
            format!("Everything was detected as silence at {} dB.", params.threshold_db),
        ));
    }

    let script = build_filter_script(&keep, params.normalize);
    std::fs::write(scratch, script).map_err(|e| AppError::new("The cleaned audio could not be prepared.", format!("{e} ({})", scratch.display())))?;
    let mut args = vec!["-i".to_string(), path_arg(input), "-filter_complex_script".into(), path_arg(scratch), "-map".into(), "[out]".into()];
    args.extend(encode_args(output));
    let options = RunOptions::new("Cutting silences", Some(total_length(&keep)), 30.0, 100.0);
    let result = run(job, &args, &options).await;
    let _ = std::fs::remove_file(scratch);
    result?;
    Ok(report.removed)
}

/// Keeps the original audio, converted to the 48 kHz WAV the rest of the app uses.
pub async fn convert_only(job: &Job, input: &Path, info: &AudioInfo, output: &Path, normalize: bool) -> Result<(), AppError> {
    let mut args = vec!["-i".to_string(), path_arg(input), "-vn".into()];
    let chain = if normalize { format!("{LOUDNESS_TARGET},aresample={OUTPUT_RATE}") } else { format!("aresample={OUTPUT_RATE}") };
    args.extend(["-af".into(), chain]);
    args.extend(encode_args(output));
    run(job, &args, &RunOptions::new("Preparing the voice", Some(info.duration), 0.0, 100.0)).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::probe::probe;
    use crate::ffmpeg::{sidecar_path, Tool};
    use crate::ffmpeg_job::sidecars_for_tests;
    use crate::jobs::{test_job, JobRegistry};

    fn range(start: f64, end: f64) -> TimeRange {
        TimeRange { start, end }
    }

    #[test]
    fn the_filter_script_joins_the_pieces_in_order() {
        let script = build_filter_script(&[range(0.0, 2.0), range(3.5, 5.0)], false);
        assert!(script.contains("[0:a]atrim=start=0.000000:end=2.000000,asetpts=PTS-STARTPTS"));
        assert!(script.contains("atrim=start=3.500000:end=5.000000"));
        assert!(script.contains("[a0][a1]concat=n=2:v=0:a=1[joined]"));
        assert!(script.ends_with("[joined]aresample=48000[out]"));
        assert!(!script.contains("loudnorm"));
    }

    #[test]
    fn loudness_normalizing_comes_before_the_resampling() {
        let script = build_filter_script(&[range(0.0, 1.0)], true);
        assert!(script.ends_with("[joined]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[out]"));
    }

    #[test]
    fn very_short_pieces_get_no_fades() {
        let script = build_filter_script(&[range(1.0, 1.01)], false);
        assert!(!script.contains("afade"));
    }

    #[test]
    fn settings_outside_the_allowed_range_are_refused() {
        let ok = CleanupParams { threshold_db: -40.0, min_silence: 0.6, padding: 0.15, normalize: false };
        assert!(ok.validated().is_ok());
        assert!(CleanupParams { threshold_db: 5.0, ..ok }.validated().is_err());
        assert!(CleanupParams { min_silence: 0.0, ..ok }.validated().is_err());
        assert!(CleanupParams { padding: 2.0, ..ok }.validated().is_err());
    }

    /// Speech-like tones with silences: 2 s tone, 2 s silence, 2 s tone, 1.2 s silence, 2 s tone.
    fn make_voice(path: &Path) {
        let filter = "sine=frequency=300:duration=2[a];anullsrc=r=44100:cl=mono,atrim=duration=2[s1];\
sine=frequency=500:duration=2[b];anullsrc=r=44100:cl=mono,atrim=duration=1.2[s2];sine=frequency=400:duration=2[c];\
[a][s1][b][s2][c]concat=n=5:v=0:a=1[out]";
        let status = std::process::Command::new(sidecar_path(Tool::Ffmpeg).unwrap())
            .args(["-v", "error", "-y", "-filter_complex", filter, "-map", "[out]", "-ar", "44100"])
            .arg(path)
            .status()
            .unwrap();
        assert!(status.success());
    }

    #[tokio::test]
    async fn preview_and_apply_shorten_a_real_file() {
        if !sidecars_for_tests() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("ave-process-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let input = dir.join("voice.wav");
        make_voice(&input);
        let info = probe(&input).await.unwrap();
        assert!((info.duration - 9.2).abs() < 0.1);

        let registry = JobRegistry::default();
        let (job, log) = test_job(&registry, "process");
        let params = CleanupParams { threshold_db: -40.0, min_silence: 0.6, padding: 0.15, normalize: false };

        let report = preview(&job, &input, &info, params, 0.0, 100.0).await.unwrap();
        assert_eq!(report.removed.len(), 2, "{:?}", report.removed);
        // 2.0 s silence -> 1.7 s removed; 1.2 s silence -> 0.9 s removed.
        let expected = 9.2 - 1.7 - 0.9;
        assert!((report.new_duration - expected).abs() < 0.15, "{} vs {expected}", report.new_duration);

        let output = dir.join("processed.wav");
        let removed = apply_cut(&job, &input, &info, &output, &dir.join("filter.txt"), params).await.unwrap();
        assert_eq!(removed.len(), 2);
        assert!(!dir.join("filter.txt").exists(), "scratch file is cleaned up");
        let result = probe(&output).await.unwrap();
        assert_eq!(result.sample_rate, 48000);
        assert!((result.duration - expected).abs() < 0.2, "{} vs {expected}", result.duration);
        assert!(log.lock().unwrap().iter().any(|p| p.stage == "Cutting silences"));

        // Skipping keeps the full length, converted to 48 kHz.
        let skipped = dir.join("skipped.wav");
        convert_only(&job, &input, &info, &skipped, false).await.unwrap();
        let converted = probe(&skipped).await.unwrap();
        assert_eq!(converted.sample_rate, 48000);
        assert!((converted.duration - info.duration).abs() < 0.1);

        // Normalizing still produces a readable 48 kHz file.
        let loud = dir.join("loud.wav");
        convert_only(&job, &input, &info, &loud, true).await.unwrap();
        assert_eq!(probe(&loud).await.unwrap().sample_rate, 48000);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_file_that_is_all_silence_gives_a_helpful_message() {
        if !sidecars_for_tests() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("ave-allquiet-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let input = dir.join("quiet.wav");
        let status = std::process::Command::new(sidecar_path(Tool::Ffmpeg).unwrap())
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "3"])
            .arg(&input)
            .status()
            .unwrap();
        assert!(status.success());
        let info = probe(&input).await.unwrap();
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "quiet");
        let params = CleanupParams { threshold_db: -40.0, min_silence: 0.6, padding: 0.15, normalize: false };
        let error = apply_cut(&job, &input, &info, &dir.join("out.wav"), &dir.join("f.txt"), params).await.unwrap_err();
        assert!(error.message.contains("No speech"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
