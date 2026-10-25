//! The script writer: Claude's chat page, used only to write scripts (see `imagegen::script_chat`).

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::commands::error::AppError;
use crate::imagegen::browser::locator;
use crate::imagegen::chat::MIN_ANSWER_WAIT_SECS;
use crate::imagegen::errors::GenError;
use crate::imagegen::ops::{to_app_error, ImageGen};
use crate::imagegen::real::mode_of;
use crate::imagegen::script_chat::{BrowserChoice, ScriptChat, ScriptStatus};
use crate::jobs::{event_sink, JobRegistry};

pub type Script<'a> = State<'a, Arc<ScriptChat>>;

pub fn create(app: &AppHandle) -> Result<Arc<ScriptChat>, AppError> {
    let dir = app.path().app_data_dir().map_err(|e| AppError::new("The app data folder could not be found.", e.to_string()))?.join("claude");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::new("The script writer folder could not be created.", e.to_string()))?;
    Ok(Arc::new(ScriptChat::new(dir)))
}

fn browser_of(ig: &ImageGen) -> Result<BrowserChoice, GenError> {
    let settings = ig.engine.settings();
    let exe = locator::find(Some(&settings.browser_path)).ok_or_else(|| {
        GenError::new(crate::imagegen::errors::ErrorKind::Session, "No Chrome, Edge, Brave or Chromium browser was found. Please install one (Chrome is best) or choose a browser in Settings.")
    })?;
    Ok(BrowserChoice { exe, mode: mode_of(settings.browser_mode), extra_args: ig.browser_args() })
}

#[tauri::command]
pub async fn script_status(script: Script<'_>) -> Result<ScriptStatus, AppError> {
    Ok(script.status())
}

#[tauri::command]
pub async fn script_accept_consent(script: Script<'_>) -> Result<ScriptStatus, AppError> {
    script.accept_consent();
    Ok(script.status())
}

/// Opens the person's own browser on Claude's sign-in page. Returns when the window is closed and the sign-in was checked.
#[tauri::command]
pub async fn script_sign_in(script: Script<'_>, ig: State<'_, Arc<ImageGen>>) -> Result<ScriptStatus, AppError> {
    let browser = browser_of(&ig).map_err(|e| to_app_error(&e))?;
    let config = ig.engine.config();
    script.sign_in(&browser, &config).await.map_err(|e| to_app_error(&e))?;
    Ok(script.status())
}

/// "I have signed in": closes the sign-in window.
#[tauri::command]
pub async fn script_confirm_signed_in(script: Script<'_>) -> Result<(), AppError> {
    script.confirm_signed_in();
    Ok(())
}

#[tauri::command]
pub async fn script_check(script: Script<'_>, ig: State<'_, Arc<ImageGen>>) -> Result<ScriptStatus, AppError> {
    let browser = browser_of(&ig).map_err(|e| to_app_error(&e))?;
    let config = ig.engine.config();
    script.check(&browser, &config).await.map_err(|e| to_app_error(&e))?;
    Ok(script.status())
}

#[tauri::command]
pub async fn script_disconnect(script: Script<'_>) -> Result<ScriptStatus, AppError> {
    script.disconnect();
    Ok(script.status())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptAnswer {
    pub text: String,
}

/// Writes one script: the prompt goes into a fresh Claude chat and the finished answer comes back. Can be cancelled.
#[tauri::command]
pub async fn script_ask(app: AppHandle, jobs: State<'_, JobRegistry>, script: Script<'_>, ig: State<'_, Arc<ImageGen>>, prompt: String, job_id: String) -> Result<ScriptAnswer, AppError> {
    let job = jobs.begin(&job_id, "script", event_sink(app))?;
    let browser = browser_of(&ig).map_err(|e| to_app_error(&e))?;
    let config = ig.engine.config();
    job.progress("Asking Claude to write the script", 5.0);
    let report = |msg: String| job.progress(&msg, 30.0);
    let timeout = Duration::from_secs(MIN_ANSWER_WAIT_SECS);
    let reply = tokio::select! {
        () = job.cancelled() => return Err(AppError::cancelled()),
        reply = script.ask(&browser, &config, &prompt, timeout, Some(&report)) => reply.map_err(|e| to_app_error(&e))?,
    };
    Ok(ScriptAnswer { text: reply.text })
}
