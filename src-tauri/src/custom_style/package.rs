//! The `.avstyle` file: one zip with the style profile (`style.json`), the notes (`meta.json`) and the reference
//! pictures (`images/ref1.jpg` ...). Made with the app's own zip code, no extra libraries.

use std::fs;
use std::path::Path;

use serde_json::json;

use super::refs::{self, Meta, MAX_BYTES, MAX_IMAGES};
use crate::commands::error::AppError;
use crate::library::zip::{read_zip, safe_name, write_stored, ZipEntry};
use crate::styles::{self, StyleProfile};

pub const EXTENSION: &str = "avstyle";
const FORMAT: u64 = 1;
/// A style file is a profile and a few small pictures; anything bigger is not one.
pub const MAX_FILE_BYTES: u64 = 60 * 1024 * 1024;

/// What an `.avstyle` file holds.
#[derive(Debug, Clone, PartialEq)]
pub struct Package {
    pub style: StyleProfile,
    pub meta: Meta,
    /// File name and bytes of each picture, in order.
    pub images: Vec<(String, Vec<u8>)>,
}

fn bad(why: impl Into<String>) -> AppError {
    let why = why.into();
    AppError::new("This is not a style file made by this app, or it is damaged.", why)
}

/// Packs the custom style `id` (profile, notes and pictures) into the bytes of an `.avstyle` file.
pub fn build(custom_dir: &Path, id: &str) -> Result<Vec<u8>, AppError> {
    if !id.starts_with(styles::CUSTOM_PREFIX) || !styles::valid_id(id) {
        return Err(AppError::new("Only your own styles can be exported.", format!("Not a custom style id: {id:?}")));
    }
    let text = fs::read_to_string(custom_dir.join(format!("{id}.json"))).map_err(|e| AppError::new("The style could not be read.", e.to_string()))?;
    let mut style = styles::parse_style(&text).map_err(|why| AppError::new("The style could not be read.", why))?;
    style.thumbnail = String::new();
    let profile = serde_json::to_string_pretty(&style).map_err(|e| AppError::new("The style could not be exported.", e.to_string()))?;
    let mut entries = vec![ZipEntry { name: "style.json".into(), data: profile.into_bytes() }];
    let refs = refs::load(custom_dir, id);
    let meta = refs.as_ref().map(|r| (r.description.clone(), r.engine.clone())).unwrap_or_default();
    let notes = json!({ "format": FORMAT, "description": meta.0, "engine": meta.1 });
    entries.push(ZipEntry { name: "meta.json".into(), data: serde_json::to_vec_pretty(&notes).unwrap_or_default() });
    if let Some(refs) = refs {
        for (index, image) in refs.images.iter().enumerate() {
            let data = fs::read(&image.path).map_err(|e| AppError::new("A reference picture could not be read.", format!("{e} ({})", image.path)))?;
            entries.push(ZipEntry { name: format!("images/ref{}.jpg", index + 1), data });
        }
    }
    Ok(write_stored(&entries))
}

fn is_picture_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".jpg", ".jpeg", ".png", ".webp"].iter().any(|e| lower.ends_with(e))
}

/// Reads the bytes of an `.avstyle` file. Nothing is written; names that point outside a folder are refused.
pub fn read(data: &[u8]) -> Result<Package, AppError> {
    let entries = read_zip(data).map_err(bad)?;
    if let Some(entry) = entries.iter().find(|e| !safe_name(&e.name)) {
        return Err(bad(format!("unsafe file name {:?}", entry.name)));
    }
    let profile = entries.iter().find(|e| e.name == "style.json").ok_or_else(|| bad("style.json is missing"))?;
    let style = styles::parse_style(&String::from_utf8_lossy(&profile.data)).map_err(|why| bad(format!("style.json: {why}")))?;
    let meta: Meta = entries.iter().find(|e| e.name == "meta.json").and_then(|e| serde_json::from_slice(&e.data).ok()).unwrap_or_default();
    let mut images: Vec<(String, Vec<u8>)> = entries.iter().filter(|e| e.name.starts_with("images/") && is_picture_name(&e.name)).map(|e| (e.name.clone(), e.data.clone())).collect();
    images.sort_by(|a, b| a.0.cmp(&b.0));
    if images.len() > MAX_IMAGES {
        return Err(bad(format!("{} pictures (the limit is {MAX_IMAGES})", images.len())));
    }
    if let Some((name, _)) = images.iter().find(|(_, data)| data.is_empty() || data.len() as u64 > MAX_BYTES) {
        return Err(bad(format!("the picture {name:?} is empty or bigger than 10 MB")));
    }
    Ok(Package { style, meta, images })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ave-pack-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_style(id: &str) -> StyleProfile {
        StyleProfile {
            id: id.into(),
            name: "Soft Look".into(),
            category: "My Styles".into(),
            version: "1.0.0".into(),
            style_lock: "soft, warm".into(),
            ..styles::parse_style(r#"{"id":"x","name":"x","category":"x"}"#).unwrap()
        }
    }

    #[test]
    fn a_style_survives_export_and_read_with_its_pictures_and_notes() {
        let dir = temp("round");
        styles::save_custom(&dir, sample_style("custom_soft")).unwrap();
        let sources: Vec<std::path::PathBuf> = (1..=3)
            .map(|n| {
                let p = dir.join(format!("s{n}.jpg"));
                fs::write(&p, format!("jpeg {n}")).unwrap();
                p
            })
            .collect();
        refs::store(&dir, "custom_soft", &sources, &Meta { description: "calm".into(), engine: "chat".into() }).unwrap();

        let bytes = build(&dir, "custom_soft").unwrap();
        let package = read(&bytes).unwrap();
        assert_eq!((package.style.name.as_str(), package.style.style_lock.as_str()), ("Soft Look", "soft, warm"));
        assert_eq!((package.meta.description.as_str(), package.meta.engine.as_str()), ("calm", "chat"));
        assert_eq!(package.images.len(), 3);
        assert_eq!(package.images[1], ("images/ref2.jpg".to_string(), b"jpeg 2".to_vec()));
        assert_eq!(package.style.thumbnail, "", "the picture is made again on import");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_style_without_pictures_can_be_exported_too() {
        let dir = temp("nopics");
        styles::save_custom(&dir, sample_style("custom_plain")).unwrap();
        let package = read(&build(&dir, "custom_plain").unwrap()).unwrap();
        assert!(package.images.is_empty());
        assert!(build(&dir, "noir").is_err(), "built-in styles are not exported");
        assert!(build(&dir, "custom_missing").is_err());
        let _ = fs::remove_dir_all(dir);
    }

    fn zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        write_stored(&entries.iter().map(|(n, d)| ZipEntry { name: (*n).into(), data: d.to_vec() }).collect::<Vec<_>>())
    }

    fn too_many_zip(profile: &[u8]) -> Vec<u8> {
        let mut entries = vec![ZipEntry { name: "style.json".into(), data: profile.to_vec() }];
        entries.extend((0..=MAX_IMAGES).map(|i| ZipEntry { name: format!("images/p{i}.jpg"), data: b"1".to_vec() }));
        write_stored(&entries)
    }

    #[test]
    fn damaged_or_foreign_files_are_refused_with_a_friendly_message() {
        let profile = br#"{"id":"custom_a","name":"A","category":"C"}"#;
        for (label, data) in [
            ("not a zip", b"hello".to_vec()),
            ("no profile", zip(&[("meta.json", b"{}")])),
            ("bad profile", zip(&[("style.json", b"{oops")])),
            ("unsafe name", zip(&[("style.json", profile), ("../evil.jpg", b"x")])),
            ("too many pictures", too_many_zip(profile)),
            ("empty picture", zip(&[("style.json", profile), ("images/a.jpg", b"")])),
        ] {
            let error = read(&data).unwrap_err();
            assert!(error.message.contains("not a style file made by this app"), "{label}: {}", error.message);
        }
    }

    #[test]
    fn other_files_in_the_zip_are_ignored() {
        let profile = br#"{"id":"custom_a","name":"A","category":"C"}"#;
        let package = read(&zip(&[("style.json", profile), ("readme.txt", b"hi"), ("images/notes.txt", b"no"), ("images/a.png", b"png")])).unwrap();
        assert_eq!(package.images.len(), 1);
        assert_eq!(package.meta, Meta::default());
    }
}
