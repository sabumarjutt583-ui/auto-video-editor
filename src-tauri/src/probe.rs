//! Reading duration, streams, picture size, sample rate and channels with FFmpeg itself.
//!
//! The installer carries no FFprobe: `ffmpeg -i <file>` prints everything we need to its error output
//! (and then stops with "At least one output file must be specified", which is normal).
//! `parse_info` reads that text; it is pure, so it can be unit tested with real samples.

use std::path::Path;
use std::time::Duration;

use tokio::time::timeout;

use crate::commands::error::AppError;
use crate::ffmpeg::{command, Tool};

const PROBE_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamKind {
    Video,
    Audio,
    Other,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StreamInfo {
    pub kind: StreamKind,
    /// "aac", "h264", "pcm_s16le", "png" ...
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub sample_rate: u32,
    pub channels: u32,
    /// Degrees the picture is turned for display (phone clips), 0 when not turned.
    pub rotation: i32,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ProbeInfo {
    /// Seconds with a precision of 10 ms; `None` for pictures ("N/A").
    pub duration: Option<f64>,
    pub streams: Vec<StreamInfo>,
}

impl ProbeInfo {
    pub fn first(&self, kind: StreamKind) -> Option<&StreamInfo> {
        self.streams.iter().find(|s| s.kind == kind)
    }
}

/// Splits at commas that are not inside (...) or [...].
fn split_top_level(text: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let (mut depth, mut start) = (0i32, 0usize);
    for (i, c) in text.char_indices() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth -= 1,
            ',' if depth == 0 => {
                parts.push(text[start..i].trim());
                start = i + 1;
            }
            _ => {}
        }
    }
    parts.push(text[start..].trim());
    parts
}

/// "00:01:02.50" -> 62.5
fn parse_clock(text: &str) -> Option<f64> {
    let mut seconds = 0.0;
    for part in text.trim().split(':') {
        seconds = seconds * 60.0 + part.parse::<f64>().ok()?;
    }
    Some(seconds)
}

/// "stereo" / "mono" / "5.1(side)" / "2 channels" -> number of channels.
fn channel_count(layout: &str) -> Option<u32> {
    let word = layout.split('(').next()?.trim();
    match word {
        "mono" => return Some(1),
        "stereo" => return Some(2),
        "quad" => return Some(4),
        "hexagonal" => return Some(6),
        "octagonal" => return Some(8),
        _ => {}
    }
    if let Some(n) = word.strip_suffix(" channels").or_else(|| word.strip_suffix(" channel")) {
        return n.trim().parse().ok();
    }
    // "5.1", "7.1", "2.1", "4.0": the digits before and after the dot add up.
    let (a, b) = word.split_once('.')?;
    Some(a.parse::<u32>().ok()? + b.parse::<u32>().ok()?)
}

fn parse_stream(rest: &str) -> StreamInfo {
    let (kind, details) = if let Some(d) = rest.strip_prefix("Video: ") {
        (StreamKind::Video, d)
    } else if let Some(d) = rest.strip_prefix("Audio: ") {
        (StreamKind::Audio, d)
    } else {
        (StreamKind::Other, rest)
    };
    let fields = split_top_level(details);
    let codec = fields.first().and_then(|f| f.split([' ', '(']).next()).unwrap_or("").to_string();
    let mut info = StreamInfo { kind, codec, width: 0, height: 0, sample_rate: 0, channels: 0, rotation: 0 };
    for (i, field) in fields.iter().enumerate().skip(1) {
        match kind {
            StreamKind::Video => {
                // "1920x1080 [SAR 1:1 DAR 16:9]"; the pixel format before it never looks like WxH.
                let word = field.split_whitespace().next().unwrap_or("");
                if let Some((w, h)) = word.split_once('x') {
                    if let (Ok(w), Ok(h)) = (w.parse::<u32>(), h.parse::<u32>()) {
                        if info.width == 0 {
                            info.width = w;
                            info.height = h;
                        }
                    }
                }
            }
            StreamKind::Audio => {
                if let Some(hz) = field.strip_suffix(" Hz") {
                    info.sample_rate = hz.trim().parse().unwrap_or(0);
                    if let Some(layout) = fields.get(i + 1) {
                        info.channels = channel_count(layout).unwrap_or(0);
                    }
                }
            }
            StreamKind::Other => {}
        }
    }
    info
}

/// Reads the text that `ffmpeg -i <file>` prints.
pub fn parse_info(text: &str) -> ProbeInfo {
    let mut info = ProbeInfo::default();
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("Duration: ") {
            let clock = rest.split(',').next().unwrap_or("");
            info.duration = parse_clock(clock).filter(|d| d.is_finite() && *d >= 0.0);
        } else if trimmed.starts_with("Stream #") {
            // "Stream #0:1[0x2](und): Audio: aac ..." -> "Audio: aac ..."
            if let Some((_, rest)) = trimmed.split_once("): ").or_else(|| trimmed.split_once(": ")) {
                info.streams.push(parse_stream(rest));
            }
        } else if let Some(stream) = info.streams.last_mut() {
            // Phone clips: "rotate : 90" (tags) or "displaymatrix: rotation of -90.00 degrees" (side data).
            if let Some(value) = trimmed.strip_prefix("rotate").and_then(|r| r.trim_start().strip_prefix(':')) {
                stream.rotation = value.trim().parse().unwrap_or(0);
            } else if let Some(value) = trimmed.strip_prefix("displaymatrix: rotation of ") {
                let degrees = value.split_whitespace().next().and_then(|d| d.parse::<f64>().ok()).unwrap_or(0.0);
                stream.rotation = degrees.round() as i32;
            }
        }
    }
    info
}

/// Runs `ffmpeg -i <file>` and returns the text it prints. `friendly` is the message when the file cannot be read.
pub async fn probe_text(path: &Path, friendly: &str) -> Result<String, AppError> {
    let mut cmd = command(Tool::Ffmpeg).map_err(|e| AppError::new("The video engine (FFmpeg) is missing or could not start.", e))?;
    cmd.args(["-hide_banner", "-nostdin", "-i"]).arg(path);
    let output = timeout(PROBE_TIMEOUT, cmd.output())
        .await
        .map_err(|_| AppError::new("Reading the file took too long.", "FFmpeg did not answer within 30 seconds."))?
        .map_err(|e| AppError::new("The video engine (FFmpeg) could not start.", e.to_string()))?;
    let text = String::from_utf8_lossy(&output.stderr).to_string();
    // Without an output file FFmpeg always ends with an error exit code. The file is fine when it was recognised.
    if !text.contains("Input #0") {
        return Err(AppError::new(friendly, format!("{}: {}", path.display(), text.trim())));
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    const WAV: &str = "[aist#0:0/pcm_s16le @ 0x558ea69db580] Guessed Channel Layout: mono
Input #0, wav, from 'a.wav':
  Metadata:
    encoder         : Lavf62.12.103
  Duration: 00:00:03.25, bitrate: 705 kb/s
  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, mono, s16, 705 kb/s
At least one output file must be specified";

    const MP4: &str = "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'c.mp4':
  Metadata:
    major_brand     : isom
  Duration: 00:01:02.50, start: 0.000000, bitrate: 260 kb/s
  Stream #0:0[0x1](und): Video: h264 (Constrained Baseline) (avc1 / 0x31637661), yuv420p(progressive), 320x240 [SAR 1:1 DAR 4:3], 179 kb/s, 25 fps, 25 tbr, 12800 tbn (default)
    Metadata:
      handler_name    : VideoHandler
      rotate          : 90
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, 5.1(side), fltp, 69 kb/s (default)
    Metadata:
      handler_name    : SoundHandler";

    const PNG: &str = "Input #0, png_pipe, from 'd.png':
  Duration: N/A, bitrate: N/A
  Stream #0:0: Video: png, rgb24(pc, gbr/unknown/unknown), 800x600 [SAR 1:1 DAR 4:3], 25 fps, 25 tbr, 25 tbn";

    #[test]
    fn reads_a_wav_file() {
        let info = parse_info(WAV);
        assert_eq!(info.duration, Some(3.25));
        let audio = info.first(StreamKind::Audio).unwrap();
        assert_eq!((audio.codec.as_str(), audio.sample_rate, audio.channels), ("pcm_s16le", 44100, 1));
        assert!(info.first(StreamKind::Video).is_none());
    }

    #[test]
    fn reads_a_clip_with_commas_inside_brackets() {
        let info = parse_info(MP4);
        assert_eq!(info.duration, Some(62.5));
        let video = info.first(StreamKind::Video).unwrap();
        assert_eq!((video.codec.as_str(), video.width, video.height, video.rotation), ("h264", 320, 240, 90));
        let audio = info.first(StreamKind::Audio).unwrap();
        assert_eq!((audio.codec.as_str(), audio.sample_rate, audio.channels), ("aac", 48000, 6));
    }

    #[test]
    fn a_picture_has_no_duration() {
        let info = parse_info(PNG);
        assert_eq!(info.duration, None);
        let video = info.first(StreamKind::Video).unwrap();
        assert_eq!((video.codec.as_str(), video.width, video.height), ("png", 800, 600));
    }

    #[test]
    fn reads_the_rotation_of_a_display_matrix() {
        let text = "  Duration: 00:00:05.00, start: 0.0, bitrate: 1 kb/s\n  Stream #0:0: Video: h264, yuv420p, 1080x1920, 30 fps\n    Side data:\n      displaymatrix: rotation of -90.00 degrees";
        assert_eq!(parse_info(text).first(StreamKind::Video).unwrap().rotation, -90);
    }

    #[test]
    fn channel_names() {
        assert_eq!(channel_count("mono"), Some(1));
        assert_eq!(channel_count("stereo"), Some(2));
        assert_eq!(channel_count("5.1"), Some(6));
        assert_eq!(channel_count("7.1(wide)"), Some(8));
        assert_eq!(channel_count("3 channels"), Some(3));
        assert_eq!(channel_count("surprise"), None);
    }

    #[test]
    fn unknown_text_gives_an_empty_answer() {
        let info = parse_info("Error opening input: Invalid data found when processing input");
        assert!(info.streams.is_empty() && info.duration.is_none());
    }
}
