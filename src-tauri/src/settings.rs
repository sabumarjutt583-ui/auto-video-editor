//! Non-secret app settings, stored as JSON in the app data folder.
//!
//! API keys are NOT part of this file: they live only in the OS keychain (see keys.rs).

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::api::clean_model_name;
use crate::commands::error::AppError;

const FILE_NAME: &str = "settings.json";
const CORRUPT_FILE_NAME: &str = "settings.corrupt.json";
const MAX_PATH_LENGTH: usize = 1024;

pub const DEFAULT_GEMINI_MODEL: &str = "gemini-3.8-flash";
pub const DEFAULT_WHISPER_MODEL: &str = "whisper-large-v3-turbo";
pub const DEFAULT_GROQ_TEXT_MODEL: &str = "llama-3.3-70b-versatile";
pub const DEFAULT_OPENAI_MODEL: &str = "gpt-4.1-mini";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AspectRatio {
    #[serde(rename = "16:9")]
    Landscape,
    #[serde(rename = "9:16")]
    Portrait,
    #[serde(rename = "1:1")]
    Square,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Quality {
    #[serde(rename = "720p")]
    P720,
    #[serde(rename = "1080p")]
    P1080,
    #[serde(rename = "4K")]
    K4,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub gemini_model: String,
    pub groq_whisper_model: String,
    pub fallback_to_groq: bool,
    pub groq_text_model: String,
    /// The OpenAI model that looks at reference pictures when making a custom style (needs an OpenAI key).
    pub openai_model: String,
    /// Write texts with Gemini's web chat (the Google accounts of the Image Generator) instead of the Gemini API key.
    pub text_via_chat: bool,
    /// Write prompts by hand: copy the messages into any AI chat and paste the answers back (overrides the two above).
    pub text_manual: bool,
    /// Scenes per message in the web chat (5 to 25).
    pub chat_batch_size: u8,
    /// Empty lines after every prompt in Copy all and Export TXT (1 to 3).
    pub export_empty_lines: u8,
    /// Write the id (S01_000.0-005.1 or P01) before every prompt in Copy all and Export TXT.
    pub export_include_ids: bool,
    /// Empty means "not chosen yet".
    pub export_folder: String,
    pub default_aspect_ratio: AspectRatio,
    pub default_quality: Quality,
    /// Always encode on the CPU, even when a graphics-card encoder works.
    pub force_cpu_encoding: bool,
    /// Where new sound and style packages are published (a folder address that holds manifest.json). Empty = no updates.
    pub library_update_url: String,
    /// Ids of the sounds the person marked as favorites.
    pub sfx_favorites: Vec<String>,
    /// Ids of the styles the person marked as favorites.
    pub style_favorites: Vec<String>,
    /// The last styles that were used, newest first (at most 6).
    pub recent_styles: Vec<String>,
    /// Where the app looks for new app versions (the address of latest.json). Empty = the address built into the app.
    pub app_update_url: String,
    /// Look for a new app version when the app starts.
    pub auto_check_app_updates: bool,
    /// When the app last looked for a new version (seconds since 1970; 0 = never).
    pub last_app_update_check: u64,
    /// Write longer texts into the log files (for support). Off by default.
    pub debug_logging: bool,
    /// The first-run screens have been seen (or skipped).
    pub onboarding_done: bool,
    /// The brand kits the person made (JSON objects; the frontend repairs them when it reads them).
    pub brand_kits: Vec<serde_json::Value>,
    /// The brand kit of the app: a built-in, suggested or custom kit id.
    pub brand_kit_id: String,
    /// Graphics the person saved as presets (JSON objects; the frontend checks them when it reads them).
    pub graphic_presets: Vec<serde_json::Value>,
}

/// Most brand kits a person can keep, and the size of one kit as JSON text.
const MAX_BRAND_KITS: usize = 50;
const MAX_BRAND_KIT_BYTES: usize = 20_000;
/// Most graphic presets, and the size of one preset as JSON text.
const MAX_GRAPHIC_PRESETS: usize = 100;
const MAX_GRAPHIC_PRESET_BYTES: usize = 30_000;

impl Default for Settings {
    fn default() -> Self {
        Self {
            gemini_model: DEFAULT_GEMINI_MODEL.to_string(),
            groq_whisper_model: DEFAULT_WHISPER_MODEL.to_string(),
            fallback_to_groq: false,
            groq_text_model: DEFAULT_GROQ_TEXT_MODEL.to_string(),
            openai_model: DEFAULT_OPENAI_MODEL.to_string(),
            text_via_chat: false,
            text_manual: false,
            chat_batch_size: 20,
            export_empty_lines: 2,
            export_include_ids: true,
            export_folder: String::new(),
            default_aspect_ratio: AspectRatio::Landscape,
            default_quality: Quality::P1080,
            force_cpu_encoding: false,
            library_update_url: option_env!("AVE_LIBRARY_URL").unwrap_or_default().to_string(),
            sfx_favorites: Vec::new(),
            style_favorites: Vec::new(),
            recent_styles: Vec::new(),
            app_update_url: String::new(),
            auto_check_app_updates: true,
            last_app_update_check: 0,
            debug_logging: false,
            onboarding_done: false,
            brand_kits: Vec::new(),
            brand_kit_id: "clean_documentary".to_string(),
            graphic_presets: Vec::new(),
        }
    }
}

/// Trims a list of style ids: no empty ones, no repeats, a safe length, at most `max` entries.
fn clean_ids(ids: &[String], max: usize) -> Result<Vec<String>, AppError> {
    let mut clean: Vec<String> = Vec::new();
    for id in ids.iter().map(|id| id.trim()).filter(|id| !id.is_empty()) {
        if id.len() > 80 || id.contains(char::is_control) {
            return Err(invalid("A style id in the settings is not valid."));
        }
        if !clean.iter().any(|c| c == id) && clean.len() < max {
            clean.push(id.to_string());
        }
    }
    Ok(clean)
}

impl Settings {
    /// Checks and tidies values coming from the UI.
    pub fn validated(self) -> Result<Self, AppError> {
        let gemini_model = clean_model_name(&self.gemini_model, false).ok_or_else(|| {
            invalid("The Gemini model name is not valid. Use only letters, numbers, dots, dashes and underscores.")
        })?;
        let groq_whisper_model = clean_model_name(&self.groq_whisper_model, true)
            .ok_or_else(|| invalid("The Groq Whisper model name is not valid."))?;
        let groq_text_model = clean_model_name(&self.groq_text_model, true)
            .ok_or_else(|| invalid("The Groq text model name is not valid."))?;

        let openai_model = clean_model_name(&self.openai_model, false).ok_or_else(|| invalid("The OpenAI model name is not valid."))?;

        let export_folder = self.export_folder.trim().to_string();
        if export_folder.chars().count() > MAX_PATH_LENGTH || export_folder.contains('\0') {
            return Err(invalid("The export folder path is not valid."));
        }

        let library_update_url = self.library_update_url.trim().trim_end_matches('/').to_string();
        if !library_update_url.is_empty() && !crate::library::manifest::valid_base_url(&library_update_url) {
            return Err(invalid("The update address must start with https:// and have no spaces."));
        }
        let app_update_url = self.app_update_url.trim().to_string();
        if !app_update_url.is_empty() && !app_update_url.starts_with("https://") || app_update_url.len() > 500 || app_update_url.contains(char::is_whitespace) {
            return Err(invalid("The app update address must start with https:// and have no spaces."));
        }
        let mut sfx_favorites: Vec<String> = Vec::new();
        for id in self.sfx_favorites.iter().map(|id| id.trim()).filter(|id| !id.is_empty()) {
            if id.len() > 80 || id.contains(char::is_control) {
                return Err(invalid("A favorite sound id is not valid."));
            }
            if !sfx_favorites.iter().any(|f| f == id) && sfx_favorites.len() < 1000 {
                sfx_favorites.push(id.to_string());
            }
        }

        let style_favorites = clean_ids(&self.style_favorites, 500)?;
        let mut recent_styles = clean_ids(&self.recent_styles, 6)?;
        recent_styles.truncate(6);

        if self.brand_kits.len() > MAX_BRAND_KITS || self.brand_kits.iter().any(|kit| !kit.is_object() || kit.to_string().len() > MAX_BRAND_KIT_BYTES) {
            return Err(invalid("A brand kit is not valid or there are too many of them."));
        }
        if self.graphic_presets.len() > MAX_GRAPHIC_PRESETS || self.graphic_presets.iter().any(|p| !p.is_object() || p.to_string().len() > MAX_GRAPHIC_PRESET_BYTES) {
            return Err(invalid("A graphic preset is not valid or there are too many of them."));
        }
        let brand_kit_id = self.brand_kit_id.trim().to_string();
        if brand_kit_id.is_empty() || brand_kit_id.len() > 60 || brand_kit_id.contains(char::is_control) {
            return Err(invalid("The brand kit id is not valid."));
        }

        Ok(Self {
            brand_kit_id,
            style_favorites,
            recent_styles,
            library_update_url,
            app_update_url,
            sfx_favorites,
            gemini_model,
            groq_whisper_model,
            groq_text_model,
            openai_model,
            export_folder,
            ..self
        })
    }
}

fn invalid(message: &str) -> AppError {
    AppError::new(message, "A settings value failed validation.")
}

fn io_error(message: &str, error: std::io::Error) -> AppError {
    AppError::new(message, error.to_string())
}

pub fn settings_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let folder = app.path().app_data_dir().map_err(|error| {
        AppError::new("The app data folder could not be found.", error.to_string())
    })?;
    Ok(folder.join(FILE_NAME))
}

/// Reads the settings file. A missing file gives the defaults. A file that cannot be
/// understood is set aside as `settings.corrupt.json` and the defaults are used.
pub fn load_from(path: &Path) -> Result<Settings, AppError> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Settings::default()),
        Err(error) => return Err(io_error("The settings file could not be read.", error)),
    };

    match serde_json::from_str::<Settings>(&text) {
        Ok(settings) => Ok(settings.validated().unwrap_or_default()),
        Err(_) => {
            if let Some(folder) = path.parent() {
                let _ = fs::rename(path, folder.join(CORRUPT_FILE_NAME));
            }
            Ok(Settings::default())
        }
    }
}

/// Writes the settings file safely: to a temporary file first, then renamed into place.
pub fn save_to(path: &Path, settings: &Settings) -> Result<(), AppError> {
    let folder = path
        .parent()
        .ok_or_else(|| AppError::new("The settings file location is not valid.", path.display().to_string()))?;
    fs::create_dir_all(folder)
        .map_err(|error| io_error("The app data folder could not be created.", error))?;

    let json = serde_json::to_string_pretty(settings)
        .map_err(|error| AppError::new("The settings could not be prepared for saving.", error.to_string()))?;

    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, json).map_err(|error| io_error("The settings could not be saved.", error))?;
    fs::rename(&temporary, path).map_err(|error| io_error("The settings could not be saved.", error))
}

pub fn load(app: &AppHandle) -> Result<Settings, AppError> {
    load_from(&settings_path(app)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_folder(name: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let folder = std::env::temp_dir().join(format!("ave-test-{name}-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&folder).unwrap();
        folder
    }

    #[test]
    fn brand_kits_are_kept_as_given_and_checked_for_size_and_shape() {
        let mut settings = Settings::default();
        assert_eq!(settings.brand_kit_id, "clean_documentary");
        settings.brand_kits = vec![serde_json::json!({"id": "mine", "name": "Mine", "colors": {"primary": "#112233"}})];
        settings.brand_kit_id = " mine ".to_string();
        let ok = settings.clone().validated().unwrap();
        assert_eq!(ok.brand_kit_id, "mine");
        assert_eq!(ok.brand_kits.len(), 1);
        // Old settings files without the fields still load.
        let old: Settings = serde_json::from_str("{\"geminiModel\": \"gemini-3.8-flash\"}").unwrap();
        assert!(old.brand_kits.is_empty());
        assert_eq!(old.brand_kit_id, "clean_documentary");

        let mut not_an_object = settings.clone();
        not_an_object.brand_kits = vec![serde_json::json!("text")];
        assert!(not_an_object.validated().is_err());
        let mut too_many = settings.clone();
        too_many.brand_kits = (0..51).map(|i| serde_json::json!({"id": format!("k{i}")})).collect();
        assert!(too_many.validated().is_err());
        let mut too_big = settings.clone();
        too_big.brand_kits = vec![serde_json::json!({"name": "x".repeat(20_001)})];
        assert!(too_big.validated().is_err());
        let mut empty_id = settings;
        empty_id.brand_kit_id = "  ".to_string();
        assert!(empty_id.validated().is_err());
    }

    #[test]
    fn graphic_presets_are_kept_and_checked_for_size_and_shape() {
        let mut settings = Settings::default();
        assert!(settings.graphic_presets.is_empty());
        settings.graphic_presets = vec![serde_json::json!({"id": "card", "name": "Card", "spec": {}, "samples": []})];
        assert_eq!(settings.clone().validated().unwrap().graphic_presets.len(), 1);
        let old: Settings = serde_json::from_str("{\"geminiModel\": \"gemini-3.8-flash\"}").unwrap();
        assert!(old.graphic_presets.is_empty());
        let mut bad = settings.clone();
        bad.graphic_presets = vec![serde_json::json!("text")];
        assert!(bad.validated().is_err());
        let mut many = settings.clone();
        many.graphic_presets = (0..101).map(|i| serde_json::json!({"id": format!("p{i}")})).collect();
        assert!(many.validated().is_err());
        let mut big = settings;
        big.graphic_presets = vec![serde_json::json!({"name": "x".repeat(30_001)})];
        assert!(big.validated().is_err());
    }

    #[test]
    fn defaults_match_the_spec() {
        let settings = Settings::default();
        assert_eq!(settings.gemini_model, "gemini-3.8-flash");
        assert_eq!(settings.groq_whisper_model, "whisper-large-v3-turbo");
        assert!(!settings.fallback_to_groq);
        assert!(!settings.text_via_chat, "the API key is the default");
        assert_eq!(settings.openai_model, DEFAULT_OPENAI_MODEL);
        assert!(settings.graphic_presets.is_empty() && settings.brand_kits.is_empty(), "files from before the graphics system still load");
        assert_eq!((settings.export_empty_lines, settings.export_include_ids), (2, true));
        assert_eq!(settings.default_aspect_ratio, AspectRatio::Landscape);
        assert_eq!(settings.default_quality, Quality::P1080);
        assert_eq!(settings.export_folder, "");
    }

    #[test]
    fn uses_the_json_shape_the_frontend_expects() {
        let json = serde_json::to_value(Settings::default()).unwrap();
        assert_eq!(json["defaultAspectRatio"], "16:9");
        assert_eq!(json["defaultQuality"], "1080p");
        assert_eq!(json["fallbackToGroq"], false);
        assert!(json.get("geminiModel").is_some());
    }

    #[test]
    fn aspect_ratios_and_qualities_round_trip() {
        for (text, ratio) in [("16:9", AspectRatio::Landscape), ("9:16", AspectRatio::Portrait), ("1:1", AspectRatio::Square)] {
            let json = format!("\"{text}\"");
            assert_eq!(serde_json::from_str::<AspectRatio>(&json).unwrap(), ratio);
            assert_eq!(serde_json::to_string(&ratio).unwrap(), json);
        }
        for (text, quality) in [("720p", Quality::P720), ("1080p", Quality::P1080), ("4K", Quality::K4)] {
            let json = format!("\"{text}\"");
            assert_eq!(serde_json::from_str::<Quality>(&json).unwrap(), quality);
            assert_eq!(serde_json::to_string(&quality).unwrap(), json);
        }
        assert!(serde_json::from_str::<Quality>("\"8K\"").is_err());
    }

    #[test]
    fn settings_never_have_a_field_that_could_hold_a_secret() {
        let json = serde_json::to_string(&Settings::default()).unwrap().to_lowercase();
        for word in ["key", "secret", "token", "password"] {
            assert!(!json.contains(word), "settings JSON mentions '{word}'");
        }
    }

    #[test]
    fn a_partial_file_is_filled_up_with_defaults() {
        let settings: Settings = serde_json::from_str(r#"{"exportFolder":"/videos"}"#).unwrap();
        assert_eq!(settings.export_folder, "/videos");
        assert_eq!(settings.gemini_model, DEFAULT_GEMINI_MODEL);
    }

    #[test]
    fn validation_tidies_model_names_and_folder() {
        let settings = Settings {
            gemini_model: " models/gemini-3.8-flash ".into(),
            export_folder: "  /videos/out ".into(),
            ..Settings::default()
        };
        let settings = settings.validated().unwrap();
        assert_eq!(settings.gemini_model, "gemini-3.8-flash");
        assert_eq!(settings.export_folder, "/videos/out");
    }

    #[test]
    fn validation_rejects_bad_model_names() {
        let bad_gemini = Settings { gemini_model: "gemini flash".into(), ..Settings::default() };
        assert!(bad_gemini.validated().is_err());
        let bad_groq = Settings { groq_text_model: "".into(), ..Settings::default() };
        assert!(bad_groq.validated().is_err());
        let bad_openai = Settings { openai_model: "gpt 4".into(), ..Settings::default() };
        assert!(bad_openai.validated().is_err());
        let tidy = Settings { openai_model: " gpt-4.1 ".into(), ..Settings::default() }.validated().unwrap();
        assert_eq!(tidy.openai_model, "gpt-4.1");
    }

    #[test]
    fn an_old_settings_file_without_the_openai_model_still_loads() {
        let settings: Settings = serde_json::from_str(r#"{"geminiModel":"gemini-3.8-flash"}"#).unwrap();
        assert_eq!(settings.openai_model, DEFAULT_OPENAI_MODEL);
        assert!(settings.graphic_presets.is_empty() && settings.brand_kits.is_empty(), "files from before the graphics system still load");
    }

    #[test]
    fn update_address_and_favorites_are_checked_and_tidied() {
        let ok = Settings { library_update_url: " https://example.com/rel/ ".into(), sfx_favorites: vec![" a ".into(), "a".into(), "".into(), "b".into()], ..Settings::default() };
        let ok = ok.validated().unwrap();
        assert_eq!(ok.library_update_url, "https://example.com/rel");
        assert_eq!(ok.sfx_favorites, vec!["a", "b"]);
        let styles = Settings { style_favorites: vec![" noir ".into(), "noir".into()], recent_styles: (0..9).map(|i| format!("s{i}")).collect(), ..Settings::default() }.validated().unwrap();
        assert_eq!(styles.style_favorites, vec!["noir"]);
        assert_eq!(styles.recent_styles.len(), 6);
        let bad = Settings { library_update_url: "http://example.com".into(), ..Settings::default() };
        assert!(bad.validated().is_err());
        let bad_app = Settings { app_update_url: "http://example.com/latest.json".into(), ..Settings::default() };
        assert!(bad_app.validated().is_err());
        let good_app = Settings { app_update_url: " https://example.com/latest.json ".into(), ..Settings::default() };
        assert_eq!(good_app.validated().unwrap().app_update_url, "https://example.com/latest.json");
        let empty = Settings { library_update_url: String::new(), ..Settings::default() };
        assert!(empty.validated().is_ok());
    }

    #[test]
    fn a_missing_file_gives_the_defaults() {
        let folder = temp_folder("missing");
        let settings = load_from(&folder.join(FILE_NAME)).unwrap();
        assert_eq!(settings, Settings::default());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn saved_settings_load_back_the_same() {
        let folder = temp_folder("roundtrip");
        let path = folder.join("nested").join(FILE_NAME);
        let settings = Settings {
            gemini_model: "gemini-3.6-flash".into(),
            fallback_to_groq: true,
            export_folder: "/videos".into(),
            default_aspect_ratio: AspectRatio::Portrait,
            default_quality: Quality::K4,
            ..Settings::default()
        };
        save_to(&path, &settings).unwrap();
        assert_eq!(load_from(&path).unwrap(), settings);
        assert!(!path.with_extension("json.tmp").exists());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn a_corrupt_file_is_set_aside_and_defaults_are_used() {
        let folder = temp_folder("corrupt");
        let path = folder.join(FILE_NAME);
        fs::write(&path, "{ this is not json").unwrap();
        assert_eq!(load_from(&path).unwrap(), Settings::default());
        assert!(!path.exists());
        assert!(folder.join(CORRUPT_FILE_NAME).exists());
        fs::remove_dir_all(folder).unwrap();
    }
}
