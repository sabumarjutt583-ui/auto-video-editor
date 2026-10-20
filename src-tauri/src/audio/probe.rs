//! Reading duration, sample rate and channels of an audio file (with FFmpeg, see `crate::probe`).

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::commands::error::AppError;
use crate::probe::{parse_info, StreamKind};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioInfo {
    pub duration: f64,
    pub sample_rate: u32,
    pub channels: u32,
    pub codec: String,
}

/// Reads the first audio stream from the text `ffmpeg -i` prints.
pub fn parse_probe(text: &str) -> Result<AudioInfo, String> {
    let info = parse_info(text);
    let stream = info.first(StreamKind::Audio).ok_or("The file has no audio stream.")?;
    let duration = info.duration.filter(|d| *d > 0.0).ok_or("The audio length could not be read.")?;
    if stream.sample_rate == 0 || stream.channels == 0 {
        return Err("The sample rate or channel count could not be read.".to_string());
    }
    Ok(AudioInfo { duration, sample_rate: stream.sample_rate, channels: stream.channels, codec: stream.codec.clone() })
}

/// Runs FFmpeg on a file and returns its audio info.
pub async fn probe(path: &Path) -> Result<AudioInfo, AppError> {
    let text = crate::probe::probe_text(path, "This file could not be read as audio. It may be damaged or not an audio file.").await?;
    parse_probe(&text).map_err(|details| AppError::new("This file does not seem to contain readable audio.", details))
}


#[cfg(test)]
mod tests {
    use super::*;

    const MP3: &str = "Input #0, mp3, from 'b.mp3':
  Duration: 00:02:00.55, start: 0.025057, bitrate: 128 kb/s
  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, stereo, fltp, 128 kb/s
  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 500x500 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn (attached pic)";

    #[test]
    fn reads_the_audio_stream() {
        let info = parse_probe(MP3).unwrap();
        assert_eq!((info.sample_rate, info.channels, info.codec.as_str()), (44100, 2, "mp3"));
        assert!((info.duration - 120.55).abs() < 1e-9);
    }

    #[test]
    fn refuses_files_without_usable_audio() {
        assert!(parse_probe("Error").unwrap_err().contains("no audio"));
        let picture = "  Duration: N/A, bitrate: N/A\n  Stream #0:0: Video: png, rgb24, 8x8";
        assert!(parse_probe(picture).unwrap_err().contains("no audio"));
        let no_length = "  Duration: N/A, bitrate: N/A\n  Stream #0:0: Audio: pcm_s16le, 44100 Hz, mono, s16";
        assert!(parse_probe(no_length).is_err());
        let no_rate = "  Duration: 00:00:01.00, bitrate: 1 kb/s\n  Stream #0:0: Audio: xyz, 0 Hz, mono, s16";
        assert!(parse_probe(no_rate).is_err());
    }
}
