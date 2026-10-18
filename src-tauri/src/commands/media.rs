use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::api::gemini;
use crate::audio::paths::resolve;
use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::commands::projects::project_folder;
use crate::jobs::{event_sink, Job, JobRegistry};
use crate::keys::{self, Provider};
use crate::media::matching::{self, FileMatch, MatchScene};
use crate::media::probe::{probe, MediaInfo};
use crate::media::{expand, kind_of, names, thumbs, Kind};
use crate::settings;

const PARALLEL: usize = 4;
const MATCH_BATCH: usize = 6;
const MATCH_WIDTH: u32 = 512;
const MATCH_FRAMES: u32 = 3;

fn modified_seconds(path: &Path) -> f64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0.0, |d| d.as_secs_f64())
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMedia {
    pub path: String,
    pub name: String,
    pub kind: Kind,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub modified: f64,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedFile {
    pub name: String,
    pub reason: String,
    pub details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub files: Vec<SourceMedia>,
    pub skipped: Vec<SkippedFile>,
}

/// Reads FFprobe info for many files, a few at a time, in the order given.
async fn probe_all(job: &Job, files: Vec<PathBuf>, label: &str) -> Result<Vec<(PathBuf, Result<MediaInfo, AppError>)>, AppError> {
    let total = files.len().max(1);
    let gate = Arc::new(Semaphore::new(PARALLEL));
    let mut set = JoinSet::new();
    for (index, path) in files.into_iter().enumerate() {
        let gate = gate.clone();
        set.spawn(async move {
            let _permit = gate.acquire().await;
            let result = probe(&path).await;
            (index, path, result)
        });
    }
    let mut done = Vec::new();
    while !set.is_empty() {
        tokio::select! {
            () = job.cancelled() => {
                set.abort_all();
                return Err(AppError::cancelled());
            }
            joined = set.join_next() => {
                if let Some(Ok(item)) = joined {
                    done.push(item);
                    job.progress(label, done.len() as f64 / total as f64 * 100.0);
                }
            }
        }
    }
    done.sort_by_key(|(index, _, _)| *index);
    Ok(done.into_iter().map(|(_, path, result)| (path, result)).collect())
}

/// Finds the pictures and clips in dropped files and folders and reads their size and length.
/// Nothing is copied or changed.
#[tauri::command]
pub async fn scan_media(app: AppHandle, jobs: State<'_, JobRegistry>, paths: Vec<String>, job_id: String) -> Result<ScanResult, AppError> {
    let job = jobs.begin(&job_id, "media", event_sink(app))?;
    job.progress("Looking at the files", 0.0);
    let (found, unsupported) = run_blocking(move || Ok(expand::expand(&paths))).await?;
    let mut skipped: Vec<SkippedFile> = unsupported
        .iter()
        .map(|p| SkippedFile { name: file_name(p), reason: "Not a picture or clip I can use (png, jpg, jpeg, webp, mp4, mov, webm).".into(), details: p.display().to_string() })
        .collect();
    let probed = probe_all(&job, found, "Reading the files").await?;
    let mut files = Vec::new();
    for (path, result) in probed {
        match result {
            Ok(info) => files.push(SourceMedia {
                name: file_name(&path),
                kind: info.kind,
                width: info.width,
                height: info.height,
                duration: info.duration,
                modified: modified_seconds(&path),
                size: std::fs::metadata(&path).map_or(0, |m| m.len()),
                path: path.to_string_lossy().into_owned(),
            }),
            Err(error) => skipped.push(SkippedFile { name: file_name(&path), reason: error.message, details: error.details }),
        }
    }
    Ok(ScanResult { files, skipped })
}

#[derive(Debug, Deserialize)]
pub struct ImportItem {
    pub source: String,
    /// The name to give the copy (Bulk Rename). Leave out to keep the original name.
    pub name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedMedia {
    pub source: String,
    pub name: String,
    /// Inside the project, e.g. `media/S01_000.0-005.1.png`.
    pub path: String,
    pub kind: Kind,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub modified: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: Vec<ImportedMedia>,
    pub failed: Vec<SkippedFile>,
}

/// Copies files into the project's `media` folder (under the given names), so the originals are never touched.
#[tauri::command]
pub async fn import_media(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    project_id: String,
    items: Vec<ImportItem>,
    job_id: String,
) -> Result<ImportResult, AppError> {
    let project_dir = project_folder(&app, &project_id)?;
    let job = jobs.begin(&job_id, "media", event_sink(app))?;
    let media_dir = project_dir.join("media");
    std::fs::create_dir_all(&media_dir).map_err(|e| AppError::new("The media folder could not be created.", e.to_string()))?;
    let total = items.len().max(1);
    let mut imported = Vec::new();
    let mut failed = Vec::new();
    for (index, item) in items.into_iter().enumerate() {
        job.check()?;
        job.progress("Copying into the project", index as f64 / total as f64 * 100.0);
        let source = PathBuf::from(&item.source);
        let fail = |reason: &str, details: String| SkippedFile { name: file_name(&source), reason: reason.to_string(), details };
        let Some(kind) = kind_of(&source) else {
            failed.push(fail("This file type is not supported.", item.source.clone()));
            continue;
        };
        let wanted = item.name.as_deref().and_then(names::safe_file_name).or_else(|| names::safe_file_name(&file_name(&source)));
        let Some(wanted) = wanted else {
            failed.push(fail("The file name cannot be used.", item.source.clone()));
            continue;
        };
        if kind_of(Path::new(&wanted)) != Some(kind) {
            failed.push(fail("The new name must keep the same kind of file (picture or clip).", wanted));
            continue;
        }
        // A file that is already inside the media folder is used as it is.
        let inside = source.parent().and_then(|p| p.canonicalize().ok()).zip(media_dir.canonicalize().ok()).is_some_and(|(a, b)| a == b);
        let (target_name, target) = if inside {
            (file_name(&source), source.clone())
        } else {
            let same_size = |p: &Path| std::fs::metadata(p).ok().zip(std::fs::metadata(&source).ok()).is_some_and(|(a, b)| a.len() == b.len());
            let existing = media_dir.join(&wanted);
            // The same name and size means it was imported before: reuse it. Otherwise never overwrite.
            let name = if existing.is_file() && same_size(&existing) { wanted.clone() } else { names::unique_name(&media_dir, &wanted) };
            (name.clone(), media_dir.join(name))
        };
        if !inside && !target.is_file() {
            if let Err(error) = tokio::fs::copy(&source, &target).await {
                failed.push(fail("The file could not be copied into the project.", format!("{error} ({})", target.display())));
                continue;
            }
        }
        match probe(&target).await {
            Ok(info) => imported.push(ImportedMedia {
                source: item.source.clone(),
                path: format!("media/{target_name}"),
                name: target_name,
                kind: info.kind,
                width: info.width,
                height: info.height,
                duration: info.duration,
                modified: modified_seconds(&source),
            }),
            Err(error) => {
                if !inside {
                    let _ = std::fs::remove_file(&target);
                }
                failed.push(fail(&error.message, error.details));
            }
        }
    }
    job.progress("Done", 100.0);
    Ok(ImportResult { imported, failed })
}

#[derive(Debug, Deserialize)]
pub struct ThumbItem {
    pub path: String,
    pub kind: Kind,
    pub duration: f64,
}

#[derive(Debug, Serialize)]
pub struct ThumbResult {
    pub path: String,
    /// Project-relative thumbnail files; empty when one could not be made.
    pub thumbs: Vec<String>,
}

/// Makes (or finds, when already made) the thumbnails of one file.
async fn thumbnails_of(project_dir: &Path, item: &ThumbItem, width: u32, frames: u32) -> Vec<String> {
    let source = match resolve(project_dir, &item.path) {
        Ok(path) => path,
        Err(_) => return Vec::new(),
    };
    let name = file_name(&source);
    let count = if item.kind == Kind::Video { frames.max(1) } else { 1 };
    let times = if item.kind == Kind::Video { thumbs::frame_times(item.duration, count) } else { vec![0.0] };
    let source_time = modified_seconds(&source);
    let mut made = Vec::new();
    for (index, at) in times.iter().enumerate() {
        let relative = thumbs::thumb_path(&name, width, index as u32);
        let out = project_dir.join(&relative);
        let fresh = out.is_file() && modified_seconds(&out) >= source_time;
        if fresh || thumbs::make(&source, item.kind, *at, width, &out).await.is_ok() {
            made.push(relative);
        }
    }
    made
}

/// Small preview pictures of imported files. Pictures that are already made are reused.
#[tauri::command]
pub async fn make_thumbnails(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    project_id: String,
    items: Vec<ThumbItem>,
    width: u32,
    frames: u32,
    job_id: String,
) -> Result<Vec<ThumbResult>, AppError> {
    let project_dir = project_folder(&app, &project_id)?;
    let job = jobs.begin(&job_id, "media", event_sink(app))?;
    let width = width.clamp(64, 1024);
    let total = items.len().max(1);
    let gate = Arc::new(Semaphore::new(PARALLEL));
    let mut set = JoinSet::new();
    for (index, item) in items.into_iter().enumerate() {
        let gate = gate.clone();
        let dir = project_dir.clone();
        set.spawn(async move {
            let _permit = gate.acquire().await;
            let thumbs = thumbnails_of(&dir, &item, width, frames).await;
            (index, ThumbResult { path: item.path, thumbs })
        });
    }
    let mut done = Vec::new();
    while !set.is_empty() {
        tokio::select! {
            () = job.cancelled() => {
                set.abort_all();
                return Err(AppError::cancelled());
            }
            joined = set.join_next() => {
                if let Some(Ok(item)) = joined {
                    done.push(item);
                    job.progress("Making preview pictures", done.len() as f64 / total as f64 * 100.0);
                }
            }
        }
    }
    done.sort_by_key(|(index, _)| *index);
    Ok(done.into_iter().map(|(_, result)| result).collect())
}

/// For each project file: does it still exist? (Used to catch files that were deleted from the folder.)
#[tauri::command]
pub async fn check_media(app: AppHandle, project_id: String, paths: Vec<String>) -> Result<Vec<bool>, AppError> {
    let dir = project_folder(&app, &project_id)?;
    run_blocking(move || Ok(paths.iter().map(|p| resolve(&dir, p).is_ok_and(|f| f.is_file())).collect())).await
}

/// Deletes copies from the project's media folder (never the user's originals).
#[tauri::command]
pub async fn remove_media(app: AppHandle, project_id: String, paths: Vec<String>) -> Result<(), AppError> {
    let dir = project_folder(&app, &project_id)?;
    run_blocking(move || {
        for path in paths {
            if !path.starts_with("media/") {
                continue;
            }
            let file = resolve(&dir, &path)?;
            if file.is_file() {
                std::fs::remove_file(&file).map_err(|e| AppError::new("A file could not be removed from the project.", format!("{e} ({})", file.display())))?;
            }
        }
        Ok(())
    })
    .await
}

#[derive(Debug, Deserialize)]
pub struct MatchFile {
    pub name: String,
    pub path: String,
    pub kind: Kind,
    pub duration: f64,
}

/// Sends small pictures of unmatched files (three frames per clip) plus the scene texts to Gemini
/// and returns which file it thinks belongs to which scene.
#[tauri::command]
pub async fn match_media_with_gemini(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    project_id: String,
    files: Vec<MatchFile>,
    scenes: Vec<MatchScene>,
    job_id: String,
) -> Result<Vec<FileMatch>, AppError> {
    let project_dir = project_folder(&app, &project_id)?;
    let job = jobs.begin(&job_id, "media", event_sink(app.clone()))?;
    let app_for_settings = app.clone();
    let settings = run_blocking(move || settings::load(&app_for_settings)).await?;
    let key = run_blocking(|| keys::require(Provider::Gemini)).await?;
    if files.is_empty() || scenes.is_empty() {
        return Ok(Vec::new());
    }
    let scene_ids: Vec<String> = scenes.iter().map(|s| s.id.clone()).collect();
    let intro = matching::scene_list(&scenes);
    let batches: Vec<&[MatchFile]> = files.chunks(MATCH_BATCH).collect();
    let mut all: Vec<FileMatch> = Vec::new();

    for (number, batch) in batches.iter().enumerate() {
        job.check()?;
        job.progress(&format!("Asking Gemini (batch {} of {})", number + 1, batches.len()), number as f64 / batches.len() as f64 * 100.0);
        let mut parts = vec![serde_json::json!({ "text": intro })];
        for file in batch.iter() {
            let item = ThumbItem { path: file.path.clone(), kind: file.kind, duration: file.duration };
            let made = thumbnails_of(&project_dir, &item, MATCH_WIDTH, MATCH_FRAMES).await;
            if made.is_empty() {
                continue;
            }
            parts.push(serde_json::json!({ "text": format!("FILE: {}", file.name) }));
            for relative in made {
                if let Ok(bytes) = std::fs::read(project_dir.join(&relative)) {
                    parts.push(gemini::image_part("image/jpeg", &bytes));
                }
            }
        }
        let names: Vec<String> = batch.iter().map(|f| f.name.clone()).collect();
        let answer = tokio::select! {
            () = job.cancelled() => return Err(AppError::cancelled()),
            answer = gemini::generate_parts(&key, &settings.gemini_model, Some(matching::SYSTEM), parts, true) => answer,
        }?;
        let found = matching::parse_matches(&answer, &names, &scene_ids)
            .map_err(|details| AppError::new("Gemini's answer could not be understood. Please try again.", details))?;
        all.extend(found);
    }

    // Two files may want the same scene: the more confident one wins.
    all.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));
    let mut result: Vec<FileMatch> = Vec::new();
    for item in all {
        if !result.iter().any(|m| m.scene_id == item.scene_id || m.file == item.file) {
            result.push(item);
        }
    }
    job.progress("Done", 100.0);
    Ok(result)
}

/// The full path of the project folder, so pictures inside it can be shown (asset protocol).
#[tauri::command]
pub async fn project_dir_path(app: AppHandle, project_id: String) -> Result<String, AppError> {
    Ok(project_folder(&app, &project_id)?.to_string_lossy().into_owned())
}
