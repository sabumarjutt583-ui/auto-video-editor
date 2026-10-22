//! Commands for custom styles made from reference pictures: prepare the pictures, let an AI analyze them,
//! keep the style with its pictures, and move a style in and out as an `.avstyle` file.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::api::{gemini, openai};
use crate::commands::ai::chat_question;
use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::commands::styles::custom_dir;
use crate::custom_style::analyze::{self, Engine};
use crate::custom_style::package::{self, EXTENSION, MAX_FILE_BYTES};
use crate::custom_style::refs::{self, Meta, PreparedImage, StyleRefs, MAX_IMAGES, MIN_IMAGES};
use crate::custom_style::service;
use crate::ffmpeg::{command, Tool};
use crate::imagegen::chat::json_from_reply;
use crate::imagegen::ops::ImageGen;
use crate::jobs::{event_sink, JobRegistry};
use crate::keys::{self, Provider};
use crate::settings;
use crate::styles::{self, StyleProfile};

fn prep_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    // Inside the styles folder, so the pictures can be shown (the app may read that folder) and are never listed as styles.
    Ok(custom_dir(app)?.join("prep"))
}

fn ffmpeg() -> Result<tokio::process::Command, AppError> {
    command(Tool::Ffmpeg).map_err(|e| AppError::new("The video engine (FFmpeg) is missing or could not start.", e))
}

fn custom_id(id: &str) -> Result<(), AppError> {
    if id.starts_with(styles::CUSTOM_PREFIX) && styles::valid_id(id) {
        Ok(())
    } else {
        Err(AppError::new("Only your own styles can be changed this way.", format!("Not a custom style id: {id:?}")))
    }
}

/// Pictures the app prepared itself (in the working folder or in a style's own folder), nothing else.
fn trusted(app: &AppHandle, images: &[String]) -> Result<Vec<PathBuf>, AppError> {
    let prep = prep_dir(app)?;
    let own = refs::refs_root(&custom_dir(app)?);
    let mut paths = Vec::new();
    for image in images {
        let path = PathBuf::from(image);
        if !refs::is_inside(&prep, &path) && !refs::is_inside(&own, &path) {
            return Err(AppError::new("One of the pictures is not ready. Please add it again.", format!("not a prepared picture: {image}")));
        }
        paths.push(path);
    }
    Ok(paths)
}

/// Checks one picture the person chose and makes a shrunk JPEG copy (at most 1024 px) for the AI.
#[tauri::command]
pub async fn prepare_style_image(app: AppHandle, path: String) -> Result<PreparedImage, AppError> {
    refs::prepare(ffmpeg()?, Path::new(&path), &prep_dir(&app)?).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRequest {
    pub images: Vec<String>,
    pub name: String,
    pub description: String,
    pub engine: Engine,
    /// Set when asking again: the rules the earlier answer broke.
    #[serde(default)]
    pub problems: Vec<String>,
    /// The earlier answer (JSON text).
    #[serde(default)]
    pub previous: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeAnswer {
    /// A draft: id and category are empty, the version is 1.0.0.
    pub style: StyleProfile,
    /// The AI's JSON, to show it what to fix when asking again.
    pub raw: String,
}

/// Lets an AI study the reference pictures and write a style profile. Can be cancelled.
#[tauri::command]
pub async fn analyze_style(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    ig: State<'_, Arc<ImageGen>>,
    job_id: String,
    request: AnalyzeRequest,
) -> Result<AnalyzeAnswer, AppError> {
    let job = jobs.begin(&job_id, "style-analysis", event_sink(app.clone()))?;
    if !(MIN_IMAGES..=MAX_IMAGES).contains(&request.images.len()) {
        return Err(AppError::new(format!("Please add {MIN_IMAGES} or {MAX_IMAGES} reference pictures."), format!("{} pictures", request.images.len())));
    }
    let paths = trusted(&app, &request.images)?;
    let question = analyze::build_question(&request.name, &request.description, paths.len(), &request.problems, request.previous.as_deref());
    job.progress("Looking at the pictures", 10.0);

    let text = match request.engine {
        Engine::Chat => {
            job.progress("Asking Gemini in the web chat (this can take a minute)", 20.0);
            let prompt = chat_question(Some(analyze::SYSTEM), &format!("{question}\nThe reference pictures are attached to this message."), true);
            let reply = tokio::select! {
                () = job.cancelled() => return Err(AppError::cancelled()),
                reply = ig.chat_ask_images(&prompt, &paths) => reply?,
            };
            json_from_reply(&reply).unwrap_or(reply.text)
        }
        engine => {
            let bytes = run_blocking({
                let paths = paths.clone();
                move || {
                    paths.iter().map(|p| std::fs::read(p).map_err(|e| AppError::new("A reference picture could not be read.", format!("{e} ({})", p.display())))).collect::<Result<Vec<_>, _>>()
                }
            })
            .await?;
            let settings_app = app.clone();
            let settings = run_blocking(move || settings::load(&settings_app)).await?;
            if engine == Engine::Gemini {
                let key = run_blocking(|| keys::require(Provider::Gemini)).await?;
                job.progress("Asking Gemini", 20.0);
                let mut parts = vec![serde_json::json!({ "text": question })];
                parts.extend(bytes.iter().map(|b| gemini::image_part("image/jpeg", b)));
                tokio::select! {
                    () = job.cancelled() => return Err(AppError::cancelled()),
                    answer = gemini::generate_parts(&key, &settings.gemini_model, Some(analyze::SYSTEM), parts, true) => answer?,
                }
            } else {
                let key = run_blocking(|| keys::require(Provider::OpenAi)).await?;
                job.progress("Asking OpenAI", 20.0);
                let images: Vec<(&str, &[u8])> = bytes.iter().map(|b| ("image/jpeg", b.as_slice())).collect();
                tokio::select! {
                    () = job.cancelled() => return Err(AppError::cancelled()),
                    answer = openai::vision(&key, &settings.openai_model, Some(analyze::SYSTEM), &question, &images, true) => answer?,
                }
            }
        }
    };
    job.progress("Reading the answer", 95.0);
    let (style, raw) = analyze::parse_answer(&text, &request.name)?;
    Ok(AnalyzeAnswer { style, raw })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    pub style: StyleProfile,
    pub images: Vec<String>,
    pub description: String,
    /// "gemini", "openai" or "chat" (or "" for a style written by hand).
    pub engine: String,
}

/// Saves the style, keeps its reference pictures in its own folder and makes its thumbnail from the first picture.
#[tauri::command]
pub async fn save_style_with_refs(app: AppHandle, request: SaveRequest) -> Result<StyleProfile, AppError> {
    let custom = custom_dir(&app)?;
    custom_id(&request.style.id)?;
    let sources = trusted(&app, &request.images)?;
    let meta = Meta { description: request.description.trim().to_string(), engine: request.engine };
    service::save(&custom, request.style, sources, meta, &ffmpeg).await
}

/// The reference pictures and notes of a custom style (None for a style written by hand).
#[tauri::command]
pub async fn load_style_refs(app: AppHandle, id: String) -> Result<Option<StyleRefs>, AppError> {
    custom_id(&id)?;
    let custom = custom_dir(&app)?;
    run_blocking(move || Ok(refs::load(&custom, &id))).await
}

/// Saves `style` (already given a new id) as a copy of custom style `source_id`, with its pictures and thumbnail.
#[tauri::command]
pub async fn duplicate_custom_style(app: AppHandle, source_id: String, style: StyleProfile) -> Result<StyleProfile, AppError> {
    custom_id(&source_id)?;
    custom_id(&style.id)?;
    let custom = custom_dir(&app)?;
    run_blocking(move || {
        refs::copy(&custom, &source_id, &style.id)?;
        let from = custom.join(crate::thumbnails::rel_path(&source_id));
        if from.is_file() {
            let to = custom.join(crate::thumbnails::rel_path(&style.id));
            if let Some(parent) = to.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::copy(&from, &to);
        }
        styles::save_custom(&custom, style)
    })
    .await
}

/// Writes a custom style and its pictures into one `.avstyle` file. Returns the path that was written.
#[tauri::command]
pub async fn export_style_package(app: AppHandle, id: String, dest: String) -> Result<String, AppError> {
    let custom = custom_dir(&app)?;
    run_blocking(move || {
        let bytes = package::build(&custom, &id)?;
        let mut path = PathBuf::from(&dest);
        if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case(EXTENSION)) {
            path.set_extension(EXTENSION);
        }
        std::fs::write(&path, bytes).map_err(|e| AppError::new("The style file could not be saved.", format!("{e} ({})", path.display())))?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
}

/// Adds the style in an `.avstyle` file as a new custom style (it never replaces one: a taken id gets a new number).
#[tauri::command]
pub async fn import_style_package(app: AppHandle, path: String) -> Result<StyleProfile, AppError> {
    let custom = custom_dir(&app)?;
    let prep = prep_dir(&app)?;
    let size = std::fs::metadata(&path).map_err(|e| AppError::new("The style file could not be read.", format!("{e} ({path})")))?.len();
    if size > MAX_FILE_BYTES {
        return Err(AppError::new("This file is too big to be a style file.", format!("{size} bytes")));
    }
    let data = run_blocking({
        let path = path.clone();
        move || std::fs::read(&path).map_err(|e| AppError::new("The style file could not be read.", format!("{e} ({path})")))
    })
    .await?;
    service::import(&custom, &prep, &data, &ffmpeg).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_custom_ids_are_accepted() {
        assert!(custom_id("custom_a").is_ok());
        assert!(custom_id("noir").is_err());
        assert!(custom_id("custom_../x").is_err());
    }
}
