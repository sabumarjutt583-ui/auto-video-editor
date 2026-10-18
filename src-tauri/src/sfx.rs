//! The built-in sound effects: `resources/sfx/index.json` and the WAV files next to it.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// The kinds of sound the library has.
pub const CATEGORIES: [&str; 8] = ["whoosh", "hit", "pop", "riser", "ambience", "soft_swell", "click", "transition"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SfxEntry {
    pub id: String,
    pub file: String,
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Seconds.
    pub duration: f64,
    /// 0 to 1: the volume the sound is meant to be played at.
    pub default_gain: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SfxLibrary {
    pub sounds: Vec<SfxEntry>,
    /// Entries that were skipped (damaged or missing file), in plain words.
    pub warnings: Vec<String>,
}

/// Reads `index.json` in `dir`. Entries with an unknown category, a bad value or a missing file are left out.
pub fn load_library(dir: &Path) -> SfxLibrary {
    let mut library = SfxLibrary::default();
    let text = match std::fs::read_to_string(dir.join("index.json")) {
        Ok(text) => text,
        Err(e) => {
            library.warnings.push(format!("The sound list could not be read: {e}"));
            return library;
        }
    };
    let entries: Vec<serde_json::Value> = match serde_json::from_str(&text) {
        Ok(entries) => entries,
        Err(e) => {
            library.warnings.push(format!("The sound list is damaged: {e}"));
            return library;
        }
    };
    for value in entries {
        let entry: SfxEntry = match serde_json::from_value(value) {
            Ok(entry) => entry,
            Err(e) => {
                library.warnings.push(format!("A sound entry was skipped: {e}"));
                continue;
            }
        };
        let safe_name = !entry.file.is_empty() && !entry.file.contains(['/', '\\']) && !entry.file.starts_with('.');
        if !safe_name || !dir.join(&entry.file).is_file() {
            library.warnings.push(format!("The sound file for {:?} is missing.", entry.id));
        } else if !CATEGORIES.contains(&entry.category.as_str()) {
            library.warnings.push(format!("{:?} has an unknown category {:?}.", entry.id, entry.category));
        } else if !(entry.duration.is_finite() && entry.duration > 0.0 && (0.0..=1.0).contains(&entry.default_gain)) {
            library.warnings.push(format!("{:?} has a bad length or volume.", entry.id));
        } else if library.sounds.iter().any(|s| s.id == entry.id) {
            library.warnings.push(format!("{:?} appears twice.", entry.id));
        } else {
            library.sounds.push(entry);
        }
    }
    library
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ave-sfx-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_bundled_library_is_complete() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../resources/sfx");
        let library = load_library(&dir);
        assert!(library.warnings.is_empty(), "{:?}", library.warnings);
        for category in CATEGORIES {
            assert!(library.sounds.iter().any(|s| s.category == category), "no sound for {category}");
        }
        assert!(library.sounds.iter().all(|s| s.default_gain > 0.0 && s.duration > 0.0));
    }

    #[test]
    fn bad_entries_are_skipped_with_a_reason() {
        let dir = folder("bad");
        std::fs::write(dir.join("a.wav"), b"x").unwrap();
        std::fs::write(
            dir.join("index.json"),
            r#"[
              {"id":"ok","file":"a.wav","category":"pop","tags":["x"],"duration":0.5,"defaultGain":0.5},
              {"id":"gone","file":"nope.wav","category":"pop","duration":0.5,"defaultGain":0.5},
              {"id":"odd","file":"a.wav","category":"laser","duration":0.5,"defaultGain":0.5},
              {"id":"loud","file":"a.wav","category":"hit","duration":0.5,"defaultGain":3},
              {"id":"ok","file":"a.wav","category":"hit","duration":0.5,"defaultGain":0.5},
              {"id":"path","file":"../a.wav","category":"hit","duration":0.5,"defaultGain":0.5},
              {"nonsense":true}
            ]"#,
        )
        .unwrap();
        let library = load_library(&dir);
        assert_eq!(library.sounds.len(), 1);
        assert_eq!(library.sounds[0].id, "ok");
        assert_eq!(library.warnings.len(), 6, "{:?}", library.warnings);
    }

    #[test]
    fn a_missing_or_damaged_index_gives_an_empty_library() {
        let dir = folder("none");
        assert!(load_library(&dir).sounds.is_empty());
        std::fs::write(dir.join("index.json"), "not json").unwrap();
        let library = load_library(&dir);
        assert!(library.sounds.is_empty() && library.warnings.len() == 1);
    }
}
