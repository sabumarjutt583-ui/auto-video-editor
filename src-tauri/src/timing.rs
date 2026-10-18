//! Word timings from Groq Whisper: the voice is cut into chunks at quiet moments, each chunk is
//! sent separately, and the word times are put back on one timeline.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::api::groq::{self, HeardWord};
use crate::audio::silence::parse_silencedetect;
use crate::commands::error::AppError;
use crate::ffmpeg_job::{run, RunOptions};
use crate::jobs::Job;
use crate::project::TimeRange;

/// A chunk is cut at a silence once it is at least this long...
pub const MIN_CHUNK_SECONDS: f64 = 300.0;
/// ...and never gets longer than this (about 3.6 MB as 48 kbps mono MP3, far below Groq's limit).
pub const MAX_CHUNK_SECONDS: f64 = 600.0;
/// Silences must be at least this long to be used as cut points.
const CUT_SILENCE: f64 = 0.3;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SpokenWord {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

/// Splits `0..duration` into chunks of at most `MAX_CHUNK_SECONDS`, cutting in the middle of the
/// latest silence between `MIN` and `MAX` seconds after the chunk start (or hard at `MAX`).
pub fn plan_chunks(duration: f64, silences: &[TimeRange]) -> Vec<TimeRange> {
    plan_chunks_with(duration, silences, MIN_CHUNK_SECONDS, MAX_CHUNK_SECONDS)
}

pub fn plan_chunks_with(duration: f64, silences: &[TimeRange], min: f64, max: f64) -> Vec<TimeRange> {
    let mut chunks = Vec::new();
    if duration <= 0.0 {
        return chunks;
    }
    let mut start = 0.0;
    while duration - start > max {
        let cut = silences
            .iter()
            .filter(|s| s.end - s.start >= CUT_SILENCE)
            .map(|s| (s.start + s.end) / 2.0)
            .filter(|mid| *mid >= start + min && *mid <= start + max)
            .fold(None, |best: Option<f64>, mid| Some(best.map_or(mid, |b| b.max(mid))))
            .unwrap_or(start + max);
        chunks.push(TimeRange { start, end: cut });
        start = cut;
    }
    chunks.push(TimeRange { start, end: duration });
    chunks
}

/// Puts chunk words on the whole-voice timeline.
pub fn offset_words(words: Vec<HeardWord>, offset: f64, limit: f64) -> Vec<SpokenWord> {
    words
        .into_iter()
        .map(|w| SpokenWord { text: w.text, start: (w.start + offset).min(limit), end: (w.end + offset).min(limit) })
        .collect()
}

fn lossy(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Finds quiet moments to cut at (only needed for long voices).
async fn find_silences(job: &Job, file: &Path, duration: f64, to_percent: f64) -> Result<Vec<TimeRange>, AppError> {
    let args: Vec<String> = ["-i", &lossy(file), "-vn", "-af", &format!("silencedetect=noise=-35dB:d={CUT_SILENCE}"), "-f", "null", "-"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let mut options = RunOptions::new("Finding quiet moments to cut at", Some(duration), 0.0, to_percent);
    options.failure_message = "The voice could not be read. The file may be damaged.".to_string();
    let stderr = run(job, &args, &options).await?;
    Ok(parse_silencedetect(&stderr, duration))
}

/// Writes one chunk as small mono MP3 (16 kHz is what Whisper uses anyway).
async fn extract_chunk(job: &Job, file: &Path, chunk: TimeRange, output: &Path, from: f64, to: f64) -> Result<(), AppError> {
    let args: Vec<String> = vec![
        "-ss".into(), format!("{:.3}", chunk.start),
        "-t".into(), format!("{:.3}", chunk.end - chunk.start),
        "-i".into(), lossy(file),
        "-vn".into(), "-ac".into(), "1".into(), "-ar".into(), "16000".into(),
        "-c:a".into(), "libmp3lame".into(), "-b:a".into(), "48k".into(),
        lossy(output),
    ];
    let mut options = RunOptions::new("Preparing the voice", Some(chunk.end - chunk.start), from, to);
    options.failure_message = "The voice could not be prepared for transcription.".to_string();
    run(job, &args, &options).await.map(|_| ())
}

/// Everything needed to transcribe a voice file.
pub struct TranscribeRequest<'a> {
    pub file: &'a Path,
    pub duration: f64,
    pub temp_dir: PathBuf,
    pub key: &'a str,
    pub model: &'a str,
    pub language: Option<&'a str>,
}

/// Transcribes the whole voice with word times. Reports progress and stops quickly on Cancel.
pub async fn transcribe_voice(job: &Job, request: TranscribeRequest<'_>) -> Result<Vec<SpokenWord>, AppError> {
    transcribe_with(job, request, |key, model, language, name, audio| {
        let (key, model, language, name) = (key.to_string(), model.to_string(), language.map(str::to_string), name.to_string());
        async move { groq::transcribe(&key, &model, language.as_deref(), &name, audio).await }
    })
    .await
}

/// Same as `transcribe_voice`, with the Groq call replaced (so tests need no network).
pub async fn transcribe_with<F, Fut>(job: &Job, request: TranscribeRequest<'_>, call: F) -> Result<Vec<SpokenWord>, AppError>
where
    F: Fn(&str, &str, Option<&str>, &str, Vec<u8>) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<HeardWord>, crate::api::error::ApiError>>,
{
    let TranscribeRequest { file, duration, temp_dir, key, model, language } = request;
    std::fs::create_dir_all(&temp_dir).map_err(|e| AppError::new("A temporary folder could not be created.", e.to_string()))?;

    let chunks = if duration > MAX_CHUNK_SECONDS {
        let silences = find_silences(job, file, duration, 10.0).await?;
        plan_chunks(duration, &silences)
    } else {
        plan_chunks(duration, &[])
    };
    let count = chunks.len().max(1) as f64;
    let first = if duration > MAX_CHUNK_SECONDS { 10.0 } else { 0.0 };
    let span = 100.0 - first;

    let mut words: Vec<SpokenWord> = Vec::new();
    let result: Result<(), AppError> = async {
        for (index, chunk) in chunks.iter().enumerate() {
            let base = first + span * index as f64 / count;
            let step = span / count;
            let output = temp_dir.join(format!("chunk-{index}.mp3"));
            extract_chunk(job, file, *chunk, &output, base, base + step * 0.3).await?;
            let audio = std::fs::read(&output).map_err(|e| AppError::new("The prepared voice could not be read.", e.to_string()))?;
            let _ = std::fs::remove_file(&output);

            job.progress(&format!("Listening to the voice ({} of {})", index + 1, chunks.len()), base + step * 0.3);
            let heard = tokio::select! {
                () = job.cancelled() => return Err(AppError::cancelled()),
                heard = call(key, model, language, &format!("chunk-{index}.mp3"), audio) => heard?,
            };
            words.extend(offset_words(heard, chunk.start, duration));
            job.progress(&format!("Listening to the voice ({} of {})", index + 1, chunks.len()), base + step);
        }
        Ok(())
    }
    .await;
    let _ = std::fs::remove_dir_all(&temp_dir);
    result?;

    words.sort_by(|a, b| a.start.total_cmp(&b.start));
    Ok(words)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::error::ApiError;
    use crate::ffmpeg_job::sidecars_for_tests;
    use crate::jobs::{test_job, JobRegistry};

    use crate::audio::silence::total_length as covered;

    fn range(start: f64, end: f64) -> TimeRange {
        TimeRange { start, end }
    }

    #[test]
    fn a_short_voice_is_one_chunk() {
        assert_eq!(plan_chunks(120.0, &[]), vec![range(0.0, 120.0)]);
        assert!(plan_chunks(0.0, &[]).is_empty());
    }

    #[test]
    fn long_voices_are_cut_at_the_latest_silence_in_the_window() {
        let silences = [range(100.0, 101.0), range(400.0, 401.0), range(580.0, 582.0), range(900.0, 901.0)];
        let chunks = plan_chunks(1000.0, &silences);
        assert_eq!(chunks[0], range(0.0, 581.0));
        assert_eq!(chunks.last().unwrap().end, 1000.0);
        assert!((covered(&chunks) - 1000.0).abs() < 1e-9);
        for pair in chunks.windows(2) {
            assert_eq!(pair[0].end, pair[1].start);
        }
        assert!(chunks.iter().all(|c| c.end - c.start <= MAX_CHUNK_SECONDS + 1e-9));
    }

    #[test]
    fn without_silences_chunks_are_cut_at_the_maximum() {
        let chunks = plan_chunks(1500.0, &[]);
        assert_eq!(chunks, vec![range(0.0, 600.0), range(600.0, 1200.0), range(1200.0, 1500.0)]);
    }

    #[test]
    fn tiny_silences_are_not_used() {
        let chunks = plan_chunks(700.0, &[range(450.0, 450.1)]);
        assert_eq!(chunks[0].end, 600.0);
    }

    #[test]
    fn words_are_moved_onto_the_whole_timeline_and_clamped() {
        let words = vec![HeardWord { text: "a".into(), start: 1.0, end: 2.0 }, HeardWord { text: "b".into(), start: 9.5, end: 11.0 }];
        let moved = offset_words(words, 600.0, 610.0);
        assert_eq!(moved[0], SpokenWord { text: "a".into(), start: 601.0, end: 602.0 });
        assert_eq!(moved[1].end, 610.0);
    }

    fn make_wav(path: &Path, seconds: u32) -> bool {
        std::process::Command::new(crate::ffmpeg::sidecar_path(crate::ffmpeg::Tool::Ffmpeg).unwrap())
            .args(["-y", "-f", "lavfi", "-i", &format!("sine=frequency=300:duration={seconds}"), path.to_str().unwrap()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    #[tokio::test]
    async fn chunks_are_sent_in_order_with_offsets_and_progress() {
        if !sidecars_for_tests() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("ave-timing-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let wav = dir.join("v.wav");
        assert!(make_wav(&wav, 5));
        let registry = JobRegistry::default();
        let (job, log) = test_job(&registry, "tr");
        let request = TranscribeRequest { file: &wav, duration: 5.0, temp_dir: dir.join("tmp"), key: "k", model: "m", language: Some("ko") };
        let words = transcribe_with(&job, request, |_, _, language, name, audio| {
            assert_eq!(language, Some("ko"));
            assert_eq!(name, "chunk-0.mp3");
            assert!(audio.len() > 500, "the prepared chunk should hold real audio");
            async { Ok(vec![HeardWord { text: "hello".into(), start: 0.5, end: 1.0 }]) }
        })
        .await
        .unwrap();
        assert_eq!(words, vec![SpokenWord { text: "hello".into(), start: 0.5, end: 1.0 }]);
        assert_eq!(log.lock().unwrap().last().unwrap().percent, 100.0);
        assert!(!dir.join("tmp").exists(), "temporary files are removed");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn an_api_error_stops_the_job_and_cleans_up() {
        if !sidecars_for_tests() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("ave-timing-err-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let wav = dir.join("v.wav");
        assert!(make_wav(&wav, 2));
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "tr-err");
        let request = TranscribeRequest { file: &wav, duration: 2.0, temp_dir: dir.join("tmp"), key: "k", model: "m", language: None };
        let error = transcribe_with(&job, request, |_, _, _, _, _| async { Err(ApiError::RateLimited("HTTP 429".into())) }).await.unwrap_err();
        assert!(error.message.contains("Rate limit"));
        assert!(!dir.join("tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn cancel_during_the_api_call_stops_quickly() {
        if !sidecars_for_tests() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("ave-timing-cancel-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let wav = dir.join("v.wav");
        assert!(make_wav(&wav, 2));
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "tr-cancel");
        let canceller = registry.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            canceller.cancel("tr-cancel");
        });
        let request = TranscribeRequest { file: &wav, duration: 2.0, temp_dir: dir.join("tmp"), key: "k", model: "m", language: None };
        let started = std::time::Instant::now();
        let error = transcribe_with(&job, request, |_, _, _, _, _| async {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            Ok(Vec::new())
        })
        .await
        .unwrap_err();
        assert_eq!(error.code.as_deref(), Some("cancelled"));
        assert!(started.elapsed() < std::time::Duration::from_secs(10));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
