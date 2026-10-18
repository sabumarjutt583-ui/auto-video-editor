//! Reading duration, sample rate and channels with FFprobe.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::time::timeout;

use crate::commands::error::AppError;
use crate::ffmpeg::{command, Tool};

const PROBE_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioInfo {
    pub duration: f64,
    pub sample_rate: u32,
    pub channels: u32,
    pub codec: String,
}

/// Reads the first audio stream from FFprobe's JSON output.
pub fn parse_probe(json: &str) -> Result<AudioInfo, String> {
    let value: Value = serde_json::from_str(json).map_err(|e| format!("FFprobe answer was not JSON: {e}"))?;
    let stream = value
        .get("streams")
        .and_then(Value::as_array)
        .and_then(|streams| streams.iter().find(|s| s.get("codec_type").and_then(Value::as_str) == Some("audio")))
        .ok_or("The file has no audio stream.")?;

    let number = |v: Option<&Value>| -> Option<f64> {
        match v? {
            Value::String(text) => text.trim().parse().ok(),
            Value::Number(n) => n.as_f64(),
            _ => None,
        }
    };
    let duration = number(value.pointer("/format/duration"))
        .or_else(|| number(stream.get("duration")))
        .filter(|d| d.is_finite() && *d > 0.0)
        .ok_or("The audio length could not be read.")?;
    let sample_rate = number(stream.get("sample_rate")).map_or(0, |v| v as u32);
    let channels = number(stream.get("channels")).map_or(0, |v| v as u32);
    if sample_rate == 0 || channels == 0 {
        return Err("The sample rate or channel count could not be read.".to_string());
    }
    let codec = stream.get("codec_name").and_then(Value::as_str).unwrap_or("unknown").to_string();
    Ok(AudioInfo { duration, sample_rate, channels, codec })
}

/// Runs FFprobe on a file and returns its audio info.
pub async fn probe(path: &std::path::Path) -> Result<AudioInfo, AppError> {
    let mut cmd = command(Tool::Ffprobe).map_err(|e| AppError::new("The video engine (FFmpeg) is missing or could not start.", e))?;
    cmd.args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams"]).arg(path);
    let output = timeout(PROBE_TIMEOUT, cmd.output())
        .await
        .map_err(|_| AppError::new("Reading the audio file took too long.", "FFprobe did not answer within 30 seconds."))?
        .map_err(|e| AppError::new("The video engine (FFmpeg) could not start.", e.to_string()))?;

    if !output.status.success() {
        return Err(AppError::new(
            "This file could not be read as audio. It may be damaged or not an audio file.",
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    parse_probe(&String::from_utf8_lossy(&output.stdout)).map_err(|details| {
        AppError::new("This file does not seem to contain readable audio.", details)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
      "streams": [
        {"codec_type":"video","codec_name":"mjpeg"},
        {"codec_type":"audio","codec_name":"mp3","sample_rate":"44100","channels":2,"duration":"120.50"}
      ],
      "format": {"duration":"120.552000"}
    }"#;

    #[test]
    fn reads_the_audio_stream() {
        let info = parse_probe(SAMPLE).unwrap();
        assert_eq!(info.sample_rate, 44100);
        assert_eq!(info.channels, 2);
        assert_eq!(info.codec, "mp3");
        assert!((info.duration - 120.552).abs() < 1e-9, "format duration wins");
    }

    #[test]
    fn falls_back_to_the_stream_duration() {
        let json = r#"{"streams":[{"codec_type":"audio","codec_name":"flac","sample_rate":"48000","channels":1,"duration":"3.25"}],"format":{}}"#;
        assert_eq!(parse_probe(json).unwrap().duration, 3.25);
    }

    #[test]
    fn refuses_files_without_usable_audio() {
        assert!(parse_probe("not json").is_err());
        assert!(parse_probe(r#"{"streams":[{"codec_type":"video"}],"format":{"duration":"5"}}"#).unwrap_err().contains("no audio"));
        assert!(parse_probe(r#"{"streams":[{"codec_type":"audio","sample_rate":"44100","channels":2}],"format":{}}"#).is_err());
        assert!(parse_probe(r#"{"streams":[{"codec_type":"audio","sample_rate":"0","channels":2,"duration":"1"}],"format":{}}"#).is_err());
    }
}
