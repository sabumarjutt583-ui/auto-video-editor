//! Saving a custom style with its pictures, and adding one from an `.avstyle` file. The commands call these; the
//! FFmpeg command is passed in, so the tests can use the one of the computer they run on.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use super::package;
use super::refs::{self, Meta};
use super::new_id;
use crate::commands::error::AppError;
use crate::styles::{self, StyleProfile};
use crate::thumbnails;

pub const DEFAULT_CATEGORY: &str = "My Styles";

fn version_or_default(version: &str) -> String {
    let parts: Vec<&str> = version.trim().split('.').collect();
    if parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit())) {
        version.trim().to_string()
    } else {
        "1.0.0".into()
    }
}

/// Saves the style, keeps `sources` (prepared pictures) as its references and makes its thumbnail from the first one.
pub async fn save(custom_dir: &Path, mut style: StyleProfile, sources: Vec<PathBuf>, meta: Meta, ffmpeg: &(dyn Fn() -> Result<tokio::process::Command, AppError> + Sync)) -> Result<StyleProfile, AppError> {
    if sources.is_empty() {
        return Err(AppError::new("Please keep at least one reference picture.", "no pictures"));
    }
    if style.version.trim().is_empty() {
        style.version = "1.0.0".into();
    }
    // The thumbnail first: when the picture cannot be converted nothing has been written yet.
    thumbnails::convert_with(ffmpeg()?, &sources[0], &custom_dir.join(thumbnails::rel_path(&style.id))).await?;
    refs::store(custom_dir, &style.id, &sources, &meta)?;
    styles::save_custom(custom_dir, style)
}

/// Adds the style in an `.avstyle` file as a new custom style. It never replaces one: a taken id gets a number.
pub async fn import(custom_dir: &Path, prep_dir: &Path, data: &[u8], ffmpeg: &(dyn Fn() -> Result<tokio::process::Command, AppError> + Sync)) -> Result<StyleProfile, AppError> {
    let package = package::read(data)?;
    // Every picture goes through the same check and shrinking as a picture the person chose.
    fs::create_dir_all(prep_dir).map_err(|e| AppError::new("The picture folder could not be created.", e.to_string()))?;
    let mut prepared: Vec<PathBuf> = Vec::new();
    for (index, (name, bytes)) in package.images.iter().enumerate() {
        let extension = Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("jpg");
        let temp = prep_dir.join(format!("import_{}_{index}.{extension}", std::process::id()));
        fs::write(&temp, bytes).map_err(|e| AppError::new("A picture of the style file could not be unpacked.", e.to_string()))?;
        let result = refs::prepare(ffmpeg()?, &temp, prep_dir).await;
        let _ = fs::remove_file(&temp);
        prepared.push(PathBuf::from(result?.path));
    }

    let mut style = package.style;
    let taken: HashSet<String> = fs::read_dir(custom_dir)
        .map(|entries| entries.flatten().filter_map(|e| e.path().file_stem().map(|s| s.to_string_lossy().into_owned())).collect())
        .unwrap_or_default();
    style.id = new_id(&style.name, &taken);
    style.category = if style.category.trim().is_empty() { DEFAULT_CATEGORY.into() } else { style.category };
    style.version = version_or_default(&style.version);
    style.thumbnail = String::new();
    if prepared.is_empty() {
        return styles::save_custom(custom_dir, style);
    }
    let saved = save(custom_dir, style, prepared.clone(), package.meta, ffmpeg).await;
    for file in &prepared {
        let _ = fs::remove_file(file);
    }
    saved
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_x_y_z_versions_are_kept_on_import() {
        assert_eq!(version_or_default(" 2.1.0 "), "2.1.0");
        for odd in ["", "1.0", "a.b.c", "1.0.0-beta", "1..0"] {
            assert_eq!(version_or_default(odd), "1.0.0", "{odd}");
        }
    }

    fn system_ffmpeg() -> Option<&'static str> {
        // The FFmpeg that is installed as the app's sidecar when developing, else the one of the computer.
        let sidecar = concat!(env!("CARGO_MANIFEST_DIR"), "/binaries/ffmpeg-x86_64-unknown-linux-gnu");
        let path = [sidecar, "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"].into_iter().find(|p| Path::new(p).is_file())?;
        let out = std::process::Command::new(path).args(["-hide_banner", "-encoders"]).output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        (text.contains("libwebp") && text.contains("mjpeg")).then_some(path)
    }

    fn picture(ffmpeg: &str, path: &Path, color: &str) -> bool {
        std::process::Command::new(ffmpeg).args(["-v", "error", "-f", "lavfi", "-i", &format!("color=c={color}:size=1600x1200:rate=1"), "-frames:v", "1", "-y"]).arg(path).status().is_ok_and(|s| s.success())
    }

    fn size_of(ffmpeg: &str, path: &Path) -> (u32, u32) {
        let probe = std::process::Command::new(ffmpeg).args(["-hide_banner", "-i"]).arg(path).output().unwrap();
        let info = crate::probe::parse_info(&String::from_utf8_lossy(&probe.stderr));
        let video = info.first(crate::probe::StreamKind::Video).expect("a picture");
        (video.width, video.height)
    }

    fn draft(id: &str) -> StyleProfile {
        StyleProfile { id: id.into(), name: "Soft Look".into(), category: "My Styles".into(), version: "1.0.0".into(), style_lock: "soft, warm".into(), ..styles::parse_style(r#"{"id":"x","name":"x","category":"x"}"#).unwrap() }
    }

    /// The whole life of a custom style on disk: pictures -> saved with thumbnail -> found after a "restart"
    /// -> exported -> imported as a second style -> deleted. Needs a system FFmpeg with libwebp; skipped without one.
    #[tokio::test]
    async fn a_style_is_saved_listed_exported_imported_and_deleted() {
        let Some(ffmpeg) = system_ffmpeg() else {
            eprintln!("skipped: no FFmpeg with libwebp");
            return;
        };
        let work = std::env::temp_dir().join(format!("ave-service-{}", std::process::id()));
        let _ = fs::remove_dir_all(&work);
        let custom = work.join("styles");
        let prep = custom.join("prep");
        fs::create_dir_all(&work).unwrap();
        let make = || -> Result<tokio::process::Command, AppError> { Ok(tokio::process::Command::new(ffmpeg)) };

        let mut prepared = Vec::new();
        for (n, color) in ["red", "green", "blue"].iter().enumerate() {
            let source = work.join(format!("in{n}.png"));
            assert!(picture(ffmpeg, &source, color));
            prepared.push(PathBuf::from(refs::prepare(make().unwrap(), &source, &prep).await.unwrap().path));
        }
        assert_eq!(size_of(ffmpeg, &prepared[0]), (1024, 768), "shrunk to at most 1024 px");

        let meta = Meta { description: "warm and calm".into(), engine: "gemini".into() };
        let saved = save(&custom, draft("custom_soft_look"), prepared.clone(), meta, &make).await.unwrap();
        assert!(saved.thumbnail.ends_with("custom_soft_look.webp") && Path::new(&saved.thumbnail).is_file());
        assert_eq!(size_of(ffmpeg, Path::new(&saved.thumbnail)), (480, 360));
        assert_eq!(refs::load(&custom, "custom_soft_look").unwrap().images.len(), 3);

        // "Restart": the style list is read from disk again. The preparation folder is not mistaken for a style.
        let listed = styles::load_all(&work.join("no-builtin"), &custom);
        assert_eq!(listed.styles.len(), 1, "{:?}", listed.warnings);
        assert_eq!(listed.styles[0].name, "Soft Look");
        assert!(Path::new(&listed.styles[0].thumbnail).is_absolute());

        // Export and import give a second, independent style.
        let bytes = package::build(&custom, "custom_soft_look").unwrap();
        let again = import(&custom, &prep, &bytes, &make).await.unwrap();
        assert_eq!(again.id, "custom_soft_look_2");
        assert_eq!(again.name, "Soft Look");
        assert!(Path::new(&again.thumbnail).is_file());
        let kept = refs::load(&custom, "custom_soft_look_2").unwrap();
        assert_eq!((kept.images.len(), kept.description.as_str(), kept.engine.as_str()), (3, "warm and calm", "gemini"));
        assert_eq!(styles::load_all(&work.join("no-builtin"), &custom).styles.len(), 2);

        // Deleting one leaves the other untouched.
        styles::delete_custom(&custom, "custom_soft_look").unwrap();
        refs::remove(&custom, "custom_soft_look");
        assert!(refs::load(&custom, "custom_soft_look").is_none());
        assert!(!custom.join("thumbnails/custom_soft_look.webp").exists());
        assert!(refs::load(&custom, "custom_soft_look_2").is_some());

        // A file that is not a style file is refused and nothing is added.
        assert!(import(&custom, &prep, b"nope", &make).await.is_err());
        assert_eq!(styles::load_all(&work.join("no-builtin"), &custom).styles.len(), 1);
        let _ = fs::remove_dir_all(work);
    }

    #[tokio::test]
    async fn saving_without_pictures_is_refused_before_anything_is_written() {
        let work = std::env::temp_dir().join(format!("ave-service-none-{}", std::process::id()));
        let make = || -> Result<tokio::process::Command, AppError> { Ok(tokio::process::Command::new("ffmpeg")) };
        let error = save(&work, draft("custom_a"), vec![], Meta::default(), &make).await.unwrap_err();
        assert!(error.message.contains("at least one reference picture"));
        assert!(!work.exists());
    }
}
