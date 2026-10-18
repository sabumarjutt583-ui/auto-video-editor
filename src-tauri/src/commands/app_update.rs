//! Updates of the app itself (signed, with the Tauri updater plugin).

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::commands::error::AppError;
use crate::jobs::{event_sink, JobRegistry};
use crate::{logging, settings};

/// The update that was found and is waiting to be installed.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    pub version: String,
    pub current: String,
    pub notes: String,
}

fn failed(what: &str, e: impl std::fmt::Display) -> AppError {
    AppError::new(format!("{what} Please check your internet connection and try again."), e.to_string())
}

/// Looks for a newer app version. `None` means this is the newest one.
#[tauri::command]
pub async fn check_app_update(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<Option<AppUpdateInfo>, AppError> {
    // The Admin Edition is updated by hand: an update of the user build would replace it.
    if cfg!(feature = "admin") {
        return Ok(None);
    }
    let saved = settings::load(&app)?;
    let mut builder = app.updater_builder().timeout(Duration::from_secs(20));
    if !saved.app_update_url.is_empty() {
        let url = saved.app_update_url.parse().map_err(|e| failed("The app update address is not valid.", e))?;
        builder = builder.endpoints(vec![url]).map_err(|e| failed("The app update address is not valid.", e))?;
    }
    let updater = builder.build().map_err(|e| failed("The update check could not start.", e))?;
    let found = updater.check().await.map_err(|e| failed("Could not check for a new version.", e))?;
    let info = found.as_ref().map(|u| AppUpdateInfo { version: u.version.clone(), current: u.current_version.clone(), notes: u.body.clone().unwrap_or_default().chars().take(2000).collect() });
    logging::info("update", &match &info {
        Some(i) => format!("New version {} is available (now {}).", i.version, i.current),
        None => "The app is up to date.".to_string(),
    });
    *pending.0.lock().unwrap_or_else(|e| e.into_inner()) = found;
    Ok(info)
}

/// Downloads the update found by `check_app_update`, checks its signature and installs it.
/// On Windows the app closes and the installer takes over.
#[tauri::command]
pub async fn install_app_update(app: AppHandle, jobs: State<'_, JobRegistry>, pending: State<'_, PendingUpdate>, job_id: String) -> Result<(), AppError> {
    let update = pending.0.lock().unwrap_or_else(|e| e.into_inner()).take().ok_or_else(|| AppError::new("Please check for updates first.", "no pending update"))?;
    let job = jobs.begin(&job_id, "app-update", event_sink(app))?;
    job.progress("Downloading the update", 0.0);
    let mut received: u64 = 0;
    let install = update.download_and_install(
        |chunk, total| {
            received += chunk as u64;
            if let Some(total) = total.filter(|t| *t > 0) {
                job.progress("Downloading the update", received as f64 / total as f64 * 100.0);
            }
        },
        || job.progress("Installing the update", 100.0),
    );
    tokio::select! {
        () = job.cancelled() => Err(AppError::cancelled()),
        result = install => result.map_err(|e| {
            logging::error("update", &format!("install failed: {e}"));
            AppError::new("The update could not be installed. Nothing was changed. Please try again later.", e.to_string())
        }),
    }
}
