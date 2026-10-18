use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::audio::paths::accepted_extension;
use crate::audio::probe::probe;
use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::commands::projects::project_folder;
use crate::jobs::{event_sink, JobRegistry};
use crate::media::names;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicFile {
    /// Inside the project, e.g. "music/theme.mp3".
    pub path: String,
    pub name: String,
    pub duration: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicFailure {
    pub name: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicImport {
    pub imported: Vec<MusicFile>,
    pub failed: Vec<MusicFailure>,
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Copies music files into the project's `music` folder (the originals are never changed) and reads their length.
#[tauri::command]
pub async fn import_music(app: AppHandle, jobs: State<'_, JobRegistry>, project_id: String, paths: Vec<String>, job_id: String) -> Result<MusicImport, AppError> {
    let folder = project_folder(&app, &project_id)?.join("music");
    let job = jobs.begin(&job_id, "music", event_sink(app))?;
    let mut result = MusicImport { imported: Vec::new(), failed: Vec::new() };
    let total = paths.len().max(1) as f64;

    for (i, source) in paths.iter().enumerate() {
        job.check()?;
        job.progress("Adding music", i as f64 / total * 100.0);
        let source = Path::new(source).to_path_buf();
        let name = file_name(&source);
        if accepted_extension(&source).is_none() {
            result.failed.push(MusicFailure { name, reason: "This is not a music file. Use mp3, wav, m4a, aac, ogg or flac.".into() });
            continue;
        }
        let Some(safe) = names::safe_file_name(&name) else {
            result.failed.push(MusicFailure { name, reason: "The file name cannot be used.".into() });
            continue;
        };
        let (folder_clone, source_clone) = (folder.clone(), source.clone());
        let copied = run_blocking(move || {
            std::fs::create_dir_all(&folder_clone).map_err(|e| AppError::new("The music folder could not be created.", e.to_string()))?;
            let unique = names::unique_name(&folder_clone, &safe);
            std::fs::copy(&source_clone, folder_clone.join(&unique)).map_err(|e| AppError::new("The music file could not be copied.", format!("{e} ({})", source_clone.display())))?;
            Ok(unique)
        })
        .await;
        let unique = match copied {
            Ok(unique) => unique,
            Err(error) => {
                result.failed.push(MusicFailure { name, reason: error.message });
                continue;
            }
        };
        match probe(&folder.join(&unique)).await {
            Ok(info) => result.imported.push(MusicFile { path: format!("music/{unique}"), name: unique, duration: info.duration }),
            Err(error) => {
                let _ = std::fs::remove_file(folder.join(&unique));
                result.failed.push(MusicFailure { name, reason: error.message });
            }
        }
    }
    job.progress("Adding music", 100.0);
    Ok(result)
}

/// Deletes a music file from the project's `music` folder (nothing else can be deleted here).
#[tauri::command]
pub async fn remove_music(app: AppHandle, project_id: String, path: String) -> Result<(), AppError> {
    let project_dir = project_folder(&app, &project_id)?;
    let target = crate::audio::paths::resolve(&project_dir, &path)?;
    if target.parent() != Some(project_dir.join("music").as_path()) {
        return Err(AppError::new("Only music files of this project can be removed.", format!("Not in the music folder: {path:?}")));
    }
    run_blocking(move || match std::fs::remove_file(&target) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AppError::new("The music file could not be removed.", e.to_string())),
    })
    .await
}
