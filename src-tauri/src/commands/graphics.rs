//! Transparent export of graphics drawn by the TypeScript renderer (see `graphics/export.rs`).

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, State};

use crate::graphics::cache::{self, CacheInfo};

use crate::commands::blocking::run_blocking;
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

/// The first bundled font file, for drawtext. Returns an error when no font is installed.
fn find_font(app: &AppHandle) -> Result<String, AppError> {
    let fonts_dir = crate::commands::captions::fonts_folder(app);
    let mut names: Vec<std::path::PathBuf> = std::fs::read_dir(&fonts_dir).ok().and_then(|entries| {
        let mut names: Vec<std::path::PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e == "ttf" || e == "otf")).collect();
        names.sort();
        Some(names)
    }).unwrap_or_default();
    let font = names.drain(..).next().ok_or_else(|| AppError::new("No font was found for the text, so the graphic could not be drawn.", format!("{}", fonts_dir.display())))?;
    Ok(font.to_string_lossy().replace('\\', "/").replace(':', "\\:"))
}

/// Turns a graphic spec into FFmpeg filters (text + lower-third only; other layer types
/// are listed as skipped). The filters are drawn over a video by `graphics_apply_overlay`.
#[tauri::command]
pub async fn graphics_filters(app: AppHandle, spec_json: String, width: u32, height: u32) -> Result<crate::graphics::draw::DrawResult, AppError> {
    let fontfile = find_font(&app)?;
    crate::graphics::draw::draw_filters(&spec_json, width, height, &fontfile).map_err(|e| AppError::new("The graphic could not be planned.", e))
}

/// Draws a graphic spec over a finished video of this project and saves a new MP4 next
/// to it (`<name>-graphics.mp4`). The input must be inside the project's folder. Only
/// text and lower-third layers are drawn; other layers are skipped and listed.
#[tauri::command]
pub async fn graphics_apply_overlay(app: AppHandle, project_id: String, input_path: String, spec_json: String) -> Result<crate::graphics::draw::DrawResult, AppError> {
    use crate::commands::projects::project_folder;
    use crate::ffmpeg::{command, Tool};
    use crate::media::probe::probe;
    use crate::render::encoder;
    let project_dir = project_folder(&app, &project_id)?;
    let input = std::path::Path::new(&input_path);
    let canonical = input.canonicalize().map_err(|e| AppError::new("The finished video could not be found.", format!("{e} ({input_path})")))?;
    let root = project_dir.canonicalize().unwrap_or(project_dir.clone());
    if !canonical.starts_with(&root) {
        return Err(AppError::new("That video is not inside this project.", format!("{input_path}")));
    }
    let info = probe(&canonical).await?;
    let fontfile = find_font(&app)?;
    let drawn = crate::graphics::draw::draw_filters(&spec_json, info.width, info.height, &fontfile).map_err(|e| AppError::new("The graphic could not be planned.", e))?;
    if drawn.filters.is_empty() {
        return Err(AppError::new("The graphic has nothing this overlay can draw (only text and lower-third layers are drawn).", "no drawable layers"));
    }
    let exports = project_dir.join("exports");
    std::fs::create_dir_all(&exports).map_err(|e| AppError::new("The exports folder could not be made.", e.to_string()))?;
    let stem = canonical.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "video".to_string());
    let mut output = exports.join(format!("{stem}-graphics.mp4"));
    let mut n = 2;
    while output.exists() {
        output = exports.join(format!("{stem}-graphics-{n}.mp4"));
        n += 1;
    }
    let encoders = encoder::available().await;
    let encoder_args = match encoders.first() {
        Some(enc) => encoder::encoder_args(&enc.id, info.width, info.height, 30),
        None => vec!["-c:v".into(), "libx264".into(), "-preset".into(), "medium".into(), "-crf".into(), "20".into(), "-pix_fmt".into(), "yuv420p".into()],
    };
    let filters_joined = drawn.filters.join(",");
    let out = run_blocking(move || {
        let mut cmd = command(Tool::Ffmpeg).map_err(|e| AppError::new("The video engine (FFmpeg) is missing or could not start.", e))?;
        cmd.args(["-hide_banner", "-y", "-loglevel", "error", "-i"]).arg(&canonical).args(["-vf", &filters_joined]).args(&encoder_args).args(["-c:a", "copy"]).arg(&output);
        let result = cmd.output().map_err(|e| AppError::new("The video engine (FFmpeg) could not start.", e.to_string()))?;
        if !result.status.success() {
            return Err(AppError::new("The graphic overlay failed.", String::from_utf8_lossy(&result.stderr).chars().take(600).collect()));
        }
        Ok::<_, AppError>(output)
    }).await?;
    crate::logging::info("graphics", &format!("Overlay saved: {} ({} filters, skipped: {})", out.display(), drawn.filters.len(), drawn.skipped.join(", ")));
    Ok(crate::graphics::draw::DrawResult { filters: drawn.filters, skipped: drawn.skipped, plan: drawn.plan })
}
