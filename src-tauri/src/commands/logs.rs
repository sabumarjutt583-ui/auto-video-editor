use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::logging;

pub fn logs_folder(app: &AppHandle) -> Result<PathBuf, AppError> {
    let folder = app.path().app_data_dir().map_err(|e| AppError::new("The app data folder could not be found.", e.to_string()))?;
    Ok(folder.join("logs"))
}

/// Puts all log files into one text file in `dest` (a folder the person chose) and returns its path.
#[tauri::command]
pub async fn export_logs(app: AppHandle, dest: String) -> Result<String, AppError> {
    let dir = logs_folder(&app)?;
    run_blocking(move || {
        if dest.trim().is_empty() || dest.contains('\0') {
            return Err(AppError::new("Please choose a folder first.", "empty destination"));
        }
        let header = format!("Auto Video Editor {} on {} {}", env!("CARGO_PKG_VERSION"), std::env::consts::OS, std::env::consts::ARCH);
        logging::export(&dir, &PathBuf::from(dest.trim()), &header)
            .map(|path| path.to_string_lossy().into_owned())
            .map_err(|e| AppError::new("The log file could not be saved there.", e))
    })
    .await
}

/// The window reports an unexpected problem so it ends up in the log, too.
#[tauri::command]
pub async fn log_frontend_error(message: String) -> Result<(), AppError> {
    logging::error("window", &message);
    Ok(())
}
