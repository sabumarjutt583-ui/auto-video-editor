use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::commands::sfx::bundled_sfx_folder;
use crate::commands::styles::bundled_styles_dir;
use crate::jobs::{event_sink, JobRegistry};
use crate::library::manifest::Kind;
use crate::library::store::{self, LibraryStatus};
use crate::library::update::{update_all, UpdateReport};
use crate::settings;

/// Where downloaded packages are kept.
pub fn library_root(app: &AppHandle) -> Result<PathBuf, AppError> {
    let folder = app.path().app_data_dir().map_err(|e| AppError::new("The app data folder could not be found.", e.to_string()))?;
    Ok(folder.join("library"))
}

fn bundled_dirs(app: &AppHandle) -> Vec<(Kind, PathBuf)> {
    vec![(Kind::Sfx, bundled_sfx_folder(app)), (Kind::Styles, bundled_styles_dir(app))]
}

/// Which version of the sounds and styles is in use, and where it came from.
#[tauri::command]
pub async fn library_status(app: AppHandle) -> Result<Vec<LibraryStatus>, AppError> {
    let root = library_root(&app)?;
    let dirs = bundled_dirs(&app);
    run_blocking(move || Ok(dirs.iter().map(|(kind, dir)| store::status(&root, *kind, dir)).collect())).await
}

/// Checks the update address in Settings and installs newer sound and style packages.
#[tauri::command]
pub async fn update_libraries(app: AppHandle, jobs: State<'_, JobRegistry>, job_id: String) -> Result<UpdateReport, AppError> {
    let url = settings::load(&app)?.library_update_url;
    if url.is_empty() {
        return Err(AppError::new("No update address is set. Add it in Settings under Library updates.", "library_update_url is empty"));
    }
    let root = library_root(&app)?;
    let dirs = bundled_dirs(&app);
    let job = jobs.begin(&job_id, "library", event_sink(app))?;
    update_all(&root, &dirs, &url, &job).await
}

/// Goes back to the version before the current downloaded one.
#[tauri::command]
pub async fn rollback_library(app: AppHandle, kind: Kind) -> Result<Vec<LibraryStatus>, AppError> {
    let root = library_root(&app)?;
    let dirs = bundled_dirs(&app);
    run_blocking(move || {
        store::rollback(&root, kind)?;
        Ok(dirs.iter().map(|(kind, dir)| store::status(&root, *kind, dir)).collect())
    })
    .await
}
