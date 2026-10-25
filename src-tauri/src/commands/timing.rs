use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::audio::paths::resolve;
use crate::audio::probe::probe;
use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::commands::projects::project_folder;
use crate::jobs::{event_sink, JobRegistry};
use crate::keys::{self, Provider};
use crate::settings;
use crate::timing::{self, SpokenWord, TranscribeRequest};

/// Biggest script or timing file the app reads (about 5 million characters).
const MAX_TEXT_FILE_BYTES: u64 = 10 * 1024 * 1024;

/// Reads a text file the user picked (script, SRT, VTT, JSON). Handles UTF-8 and UTF-16 files.
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, AppError> {
    run_blocking(move || {
        let file = PathBuf::from(&path);
        let metadata = std::fs::metadata(&file).map_err(|e| AppError::new("That file could not be opened.", format!("{e} ({path})")))?;
        if !metadata.is_file() {
            return Err(AppError::new("That is not a file.", path));
        }
        if metadata.len() > MAX_TEXT_FILE_BYTES {
            return Err(AppError::new("That file is too big to be a script or timing file.", format!("{} bytes", metadata.len())));
        }
        let bytes = std::fs::read(&file).map_err(|e| AppError::new("That file could not be read.", e.to_string()))?;
        decode_text(&bytes)
    })
    .await
}

/// Turns file bytes into text: UTF-8 (with or without a BOM) or UTF-16 with a BOM.
pub fn decode_text(bytes: &[u8]) -> Result<String, AppError> {
    let utf16 = |rest: &[u8], little: bool| -> Result<String, AppError> {
        let units: Vec<u16> = rest.chunks_exact(2).map(|p| if little { u16::from_le_bytes([p[0], p[1]]) } else { u16::from_be_bytes([p[0], p[1]]) }).collect();
        String::from_utf16(&units).map_err(|e| AppError::new("That file is not readable text.", e.to_string()))
    };
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return utf16(rest, true);
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return utf16(rest, false);
    }
    let rest = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    String::from_utf8(rest.to_vec())
        .map_err(|e| AppError::new("That file is not UTF-8 text. Please save it as UTF-8 and try again.", e.to_string()))
}

/// Sends the locked voice to Groq Whisper and returns every word with its time.
#[tauri::command]
pub async fn transcribe_voice(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    project_id: String,
    voice_path: String,
    language: Option<String>,
    job_id: String,
) -> Result<Vec<SpokenWord>, AppError> {
    let project_dir = project_folder(&app, &project_id)?;
    let file = resolve(&project_dir, &voice_path)?;
    if !file.is_file() {
        return Err(AppError::new("The voice file is missing from the project.", format!("{} does not exist", file.display())));
    }
    run_blocking(|| keys::require(Provider::Groq)).await?;
    let app_for_settings = app.clone();
    let model = run_blocking(move || settings::load(&app_for_settings)).await?.groq_whisper_model;

    let job = jobs.begin(&job_id, "transcribe", event_sink(app))?;
    let info = probe(&file).await?;
    let temp_dir = project_dir.join("audio").join("transcribe-tmp");
    let request = TranscribeRequest {
        file: &file,
        duration: info.duration,
        temp_dir,
        model: &model,
        language: language.as_deref(),
    };
    timing::transcribe_voice(&job, request).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf8_with_and_without_bom_and_utf16() {
        assert_eq!(decode_text("안녕".as_bytes()).unwrap(), "안녕");
        assert_eq!(decode_text(&[0xEF, 0xBB, 0xBF, b'h', b'i']).unwrap(), "hi");
        assert_eq!(decode_text(&[0xFF, 0xFE, b'h', 0, b'i', 0]).unwrap(), "hi");
        assert_eq!(decode_text(&[0xFE, 0xFF, 0, b'h', 0, b'i']).unwrap(), "hi");
        assert!(decode_text(&[0xC3, 0x28]).is_err());
    }

    #[tokio::test]
    async fn reads_a_file_and_refuses_missing_ones() {
        let path = std::env::temp_dir().join(format!("ave-read-{}.txt", std::process::id()));
        std::fs::write(&path, "hello").unwrap();
        assert_eq!(read_text_file(path.to_string_lossy().into_owned()).await.unwrap(), "hello");
        let _ = std::fs::remove_file(&path);
        assert!(read_text_file("/definitely/not/here.txt".into()).await.is_err());
    }
}
