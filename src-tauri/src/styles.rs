//! Style profiles: JSON files in `resources/styles` (built in) and in the app data folder
//! (the user's own). Files that cannot be used are skipped and written to a log.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::commands::error::AppError;

pub const CUSTOM_PREFIX: &str = "custom_";
const MAX_FILE_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct StyleProfile {
    pub id: String,
    pub name: String,
    pub category: String,
    pub version: String,
    pub core_identity: String,
    pub medium: String,
    pub lighting: String,
    pub color_palette: String,
    pub camera: String,
    pub composition: String,
    pub texture: String,
    pub characters: String,
    pub mood: String,
    pub negative: String,
    pub motion_rules: String,
    pub style_lock: String,
    pub example_prompt: String,
    pub thumbnail: String,
    /// True for styles that ship with the app (they cannot be edited or deleted).
    #[serde(default)]
    pub builtin: bool,
}

#[derive(Debug, Serialize)]
pub struct StyleLibrary {
    pub styles: Vec<StyleProfile>,
    /// One sentence for each file that was skipped.
    pub warnings: Vec<String>,
}

/// A text field may be written as text, as a list of texts (joined with ", "), or a number.
fn text_of(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.trim().to_string(),
        Some(Value::Array(items)) => items.iter().map(|item| text_of(Some(item))).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(", "),
        Some(Value::Number(number)) => number.to_string(),
        _ => String::new(),
    }
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

/// Reads one style file. Needs a valid `id`, a `name` and a `category`; other fields may be empty.
pub fn parse_style(text: &str) -> Result<StyleProfile, String> {
    let value: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| format!("not valid JSON ({e})"))?;
    let Value::Object(map) = &value else {
        return Err("the file must hold one JSON object".to_string());
    };
    let get = |key: &str| text_of(map.get(key));
    let id = get("id");
    if !valid_id(&id) {
        return Err(format!("the id {id:?} is missing or not valid (use lower-case letters, digits, - and _)"));
    }
    let name = get("name");
    if name.is_empty() {
        return Err("it has no name".to_string());
    }
    let category = get("category");
    if category.is_empty() {
        return Err("it has no category".to_string());
    }
    Ok(StyleProfile {
        id,
        name,
        category,
        version: get("version"),
        core_identity: get("core_identity"),
        medium: get("medium"),
        lighting: get("lighting"),
        color_palette: get("color_palette"),
        camera: get("camera"),
        composition: get("composition"),
        texture: get("texture"),
        characters: get("characters"),
        mood: get("mood"),
        negative: get("negative"),
        motion_rules: get("motion_rules"),
        style_lock: get("style_lock"),
        example_prompt: get("example_prompt"),
        thumbnail: get("thumbnail"),
        builtin: false,
    })
}

/// Loads every `*.json` file in `dir`. A missing folder gives an empty list.
pub fn load_dir(dir: &Path, builtin: bool, warnings: &mut Vec<String>) -> Vec<StyleProfile> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut files: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("json")) && p.file_name().and_then(|n| n.to_str()) != Some(crate::library::store::INFO_FILE)).collect();
    files.sort();
    let mut styles = Vec::new();
    for file in files {
        let label = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let too_big = fs::metadata(&file).map(|m| m.len() > MAX_FILE_BYTES).unwrap_or(false);
        if too_big {
            warnings.push(format!("Style file {label} was skipped: it is too big."));
            continue;
        }
        match fs::read_to_string(&file).map_err(|e| e.to_string()).and_then(|text| parse_style(&text)) {
            Ok(mut style) => {
                style.builtin = builtin;
                styles.push(style);
            }
            Err(reason) => warnings.push(format!("Style file {label} was skipped: {reason}.")),
        }
    }
    styles
}

/// Built-in styles first, then the user's. A user style with the id of another style is skipped.
pub fn load_all(builtin_dir: &Path, custom_dir: &Path) -> StyleLibrary {
    let mut warnings = Vec::new();
    let mut styles = load_dir(builtin_dir, true, &mut warnings);
    let mut seen: std::collections::HashSet<String> = styles.iter().map(|s| s.id.clone()).collect();
    styles.retain({
        let mut first = std::collections::HashSet::new();
        move |s| first.insert(s.id.clone())
    });
    for mut style in load_dir(custom_dir, false, &mut warnings) {
        if !style.id.starts_with(CUSTOM_PREFIX) || !seen.insert(style.id.clone()) {
            warnings.push(format!("Your style {:?} was skipped: its id is already used.", style.name));
            continue;
        }
        style.builtin = false;
        styles.push(style);
    }
    StyleLibrary { styles, warnings }
}

/// Saves a user style as `<custom_dir>/<id>.json`. The id must start with `custom_`.
pub fn save_custom(custom_dir: &Path, mut style: StyleProfile) -> Result<StyleProfile, AppError> {
    style.id = style.id.trim().to_string();
    style.name = style.name.trim().to_string();
    style.category = style.category.trim().to_string();
    if !style.id.starts_with(CUSTOM_PREFIX) || !valid_id(&style.id) {
        return Err(AppError::new("That style id is not valid.", format!("Custom style ids start with {CUSTOM_PREFIX}: {:?}", style.id)));
    }
    if style.name.is_empty() {
        return Err(AppError::new("Please give the style a name.", "empty name"));
    }
    if style.category.is_empty() {
        return Err(AppError::new("Please choose a category for the style.", "empty category"));
    }
    style.builtin = false;
    fs::create_dir_all(custom_dir).map_err(|e| AppError::new("The styles folder could not be created.", e.to_string()))?;
    let target = custom_dir.join(format!("{}.json", style.id));
    let temp = custom_dir.join(format!("{}.json.tmp", style.id));
    let text = serde_json::to_string_pretty(&style).map_err(|e| AppError::new("The style could not be saved.", e.to_string()))?;
    fs::write(&temp, text + "\n").map_err(|e| AppError::new("The style could not be saved.", format!("{e} ({})", temp.display())))?;
    fs::rename(&temp, &target).map_err(|e| AppError::new("The style could not be saved.", format!("{e} ({})", target.display())))?;
    Ok(style)
}

pub fn delete_custom(custom_dir: &Path, id: &str) -> Result<(), AppError> {
    if !id.starts_with(CUSTOM_PREFIX) || !valid_id(id) {
        return Err(AppError::new("Only your own styles can be deleted.", format!("Not a custom style id: {id:?}")));
    }
    match fs::remove_file(custom_dir.join(format!("{id}.json"))) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AppError::new("The style could not be deleted.", e.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ave-styles-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_placeholder_needs_only_id_name_and_category() {
        let style = parse_style(r#"{"id":"anime","name":"Anime","category":"Animation & Cartoon"}"#).unwrap();
        assert_eq!(style.name, "Anime");
        assert_eq!(style.core_identity, "");
    }

    #[test]
    fn lists_and_numbers_become_text() {
        let style = parse_style(r#"{"id":"a","name":"A","category":"C","color_palette":["red","  blue ",""],"version":2}"#).unwrap();
        assert_eq!(style.color_palette, "red, blue");
        assert_eq!(style.version, "2");
    }

    #[test]
    fn unusable_files_give_a_reason() {
        for (text, part) in [
            ("{oops", "not valid JSON"),
            ("[1,2]", "one JSON object"),
            (r#"{"name":"A","category":"C"}"#, "id"),
            (r#"{"id":"Bad Id","name":"A","category":"C"}"#, "id"),
            (r#"{"id":"a","category":"C"}"#, "no name"),
            (r#"{"id":"a","name":"A"}"#, "no category"),
        ] {
            let error = parse_style(text).unwrap_err();
            assert!(error.contains(part), "{text}: {error}");
        }
    }

    #[test]
    fn broken_files_are_skipped_and_reported() {
        let dir = temp("load");
        fs::write(dir.join("a.json"), r#"{"id":"a","name":"A","category":"C"}"#).unwrap();
        fs::write(dir.join("broken.json"), "{nope").unwrap();
        fs::write(dir.join("notes.txt"), "ignore me").unwrap();
        let mut warnings = Vec::new();
        let styles = load_dir(&dir, true, &mut warnings);
        assert_eq!(styles.len(), 1);
        assert!(styles[0].builtin);
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("broken.json"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_shipped_styles_load_and_cinematic_realism_is_complete() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../resources/styles");
        let mut warnings = Vec::new();
        let styles = load_dir(&dir, true, &mut warnings);
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(styles.len(), 51);
        let ids: std::collections::HashSet<_> = styles.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids.len(), 51, "ids must be unique");
        let categories: std::collections::HashSet<_> = styles.iter().map(|s| s.category.as_str()).collect();
        assert_eq!(categories.len(), 11);
        let cinematic = styles.iter().find(|s| s.id == "cinematic_realism").unwrap();
        for field in [&cinematic.core_identity, &cinematic.medium, &cinematic.lighting, &cinematic.color_palette, &cinematic.camera, &cinematic.composition, &cinematic.texture, &cinematic.characters, &cinematic.mood, &cinematic.negative, &cinematic.motion_rules, &cinematic.style_lock, &cinematic.example_prompt] {
            assert!(!field.is_empty());
        }
    }

    #[test]
    fn custom_styles_are_saved_loaded_and_deleted() {
        let builtin = temp("builtin");
        let custom = temp("custom");
        fs::write(builtin.join("a.json"), r#"{"id":"a","name":"A","category":"C"}"#).unwrap();
        let style = StyleProfile { id: "custom_mine".into(), name: "Mine".into(), category: "Painting".into(), style_lock: "my lock".into(), ..StyleProfile::default() };
        save_custom(&custom, style).unwrap();
        let library = load_all(&builtin, &custom);
        assert_eq!(library.styles.len(), 2);
        let mine = library.styles.iter().find(|s| s.id == "custom_mine").unwrap();
        assert!(!mine.builtin);
        assert_eq!(mine.style_lock, "my lock");
        delete_custom(&custom, "custom_mine").unwrap();
        assert_eq!(load_all(&builtin, &custom).styles.len(), 1);
        delete_custom(&custom, "custom_mine").unwrap();
        let _ = fs::remove_dir_all(&builtin);
        let _ = fs::remove_dir_all(&custom);
    }

    #[test]
    fn custom_ids_cannot_escape_or_replace_built_in_styles() {
        let custom = temp("guard");
        for bad in ["a", "custom_../x", "custom_A b", ""] {
            let style = StyleProfile { id: bad.into(), name: "X".into(), category: "C".into(), ..StyleProfile::default() };
            assert!(save_custom(&custom, style).is_err(), "{bad:?}");
        }
        assert!(delete_custom(&custom, "../x").is_err());
        assert!(delete_custom(&custom, "cinematic_realism").is_err());
        let _ = fs::remove_dir_all(&custom);
    }
}
