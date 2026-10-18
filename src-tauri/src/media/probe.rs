//! Reading size and length of pictures and clips with FFprobe.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tokio::time::timeout;

use super::{kind_of, Kind};
use crate::commands::error::AppError;
use crate::ffmpeg::{command, Tool};

const PROBE_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub kind: Kind,
    pub width: u32,
    pub height: u32,
    /// Seconds; 0 for pictures.
    pub duration: f64,
}

fn number(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::String(text) => text.trim().parse().ok(),
        Value::Number(n) => n.as_f64(),
        _ => None,
    }
}

/// Reads the first video stream of FFprobe's JSON output. A picture counts as a one-frame video stream.
pub fn parse_probe(json: &str, kind: Kind) -> Result<MediaInfo, String> {
    let value: Value = serde_json::from_str(json).map_err(|e| format!("FFprobe answer was not JSON: {e}"))?;
    let stream = value
        .get("streams")
        .and_then(Value::as_array)
        .and_then(|streams| streams.iter().find(|s| s.get("codec_type").and_then(Value::as_str) == Some("video")))
        .ok_or("The file has no picture in it.")?;
    let mut width = number(stream.get("width")).map_or(0, |v| v as u32);
    let mut height = number(stream.get("height")).map_or(0, |v| v as u32);
    if width == 0 || height == 0 {
        return Err("The picture size could not be read.".to_string());
    }
    // Phone clips can be stored sideways with a rotation flag; the picture is shown turned.
    let rotation = number(stream.pointer("/side_data_list/0/rotation")).or_else(|| number(stream.pointer("/tags/rotate"))).unwrap_or(0.0);
    if (rotation.abs() as i64 / 90) % 2 == 1 {
        std::mem::swap(&mut width, &mut height);
    }
    let duration = match kind {
        Kind::Image => 0.0,
        Kind::Video => number(value.pointer("/format/duration"))
            .or_else(|| number(stream.get("duration")))
            .filter(|d| d.is_finite() && *d > 0.0)
            .ok_or("The clip length could not be read.")?,
    };
    Ok(MediaInfo { kind, width, height, duration })
}

/// Runs FFprobe on a picture or clip.
pub async fn probe(path: &Path) -> Result<MediaInfo, AppError> {
    let kind = kind_of(path).ok_or_else(|| {
        AppError::new("This file type is not supported. Please use png, jpg, jpeg, webp, mp4, mov or webm.", format!("Unsupported file: {}", path.display()))
    })?;
    let mut cmd = command(Tool::Ffprobe).map_err(|e| AppError::new("The video engine (FFmpeg) is missing or could not start.", e))?;
    cmd.args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams"]).arg(path);
    let output = timeout(PROBE_TIMEOUT, cmd.output())
        .await
        .map_err(|_| AppError::new("Reading the file took too long.", "FFprobe did not answer within 30 seconds."))?
        .map_err(|e| AppError::new("The video engine (FFmpeg) could not start.", e.to_string()))?;
    if !output.status.success() {
        return Err(AppError::new(
            "This file could not be read. It may be damaged.",
            format!("{}: {}", path.display(), String::from_utf8_lossy(&output.stderr).trim()),
        ));
    }
    parse_probe(&String::from_utf8_lossy(&output.stdout), kind).map_err(|details| AppError::new("This file does not look like a normal picture or clip.", format!("{}: {details}", path.display())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_picture() {
        let json = r#"{"streams":[{"codec_type":"video","codec_name":"png","width":1920,"height":1080}],"format":{"duration":"N/A"}}"#;
        let info = parse_probe(json, Kind::Image).unwrap();
        assert_eq!((info.width, info.height, info.duration), (1920, 1080, 0.0));
    }

    #[test]
    fn reads_a_clip_and_its_rotation() {
        let json = r#"{"streams":[{"codec_type":"video","width":1920,"height":1080,"side_data_list":[{"rotation":-90}]},{"codec_type":"audio"}],"format":{"duration":"6.250000"}}"#;
        let info = parse_probe(json, Kind::Video).unwrap();
        assert_eq!((info.width, info.height), (1080, 1920));
        assert!((info.duration - 6.25).abs() < 1e-9);
    }

    #[test]
    fn broken_files_give_reasons() {
        assert!(parse_probe(r#"{"streams":[{"codec_type":"audio"}]}"#, Kind::Video).is_err());
        assert!(parse_probe(r#"{"streams":[{"codec_type":"video","width":10,"height":10}],"format":{}}"#, Kind::Video).is_err());
        assert!(parse_probe("nope", Kind::Image).is_err());
    }
}
