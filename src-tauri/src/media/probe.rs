//! Reading size and length of pictures and clips (with FFmpeg, see `crate::probe`).

use std::path::Path;

use serde::Serialize;

use super::{kind_of, Kind};
use crate::commands::error::AppError;
use crate::probe::{parse_info, probe_text, StreamKind};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub kind: Kind,
    pub width: u32,
    pub height: u32,
    /// Seconds; 0 for pictures.
    pub duration: f64,
}

/// Reads the first video stream of the text `ffmpeg -i` prints. A picture counts as a one-frame video stream.
pub fn parse_probe(text: &str, kind: Kind) -> Result<MediaInfo, String> {
    let info = parse_info(text);
    let stream = info.first(StreamKind::Video).ok_or("The file has no picture in it.")?;
    let (mut width, mut height) = (stream.width, stream.height);
    if width == 0 || height == 0 {
        return Err("The picture size could not be read.".to_string());
    }
    // Phone clips can be stored sideways with a rotation flag; the picture is shown turned.
    if (stream.rotation.unsigned_abs() / 90) % 2 == 1 {
        std::mem::swap(&mut width, &mut height);
    }
    let duration = match kind {
        Kind::Image => 0.0,
        Kind::Video => info.duration.filter(|d| *d > 0.0).ok_or("The clip length could not be read.")?,
    };
    Ok(MediaInfo { kind, width, height, duration })
}

/// Runs FFmpeg on a picture or clip.
pub async fn probe(path: &Path) -> Result<MediaInfo, AppError> {
    let kind = kind_of(path).ok_or_else(|| {
        AppError::new("This file type is not supported. Please use png, jpg, jpeg, webp, mp4, mov or webm.", format!("Unsupported file: {}", path.display()))
    })?;
    let text = probe_text(path, "This file could not be read. It may be damaged.").await?;
    parse_probe(&text, kind).map_err(|details| AppError::new("This file does not look like a normal picture or clip.", format!("{}: {details}", path.display())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_picture() {
        let text = "  Duration: N/A, bitrate: N/A\n  Stream #0:0: Video: png, rgb24(pc, gbr/unknown/unknown), 1920x1080 [SAR 1:1 DAR 16:9], 25 fps, 25 tbr, 25 tbn";
        let info = parse_probe(text, Kind::Image).unwrap();
        assert_eq!((info.width, info.height, info.duration), (1920, 1080, 0.0));
    }

    #[test]
    fn reads_a_clip_and_its_rotation() {
        let text = "  Duration: 00:00:06.25, start: 0.000000, bitrate: 900 kb/s\n  Stream #0:0[0x1](und): Video: h264 (High), yuv420p(progressive), 1920x1080, 900 kb/s, 30 fps (default)\n    Side data:\n      displaymatrix: rotation of -90.00 degrees\n  Stream #0:1: Audio: aac (LC), 48000 Hz, stereo, fltp";
        let info = parse_probe(text, Kind::Video).unwrap();
        assert_eq!((info.width, info.height), (1080, 1920));
        assert!((info.duration - 6.25).abs() < 1e-9);
    }

    #[test]
    fn broken_files_give_reasons() {
        assert!(parse_probe("  Stream #0:0: Audio: mp3, 44100 Hz, stereo", Kind::Video).is_err());
        assert!(parse_probe("  Duration: N/A\n  Stream #0:0: Video: h264, yuv420p, 10x10", Kind::Video).is_err());
        assert!(parse_probe("nope", Kind::Image).is_err());
    }
}
