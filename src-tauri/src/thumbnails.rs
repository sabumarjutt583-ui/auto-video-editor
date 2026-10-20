//! Style thumbnails: any picture is cropped to 4:3, resized to 480x360 and saved as WebP with the bundled FFmpeg.

use std::path::Path;
#[cfg(feature = "admin")]
use std::path::PathBuf;
use std::time::Duration;

#[cfg(feature = "admin")]
use serde::Serialize;
use tokio::time::timeout;

use crate::commands::error::AppError;
use crate::ffmpeg::{command, Tool};

pub const WIDTH: u32 = 480;
pub const HEIGHT: u32 = 360;
const QUALITY: u32 = 80;
const MAX_INPUT_BYTES: u64 = 40 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(60);
pub const FOLDER: &str = "thumbnails";

/// "thumbnails/<id>.webp": how a profile points to its picture.
pub fn rel_path(id: &str) -> String {
    format!("{FOLDER}/{id}.webp")
}

pub fn is_picture(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| ["png", "jpg", "jpeg", "webp"].contains(&e.to_ascii_lowercase().as_str()))
}

/// The FFmpeg options: center-crop to 4:3, scale to 480x360, one WebP frame.
pub fn ffmpeg_args(input: &Path, output: &Path) -> Vec<String> {
    let filter = format!("scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,crop={WIDTH}:{HEIGHT},setsar=1");
    vec![
        "-y".into(),
        "-v".into(),
        "error".into(),
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-vf".into(),
        filter,
        "-frames:v".into(),
        "1".into(),
        "-c:v".into(),
        "libwebp".into(),
        "-quality".into(),
        QUALITY.to_string(),
        output.to_string_lossy().into_owned(),
    ]
}

/// Converts one picture. The output folder is created when needed.
pub async fn convert(input: &Path, output: &Path) -> Result<(), AppError> {
    let cmd = command(Tool::Ffmpeg).map_err(|e| AppError::new("The video engine (FFmpeg) is missing or could not start.", e))?;
    convert_with(cmd, input, output).await
}

/// Same as `convert`, with the FFmpeg command given (the tests use the system one).
pub async fn convert_with(mut cmd: tokio::process::Command, input: &Path, output: &Path) -> Result<(), AppError> {
    if !is_picture(input) {
        return Err(AppError::new("Please choose a PNG, JPG or WebP picture.", format!("{}", input.display())));
    }
    let size = std::fs::metadata(input).map_err(|e| AppError::new("The picture could not be read.", format!("{e} ({})", input.display())))?.len();
    if size == 0 || size > MAX_INPUT_BYTES {
        return Err(AppError::new("The picture is empty or too big (the limit is 40 MB).", format!("{size} bytes")));
    }
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::new("The thumbnail folder could not be created.", format!("{e} ({})", parent.display())))?;
    }
    let temp = output.with_extension("tmp.webp");
    cmd.args(ffmpeg_args(input, &temp));
    let out = timeout(TIMEOUT, cmd.output())
        .await
        .map_err(|_| AppError::new("The picture took too long to convert.", format!("{}", input.display())))?
        .map_err(|e| AppError::new("The video engine (FFmpeg) could not start.", e.to_string()))?;
    if !out.status.success() || !temp.is_file() {
        let _ = std::fs::remove_file(&temp);
        return Err(AppError::new("The picture could not be converted. It may be damaged.", String::from_utf8_lossy(&out.stderr).trim().to_string()));
    }
    std::fs::rename(&temp, output).map_err(|e| AppError::new("The thumbnail could not be saved.", format!("{e} ({})", output.display())))
}

#[cfg(feature = "admin")]
/// Sets `"thumbnail": "<rel>"` in the text of a profile file, keeping every other line as it is.
pub fn set_thumbnail_field(text: &str, rel: &str) -> String {
    let line = format!("\"thumbnail\": \"{rel}\"");
    if let Some(key) = text.find("\"thumbnail\"") {
        let after = &text[key + "\"thumbnail\"".len()..];
        if let Some(colon) = after.find(':') {
            let value_start = key + "\"thumbnail\"".len() + colon + 1;
            let rest = &text[value_start..];
            let quote_open = rest.find('"');
            if let Some(open) = quote_open {
                let from = value_start + open + 1;
                if let Some(close) = text[from..].find('"') {
                    return format!("{}{}{}", &text[..key], line, &text[from + close + 1..]);
                }
            }
        }
    }
    // No thumbnail key yet: add it before the closing brace.
    match text.rfind('}') {
        Some(end) => {
            let head = text[..end].trim_end();
            let comma = if head.ends_with('{') { "" } else { "," };
            format!("{head}{comma}\n  {line}\n}}\n")
        }
        None => text.to_string(),
    }
}

#[cfg(feature = "admin")]
#[derive(Debug, Serialize, Default, PartialEq)]
pub struct ImportReport {
    /// Ids that now have a thumbnail.
    pub imported: Vec<String>,
    /// File name and a short reason for each picture that failed.
    pub failed: Vec<(String, String)>,
}

#[cfg(feature = "admin")]
/// Converts the pictures into `<dir>/thumbnails/<id>.webp` and points existing profiles in `<dir>` to them.
pub async fn import_into(dir: &Path, items: &[(String, PathBuf)]) -> ImportReport {
    import_with(dir, items, || command(Tool::Ffmpeg).map_err(|e| AppError::new("The video engine (FFmpeg) is missing or could not start.", e))).await
}

#[cfg(feature = "admin")]
pub async fn import_with(dir: &Path, items: &[(String, PathBuf)], make: impl Fn() -> Result<tokio::process::Command, AppError>) -> ImportReport {
    let mut report = ImportReport::default();
    for (id, source) in items {
        let name = source.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if !crate::styles::valid_id(id) {
            report.failed.push((name, "the style id is not valid".into()));
            continue;
        }
        let result = match make() {
            Ok(cmd) => convert_with(cmd, source, &dir.join(FOLDER).join(format!("{id}.webp"))).await,
            Err(e) => Err(e),
        };
        match result {
            Ok(()) => {
                let profile = dir.join(format!("{id}.json"));
                if let Ok(text) = std::fs::read_to_string(&profile) {
                    let _ = std::fs::write(&profile, set_thumbnail_field(&text, &rel_path(id)));
                }
                report.imported.push(id.clone());
            }
            Err(e) => report.failed.push((name, e.message)),
        }
    }
    report
}

#[cfg(feature = "admin")]
/// Ids of the profiles in `dir` that have no thumbnail file yet.
pub fn missing_in(dir: &Path) -> Vec<String> {
    let mut warnings = Vec::new();
    let mut ids: Vec<String> = crate::styles::load_dir(dir, true, &mut warnings).into_iter().filter(|s| s.thumbnail.is_empty()).map(|s| s.id).collect();
    ids.sort();
    ids
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(feature = "admin")]
    #[test]
    fn the_field_is_replaced_or_added_without_touching_other_lines() {
        let with = "{\n  \"id\": \"a\",\n  \"thumbnail\": \"\",\n  \"builtin\": true\n}\n";
        assert_eq!(set_thumbnail_field(with, "thumbnails/a.webp"), "{\n  \"id\": \"a\",\n  \"thumbnail\": \"thumbnails/a.webp\",\n  \"builtin\": true\n}\n");
        let without = "{\n  \"id\": \"a\",\n  \"name\": \"A\"\n}\n";
        let added = set_thumbnail_field(without, "thumbnails/a.webp");
        assert_eq!(added, "{\n  \"id\": \"a\",\n  \"name\": \"A\",\n  \"thumbnail\": \"thumbnails/a.webp\"\n}\n");
        assert!(serde_json::from_str::<serde_json::Value>(&added).is_ok());
        let again = set_thumbnail_field(&added, "thumbnails/b.webp");
        assert!(again.contains("thumbnails/b.webp") && !again.contains("thumbnails/a.webp"));
    }

    #[test]
    fn the_options_crop_to_four_by_three() {
        let args = ffmpeg_args(Path::new("in.png"), Path::new("out.webp"));
        assert!(args.iter().any(|a| a.contains("scale=480:360") && a.contains("crop=480:360")));
        assert!(args.windows(2).any(|w| w == ["-c:v", "libwebp"]));
        assert_eq!(rel_path("noir"), "thumbnails/noir.webp");
    }

    #[test]
    fn only_pictures_are_accepted() {
        assert!(is_picture(Path::new("A.PNG")) && is_picture(Path::new("b.jpeg")) && is_picture(Path::new("c.webp")));
        assert!(!is_picture(Path::new("d.gif")) && !is_picture(Path::new("e")));
    }

    #[cfg(feature = "admin")]
    /// Needs an FFmpeg with libwebp; the test is skipped when none is available.
    #[tokio::test]
    async fn a_wide_picture_becomes_a_480_by_360_webp() {
        let Some(ffmpeg) = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"].iter().find(|p| Path::new(p).is_file()) else { return };
        let work = std::env::temp_dir().join(format!("ave-thumb-work-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        std::fs::create_dir_all(&work).unwrap();
        let source = work.join("wide.png");
        let made = std::process::Command::new(ffmpeg).args(["-v", "error", "-f", "lavfi", "-i", "testsrc=size=1600x900:rate=1", "-frames:v", "1", "-y"]).arg(&source).status();
        if !made.map(|s| s.success()).unwrap_or(false) {
            return;
        }
        std::fs::write(work.join("t.json"), "{\n  \"id\": \"t\",\n  \"name\": \"T\",\n  \"category\": \"C\",\n  \"thumbnail\": \"\"\n}\n").unwrap();
        let path = ffmpeg.to_string();
        let report = import_with(&work, &[("t".into(), source)], || Ok(tokio::process::Command::new(&path))).await;
        if !report.failed.is_empty() {
            eprintln!("skipped: {:?}", report.failed);
            return;
        }
        assert_eq!(report.imported, vec!["t".to_string()]);
        let out = work.join("thumbnails").join("t.webp");
        assert!(out.is_file());
        let probe = std::process::Command::new(&path).args(["-hide_banner", "-i"]).arg(&out).output();
        if let Ok(probe) = probe {
            let info = crate::probe::parse_info(&String::from_utf8_lossy(&probe.stderr));
            let video = info.first(crate::probe::StreamKind::Video).expect("a picture");
            assert_eq!((video.width, video.height), (480, 360));
        }
        assert!(std::fs::read_to_string(work.join("t.json")).unwrap().contains("thumbnails/t.webp"));
        let mut warnings = Vec::new();
        let loaded = crate::styles::load_dir(&work, true, &mut warnings);
        assert!(loaded[0].thumbnail.ends_with("t.webp") && Path::new(&loaded[0].thumbnail).is_absolute());
        let _ = std::fs::remove_dir_all(&work);
    }
}
