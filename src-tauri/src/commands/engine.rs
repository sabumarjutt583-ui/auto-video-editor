use crate::commands::error::AppError;
use crate::ffmpeg::{self, Tool};

/// Runs `ffmpeg -version` and returns the FFmpeg version string.
#[tauri::command]
pub async fn check_ffmpeg() -> Result<String, AppError> {
    let version = ffmpeg::version(Tool::Ffmpeg).await.map_err(engine_error)?;
    Ok(version)
}

fn engine_error(details: String) -> AppError {
    AppError::new(
        "The video engine (FFmpeg) is missing or could not start.",
        details,
    )
}
