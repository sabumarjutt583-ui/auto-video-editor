//! Waveform peaks for the player: the loudest sample in each small slice of the audio.

use std::process::Stdio;

use serde::Serialize;
use tokio::io::AsyncReadExt;

use crate::commands::error::AppError;
use crate::ffmpeg::{command, Tool};

pub const PEAK_COUNT: usize = 4000;
const ANALYSIS_RATE: u32 = 8000;

#[derive(Debug, Clone, Serialize)]
pub struct Waveform {
    pub duration: f64,
    /// Values from 0 to 1.
    pub peaks: Vec<f32>,
}

/// Collects the loudest sample of every `bucket_size` samples, streaming.
pub struct PeakBuilder {
    bucket_size: usize,
    in_bucket: usize,
    loudest: i32,
    peaks: Vec<f32>,
}

impl PeakBuilder {
    pub fn new(total_samples: usize, wanted_peaks: usize) -> Self {
        let bucket_size = (total_samples / wanted_peaks.max(1)).max(1);
        Self { bucket_size, in_bucket: 0, loudest: 0, peaks: Vec::with_capacity(wanted_peaks + 1) }
    }

    pub fn push(&mut self, samples: &[i16]) {
        for &sample in samples {
            self.loudest = self.loudest.max(i32::from(sample).abs());
            self.in_bucket += 1;
            if self.in_bucket == self.bucket_size {
                self.flush();
            }
        }
    }

    fn flush(&mut self) {
        self.peaks.push((self.loudest as f32 / 32768.0).min(1.0));
        self.in_bucket = 0;
        self.loudest = 0;
    }

    pub fn finish(mut self) -> Vec<f32> {
        if self.in_bucket > 0 {
            self.flush();
        }
        self.peaks
    }
}

/// Decodes the file at a low sample rate and returns about `PEAK_COUNT` peaks.
pub async fn waveform(path: &std::path::Path, duration: f64) -> Result<Waveform, AppError> {
    let mut cmd = command(Tool::Ffmpeg).map_err(|e| AppError::new("The video engine (FFmpeg) is missing or could not start.", e))?;
    cmd.args(["-hide_banner", "-nostdin", "-v", "error", "-i"])
        .arg(path)
        .args(["-vn", "-ac", "1", "-ar", &ANALYSIS_RATE.to_string(), "-f", "s16le", "pipe:1"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| AppError::new("The video engine (FFmpeg) could not start.", e.to_string()))?;
    let mut stdout = child.stdout.take().ok_or_else(|| AppError::new("The waveform could not be read.", "No output from FFmpeg."))?;
    let mut stderr = child.stderr.take();

    let expected_samples = (duration * f64::from(ANALYSIS_RATE)) as usize;
    let mut builder = PeakBuilder::new(expected_samples, PEAK_COUNT);
    let mut buffer = vec![0u8; 64 * 1024];
    let mut leftover: Option<u8> = None;
    loop {
        let read = stdout.read(&mut buffer).await.map_err(|e| AppError::new("The waveform could not be read.", e.to_string()))?;
        if read == 0 {
            break;
        }
        let mut bytes = Vec::with_capacity(read + 1);
        bytes.extend(leftover.take());
        bytes.extend_from_slice(&buffer[..read]);
        if bytes.len() % 2 == 1 {
            leftover = bytes.pop();
        }
        let samples: Vec<i16> = bytes.chunks_exact(2).map(|pair| i16::from_le_bytes([pair[0], pair[1]])).collect();
        builder.push(&samples);
    }

    let status = child.wait().await.map_err(|e| AppError::new("The waveform could not be read.", e.to_string()))?;
    if !status.success() {
        let mut text = String::new();
        if let Some(stderr) = stderr.as_mut() {
            let _ = stderr.read_to_string(&mut text).await;
        }
        return Err(AppError::new("The waveform could not be drawn for this file.", text.trim().to_string()));
    }
    Ok(Waveform { duration, peaks: builder.finish() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_the_loudest_sample_of_each_bucket() {
        let mut builder = PeakBuilder::new(8, 4);
        builder.push(&[0, 100, -300, 20, 0, 0, 32767, 1]);
        let peaks = builder.finish();
        assert_eq!(peaks.len(), 4);
        assert!((peaks[0] - 100.0 / 32768.0).abs() < 1e-6);
        assert!((peaks[1] - 300.0 / 32768.0).abs() < 1e-6);
        assert_eq!(peaks[2], 0.0);
        assert!((peaks[3] - 32767.0 / 32768.0).abs() < 1e-6);
    }

    #[test]
    fn the_last_partial_bucket_is_kept_and_input_can_arrive_in_pieces() {
        let mut builder = PeakBuilder::new(10, 5);
        builder.push(&[1, 2, 3]);
        builder.push(&[-32768, 5]);
        builder.push(&[7, 9]);
        let peaks = builder.finish();
        assert_eq!(peaks.len(), 4, "the last, partly filled bucket is kept");
        assert_eq!(peaks[1], 1.0, "-32768 is the loudest possible value");
        assert!((peaks[3] - 9.0 / 32768.0).abs() < 1e-6);
    }

    #[test]
    fn works_for_tiny_or_unknown_lengths() {
        let mut builder = PeakBuilder::new(0, 4000);
        builder.push(&[5, 6]);
        assert_eq!(builder.finish().len(), 2);
    }

    #[tokio::test]
    async fn a_real_file_gives_about_the_wanted_number_of_peaks() {
        if !crate::ffmpeg_job::sidecars_for_tests() {
            return;
        }
        let file = std::env::temp_dir().join(format!("ave-peaks-{}.wav", std::process::id()));
        let status = std::process::Command::new(crate::ffmpeg::sidecar_path(Tool::Ffmpeg).unwrap())
            .args(["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3"])
            .arg(&file)
            .status()
            .unwrap();
        assert!(status.success());
        let wave = waveform(&file, 3.0).await.unwrap();
        let _ = std::fs::remove_file(&file);
        assert!((PEAK_COUNT..=PEAK_COUNT + 2).contains(&wave.peaks.len()), "{}", wave.peaks.len());
        assert!(wave.peaks.iter().cloned().fold(0.0, f32::max) > 0.1);
    }
}
