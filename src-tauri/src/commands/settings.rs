use tauri::AppHandle;

use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::settings::{self as store, Settings};

/// Loads the non-secret settings (defaults when nothing has been saved yet).
#[tauri::command]
pub async fn load_settings(app: AppHandle) -> Result<Settings, AppError> {
    let path = store::settings_path(&app)?;
    run_blocking(move || store::load_from(&path)).await
}

/// Validates and saves the settings, and returns the tidied values that were stored.
#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: Settings) -> Result<Settings, AppError> {
    let path = store::settings_path(&app)?;
    run_blocking(move || {
        let settings = settings.validated()?;
        store::save_to(&path, &settings)?;
        Ok(settings)
    })
    .await
}
