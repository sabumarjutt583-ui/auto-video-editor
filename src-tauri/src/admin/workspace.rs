//! The admin's working copy of the library: sounds, their credits, and the version numbers.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::commands::error::AppError;
use crate::library::manifest::Kind;
use crate::sfx::{SfxEntry, CATEGORIES};

pub const CREDITS_FILE: &str = "credits.json";
const STATE_FILE: &str = "admin.json";

pub fn sfx_dir(root: &Path) -> PathBuf {
    root.join("sfx")
}
pub fn styles_dir(root: &Path) -> PathBuf {
    root.join("styles")
}
pub fn packages_dir(root: &Path) -> PathBuf {
    root.join("packages")
}

fn io(message: &str, e: std::io::Error, path: &Path) -> AppError {
    AppError::new(message, format!("{e} ({})", path.display()))
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), AppError> {
    let text = serde_json::to_string_pretty(value).map_err(|e| AppError::new("The file could not be prepared.", e.to_string()))?;
    let temp = path.with_extension("tmp");
    std::fs::write(&temp, text).map_err(|e| io("The file could not be saved.", e, &temp))?;
    std::fs::rename(&temp, path).map_err(|e| io("The file could not be saved.", e, path))
}

/// Where a sound came from. CC0 needs no credit, but the record shows what the library contains.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credit {
    pub id: String,
    pub freesound_id: u64,
    pub name: String,
    pub username: String,
    pub license: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct State {
    sfx_version: u64,
    styles_version: u64,
}

fn read_state(root: &Path) -> State {
    std::fs::read_to_string(root.join(STATE_FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// The version the next package should get: one more than anything seen so far.
pub fn next_version(root: &Path, kind: Kind, installed: u64) -> u64 {
    let state = read_state(root);
    let last = match kind {
        Kind::Sfx => state.sfx_version,
        Kind::Styles => state.styles_version,
    };
    last.max(installed) + 1
}

pub fn record_version(root: &Path, kind: Kind, version: u64) -> Result<(), AppError> {
    std::fs::create_dir_all(root).map_err(|e| io("The admin folder could not be created.", e, root))?;
    let mut state = read_state(root);
    match kind {
        Kind::Sfx => state.sfx_version = state.sfx_version.max(version),
        Kind::Styles => state.styles_version = state.styles_version.max(version),
    }
    write_json(&root.join(STATE_FILE), &state)
}

pub fn read_index(dir: &Path) -> Result<Vec<SfxEntry>, AppError> {
    match std::fs::read_to_string(dir.join("index.json")) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| AppError::new("The sound list is damaged.", e.to_string())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(io("The sound list could not be read.", e, dir)),
    }
}

fn write_index(dir: &Path, entries: &[SfxEntry]) -> Result<(), AppError> {
    write_json(&dir.join("index.json"), &entries)
}

pub fn read_credits(dir: &Path) -> Vec<Credit> {
    std::fs::read_to_string(dir.join(CREDITS_FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// A safe sound id such as `fs123_big_whoosh`.
pub fn make_id(freesound_id: u64, name: &str) -> String {
    let slug: String = name.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
    let slug = slug.split('_').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("_");
    let slug: String = slug.chars().take(40).collect();
    if slug.is_empty() { format!("fs{freesound_id}") } else { format!("fs{freesound_id}_{slug}") }
}

pub fn clean_tags(tags: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for tag in tags {
        let tag: String = tag.trim().to_lowercase().chars().filter(|c| !c.is_control()).take(30).collect();
        if !tag.is_empty() && !out.contains(&tag) && out.len() < 12 {
            out.push(tag);
        }
    }
    out
}

fn check_category(category: &str) -> Result<(), AppError> {
    if CATEGORIES.contains(&category) {
        Ok(())
    } else {
        Err(AppError::new("Please choose one of the sound categories.", format!("unknown category {category:?}")))
    }
}

/// Adds a finished WAV (already in `dir`) to the library list.
pub fn register(dir: &Path, entry: SfxEntry, credit: Option<Credit>) -> Result<(), AppError> {
    check_category(&entry.category)?;
    let mut entries = read_index(dir)?;
    if entries.iter().any(|e| e.id == entry.id) {
        return Err(AppError::new("This sound is already in your library.", entry.id));
    }
    entries.push(entry);
    write_index(dir, &entries)?;
    if let Some(credit) = credit {
        let mut credits = read_credits(dir);
        credits.retain(|c| c.id != credit.id);
        credits.push(credit);
        write_json(&dir.join(CREDITS_FILE), &credits)?;
    }
    Ok(())
}

pub fn update(dir: &Path, id: &str, category: &str, tags: &[String], gain: f64) -> Result<(), AppError> {
    check_category(category)?;
    if !(0.0..=1.0).contains(&gain) {
        return Err(AppError::new("The volume must be between 0 and 1.", format!("{gain}")));
    }
    let mut entries = read_index(dir)?;
    let entry = entries.iter_mut().find(|e| e.id == id).ok_or_else(|| AppError::new("That sound is not in the library.", id.to_string()))?;
    entry.category = category.to_string();
    entry.tags = clean_tags(tags);
    entry.default_gain = gain;
    write_index(dir, &entries)
}

pub fn remove(dir: &Path, id: &str) -> Result<(), AppError> {
    let mut entries = read_index(dir)?;
    let position = entries.iter().position(|e| e.id == id).ok_or_else(|| AppError::new("That sound is not in the library.", id.to_string()))?;
    let removed = entries.remove(position);
    write_index(dir, &entries)?;
    if !removed.file.contains(['/', '\\']) {
        let _ = std::fs::remove_file(dir.join(&removed.file));
    }
    let mut credits = read_credits(dir);
    credits.retain(|c| c.id != id);
    write_json(&dir.join(CREDITS_FILE), &credits)
}

/// Copies the sounds and styles that ship with the app into an empty workspace, so a new package starts from them.
pub fn import_folder(from: &Path, to: &Path, extension_ok: impl Fn(&str) -> bool) -> Result<usize, AppError> {
    std::fs::create_dir_all(to).map_err(|e| io("The admin folder could not be created.", e, to))?;
    let mut count = 0;
    for entry in std::fs::read_dir(from).map_err(|e| io("The folder could not be read.", e, from))?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.path().is_file() && extension_ok(&name) && name != crate::library::store::INFO_FILE {
            std::fs::copy(entry.path(), to.join(&name)).map_err(|e| io("A file could not be copied.", e, &entry.path()))?;
            count += 1;
        }
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::store::tests::temp;

    fn entry(id: &str) -> SfxEntry {
        SfxEntry { id: id.into(), file: format!("{id}.wav"), category: "pop".into(), tags: vec![], duration: 0.5, default_gain: 0.7 }
    }

    #[test]
    fn ids_are_safe() {
        assert_eq!(make_id(7, "Big  Whoosh!! (v2)"), "fs7_big_whoosh_v2");
        assert_eq!(make_id(7, "한국어"), "fs7");
        assert!(make_id(1, &"x".repeat(200)).len() <= 50);
    }

    #[test]
    fn sounds_can_be_added_edited_and_removed() {
        let dir = temp("ws");
        std::fs::write(dir.join("a.wav"), b"x").unwrap();
        register(&dir, entry("a"), Some(Credit { id: "a".into(), freesound_id: 1, name: "A".into(), username: "u".into(), license: "CC0".into() })).unwrap();
        assert!(register(&dir, entry("a"), None).is_err(), "no duplicates");
        assert!(register(&dir, SfxEntry { category: "bogus".into(), ..entry("b") }, None).is_err());
        update(&dir, "a", "hit", &["Boom ".into(), "boom".into(), "".into(), "BIG".into()], 0.5).unwrap();
        let e = &read_index(&dir).unwrap()[0];
        assert_eq!((e.category.as_str(), e.tags.clone(), e.default_gain), ("hit", vec!["boom".to_string(), "big".to_string()], 0.5));
        assert!(update(&dir, "a", "hit", &[], 3.0).is_err());
        remove(&dir, "a").unwrap();
        assert!(read_index(&dir).unwrap().is_empty() && !dir.join("a.wav").exists() && read_credits(&dir).is_empty());
    }

    #[test]
    fn versions_only_go_up() {
        let root = temp("ver");
        assert_eq!(next_version(&root, Kind::Sfx, 1), 2);
        record_version(&root, Kind::Sfx, 5).unwrap();
        assert_eq!(next_version(&root, Kind::Sfx, 1), 6);
        assert_eq!(next_version(&root, Kind::Sfx, 9), 10);
        assert_eq!(next_version(&root, Kind::Styles, 1), 2);
    }
}
