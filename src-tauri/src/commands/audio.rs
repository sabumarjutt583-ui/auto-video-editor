use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::audio::paths::{accepted_extension, resolve, ORIGINAL_STEM, PROCESSED_FILE};
use crate::audio::peaks::{waveform, Waveform};
use crate::audio::probe::probe;
use crate::audio::process::{self, CleanupParams, CleanupResult, SilenceReport};
use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::commands::projects::project_folder;
use crate::jobs::{event_sink, JobRegistry};

const TEMP_FILE: &str = "processed.tmp.wav";
const FILTER_FILE: &str = "cut-filter.tmp.txt";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceImport {
    pub original_path: String,
    pub duration: f64,
    pub sample_rate: u32,
    pub channels: u32,
    pub codec: String,
}

fn audio_folder(project_dir: &Path) -> PathBuf {
    project_dir.join("audio")
}

/// Copies a voice file into the project as `audio/original.<ext>` and reads its details.
/// Any earlier voice files of the project are removed.
#[tauri::command]
pub async fn import_voice(app: AppHandle, project_id: String, source_path: String) -> Result<VoiceImport, AppError> {
    let project_dir = project_folder(&app, &project_id)?;
    let source = PathBuf::from(&source_path);
    let extension = accepted_extension(&source).ok_or_else(|| {
        AppError::new(
            "This file type is not supported. Please choose an mp3, wav, m4a, aac, ogg or flac file.",
            format!("Unsupported file: {source_path}"),
        )
    })?;
    if !source.is_file() {
        return Err(AppError::new("That file could not be found.", format!("Not a file: {source_path}")));
    }

    // Read it first, so a broken file never replaces a good voice.
    let info = probe(&source).await?;

    let relative = format!("audio/{ORIGINAL_STEM}.{extension}");
    let folder = audio_folder(&project_dir);
    let target = folder.join(format!("{ORIGINAL_STEM}.{extension}"));
    run_blocking(move || {
        std::fs::create_dir_all(&folder).map_err(|e| AppError::new("The audio folder could not be created.", e.to_string()))?;
        if let Ok(entries) = std::fs::read_dir(&folder) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with(&format!("{ORIGINAL_STEM}.")) || name == PROCESSED_FILE || name == TEMP_FILE {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
        std::fs::copy(&source, &target)
            .map(|_| ())
            .map_err(|e| AppError::new("The voice file could not be copied into the project.", format!("{e} ({})", target.display())))
    })
    .await?;

    Ok(VoiceImport { original_path: relative, duration: info.duration, sample_rate: info.sample_rate, channels: info.channels, codec: info.codec })
}

/// Moves the voice files of the open part into `audio/parts/<stash>/` and, when `restore` is given, brings that
/// part's files back into `audio/`. Paths stored in the project never change (they always point into `audio/`).
#[tauri::command]
pub async fn swap_voice_files(app: AppHandle, project_id: String, stash: String, restore: Option<String>) -> Result<(), AppError> {
    let project_dir = project_folder(&app, &project_id)?;
    run_blocking(move || swap_files(&audio_folder(&project_dir), &stash, restore.as_deref())).await
}

fn part_folder_name(name: &str) -> Result<&str, AppError> {
    if name.is_empty() || name.len() > 40 || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(AppError::new("That part could not be used.", format!("Bad part id: {name}")));
    }
    Ok(name)
}

fn is_voice_file(name: &str) -> bool {
    name.starts_with(&format!("{ORIGINAL_STEM}.")) || name == PROCESSED_FILE
}

fn move_voice_files(from: &Path, to: &Path) -> Result<(), AppError> {
    let Ok(entries) = std::fs::read_dir(from) else { return Ok(()) };
    std::fs::create_dir_all(to).map_err(|e| AppError::new("The audio folder could not be created.", e.to_string()))?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.path().is_file() && is_voice_file(&name) {
            std::fs::rename(entry.path(), to.join(&name)).map_err(|e| AppError::new("The voice files of the part could not be moved.", format!("{e} ({name})")))?;
        }
    }
    Ok(())
}

fn swap_files(audio: &Path, stash: &str, restore: Option<&str>) -> Result<(), AppError> {
    let stash_dir = audio.join("parts").join(part_folder_name(stash)?);
    move_voice_files(audio, &stash_dir)?;
    if let Some(restore) = restore {
        let from = audio.join("parts").join(part_folder_name(restore)?);
        move_voice_files(&from, audio)?;
    }
    Ok(())
}

#[cfg(test)]
mod swap_tests {
    use super::*;

    #[test]
    fn voice_files_are_stashed_and_restored() {
        let dir = std::env::temp_dir().join(format!("av-swap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("original.mp3"), b"one").unwrap();
        std::fs::write(dir.join("processed.wav"), b"one-p").unwrap();
        std::fs::write(dir.join("other.txt"), b"keep").unwrap();
        swap_files(&dir, "p1", None).unwrap();
        assert!(!dir.join("original.mp3").exists() && dir.join("other.txt").exists());
        assert!(dir.join("parts/p1/processed.wav").is_file());
        std::fs::write(dir.join("original.wav"), b"two").unwrap();
        swap_files(&dir, "p2", Some("p1")).unwrap();
        assert_eq!(std::fs::read(dir.join("original.mp3")).unwrap(), b"one");
        assert_eq!(std::fs::read(dir.join("parts/p2/original.wav")).unwrap(), b"two");
        assert!(swap_files(&dir, "../x", None).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// Peaks for drawing the waveform of a project audio file.
#[tauri::command]
pub async fn get_waveform(app: AppHandle, project_id: String, path: String) -> Result<Waveform, AppError> {
    let file = resolve(&project_folder(&app, &project_id)?, &path)?;
    let info = probe(&file).await?;
    waveform(&file, info.duration).await
}

/// The full path of a project file, so the player can load it.
#[tauri::command]
pub async fn project_file_path(app: AppHandle, project_id: String, path: String) -> Result<String, AppError> {
    let file = resolve(&project_folder(&app, &project_id)?, &path)?;
    if !file.is_file() {
        return Err(AppError::new("The audio file is missing from the project.", format!("{} does not exist", file.display())));
    }
    Ok(file.to_string_lossy().into_owned())
}

/// Finds the silences that would be removed and the new length. Changes nothing.
#[tauri::command]
pub async fn preview_silence(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    project_id: String,
    original_path: String,
    params: CleanupParams,
    job_id: String,
) -> Result<SilenceReport, AppError> {
    let params = params.validated()?;
    let file = resolve(&project_folder(&app, &project_id)?, &original_path)?;
    let job = jobs.begin(&job_id, "silence-preview", event_sink(app))?;
    let info = probe(&file).await?;
    process::preview(&job, &file, &info, params, 0.0, 100.0).await
}

/// Cuts the silences and writes `audio/processed.wav`.
#[tauri::command]
pub async fn apply_silence_removal(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    project_id: String,
    original_path: String,
    params: CleanupParams,
    job_id: String,
) -> Result<CleanupResult, AppError> {
    let params = params.validated()?;
    finish_cleanup(app, jobs, project_id, original_path, params, job_id, true).await
}

/// Keeps the whole voice (converted to 48 kHz WAV) as `audio/processed.wav`.
#[tauri::command]
pub async fn skip_silence_removal(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    project_id: String,
    original_path: String,
    normalize: bool,
    job_id: String,
) -> Result<CleanupResult, AppError> {
    let params = CleanupParams { threshold_db: -40.0, min_silence: 0.6, padding: 0.15, normalize };
    finish_cleanup(app, jobs, project_id, original_path, params, job_id, false).await
}

async fn finish_cleanup(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    project_id: String,
    original_path: String,
    params: CleanupParams,
    job_id: String,
    cut: bool,
) -> Result<CleanupResult, AppError> {
    let project_dir = project_folder(&app, &project_id)?;
    let input = resolve(&project_dir, &original_path)?;
    let folder = audio_folder(&project_dir);
    let temp = folder.join(TEMP_FILE);
    let target = folder.join(PROCESSED_FILE);
    let job = jobs.begin(&job_id, if cut { "silence-apply" } else { "silence-skip" }, event_sink(app))?;

    let info = probe(&input).await?;
    let outcome = if cut {
        process::apply_cut(&job, &input, &info, &temp, &folder.join(FILTER_FILE), params).await
    } else {
        process::convert_only(&job, &input, &info, &temp, params.normalize).await.map(|()| Vec::new())
    };
    let removed = match outcome {
        Ok(removed) => removed,
        Err(error) => {
            let _ = std::fs::remove_file(&temp);
            return Err(error);
        }
    };

    let (temp_clone, target_clone) = (temp.clone(), target.clone());
    run_blocking(move || {
        std::fs::rename(&temp_clone, &target_clone)
            .map_err(|e| AppError::new("The cleaned voice could not be saved.", format!("{e} ({})", target_clone.display())))
    })
    .await?;

    let result = probe(&target).await?;
    Ok(CleanupResult {
        processed_path: format!("audio/{PROCESSED_FILE}"),
        duration: result.duration,
        removed,
        sample_rate: result.sample_rate,
        channels: result.channels,
    })
}

/// Stops a running job (silence preview, cleanup, transcription...).
#[tauri::command]
pub fn cancel_job(jobs: State<'_, JobRegistry>, job_id: String) -> bool {
    jobs.cancel(&job_id)
}
