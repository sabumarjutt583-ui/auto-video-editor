//! Transparent export of graphics drawn by the TypeScript renderer (see `graphics/export.rs`).

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, State};

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
