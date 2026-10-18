use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::captions::{build_ass, AssRequest};
use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::commands::projects::project_folder;

/// The folder with the bundled fonts: the app's resources, or the source tree when developing.
pub fn fonts_folder(app: &AppHandle) -> PathBuf {
    if let Ok(resources) = app.path().resource_dir() {
        let bundled = resources.join("resources").join("fonts");
        if bundled.is_dir() {
            return bundled;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("resources").join("fonts")
}

/// Where the bundled fonts are (the preview loads them from here; the render gives it to FFmpeg).
#[tauri::command]
pub async fn fonts_dir(app: AppHandle) -> Result<String, AppError> {
    Ok(fonts_folder(&app).to_string_lossy().into_owned())
}

/// Writes the captions as an ASS file in the project's `exports` folder and gives back its path.
#[tauri::command]
pub async fn generate_ass(app: AppHandle, project_id: String, request: AssRequest) -> Result<String, AppError> {
    let folder = project_folder(&app, &project_id)?.join("exports");
    run_blocking(move || {
        std::fs::create_dir_all(&folder).map_err(|e| AppError::new("The captions folder could not be created.", e.to_string()))?;
        let path = folder.join("captions.ass");
        std::fs::write(&path, build_ass(&request)).map_err(|e| AppError::new("The caption file could not be saved.", format!("{e} ({})", path.display())))?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
}
