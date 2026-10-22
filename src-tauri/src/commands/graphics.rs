//! Transparent export of graphics drawn by the TypeScript renderer (see `graphics/export.rs`).

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, State};

use crate::graphics::cache::{self, CacheInfo};

use crate::commands::error::AppError;
use crate::commands::projects::project_folder;
use crate::graphics::export::{GraphicClip, GraphicExports};
use crate::jobs::{event_sink, JobRegistry};

/// Starts an export: FFmpeg waits for `frames` raw RGBA frames of `width` x `height`. The job id is the export id.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn graphic_export_start(app: AppHandle, jobs: State<'_, JobRegistry>, exports: State<'_, GraphicExports>, project_id: String, graphic_id: String, width: u32, height: u32, frames: u32, job_id: String) -> Result<(), AppError> {
    let dir = project_folder(&app, &project_id)?;
    crate::graphics::export::validate(&graphic_id, width, height, frames)?;
    let job = jobs.begin(&job_id, "graphic-export", event_sink(app))?;
    exports.start(job, &dir, &graphic_id, width, height, frames).await
}

/// One frame as the raw request body (RGBA bytes, straight alpha). The export id is in the `x-job-id` header.
#[tauri::command]
pub async fn graphic_export_frame(exports: State<'_, GraphicExports>, request: Request<'_>) -> Result<(), AppError> {
    let job_id = request.headers().get("x-job-id").and_then(|v| v.to_str().ok()).unwrap_or_default().to_string();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::new("A frame of the graphic was sent in a wrong way.", "the body is not raw bytes".to_string()));
    };
    exports.frame(&job_id, bytes).await
}

#[tauri::command]
pub async fn graphic_export_finish(exports: State<'_, GraphicExports>, job_id: String) -> Result<GraphicClip, AppError> {
    exports.finish(&job_id).await
}

/// Stops an export and removes its temporary file (safe to call when it is already gone).
#[tauri::command]
pub async fn graphic_export_abort(exports: State<'_, GraphicExports>, job_id: String) -> Result<(), AppError> {
    exports.abort(&job_id).await;
    Ok(())
}

fn cache_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    let folder = app.path().app_data_dir().map_err(|e| AppError::new("The app data folder could not be found.", e.to_string()))?;
    Ok(folder.join("graphics-cache"))
}

/// A clip with this key from an earlier drawing, copied into the project as graphics/<id>/clip.mov. None = not cached.
#[tauri::command]
pub async fn graphic_cache_restore(app: AppHandle, project_id: String, graphic_id: String, key: String) -> Result<Option<GraphicClip>, AppError> {
    let (dir, cache) = (project_folder(&app, &project_id)?, cache_dir(&app)?);
    tauri::async_runtime::spawn_blocking(move || cache::restore(&cache, &key, &dir, &graphic_id)).await.map_err(|e| AppError::new("The graphic cache stopped.", e.to_string()))?
}

/// Keeps a finished clip of the project in the cache (and trims the cache to 5 GB).
#[tauri::command]
pub async fn graphic_cache_store(app: AppHandle, project_id: String, graphic_id: String, key: String, frames: u32, width: u32, height: u32) -> Result<(), AppError> {
    let (dir, cache) = (project_folder(&app, &project_id)?, cache_dir(&app)?);
    let clip = GraphicClip { path: format!("graphics/{graphic_id}/clip.mov"), frames, width, height, size_bytes: 0 };
    if !crate::graphics::export::valid_graphic_id(&graphic_id) {
        return Err(AppError::new("The graphic has a wrong name.", format!("graphic id = {graphic_id:?}")));
    }
    tauri::async_runtime::spawn_blocking(move || cache::store(&cache, &key, &dir, &clip, cache::LIMIT_BYTES)).await.map_err(|e| AppError::new("The graphic cache stopped.", e.to_string()))?
}

#[tauri::command]
pub async fn graphic_cache_info(app: AppHandle) -> Result<CacheInfo, AppError> {
    let cache = cache_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || cache::info(&cache)).await.map_err(|e| AppError::new("The graphic cache stopped.", e.to_string()))
}

#[tauri::command]
pub async fn graphic_cache_clear(app: AppHandle) -> Result<(), AppError> {
    let cache = cache_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || cache::clear(&cache)).await.map_err(|e| AppError::new("The graphic cache stopped.", e.to_string()))?
}
