//! Commands of the Image Generator page. Heavy work (browsers, saving) runs in Rust;
//! the page only sends scenes and shows the state it receives as `imagegen-state` events.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::error::AppError;
use crate::commands::library::library_root;
use crate::commands::projects::project_folder;
use crate::imagegen::accounts::VideoSource;
use crate::imagegen::browser::locator;
use crate::imagegen::config::EngineConfig;
use crate::imagegen::engine::{Sink, Snapshot};
use crate::imagegen::mapping::{check_free_jobs, check_jobs};
use crate::imagegen::ops::{ImageGen, TestImage};
use crate::imagegen::queue::{AddReport, NewJob};
use crate::imagegen::settings::ImageGenSettings;
use crate::library::manifest::Kind;
use crate::library::store;

pub type Ig<'a> = State<'a, Arc<ImageGen>>;

struct AppSink(AppHandle);

impl Sink for AppSink {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        let _ = self.0.emit(event, payload);
    }
}

/// The folder with the settings file that ships with the app.
pub fn bundled_image_engine_dir(app: &AppHandle) -> PathBuf {
    if let Ok(resources) = app.path().resource_dir() {
        let bundled = resources.join("resources").join("image-engine");
        if bundled.is_dir() {
            return bundled;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("resources").join("image-engine")
}

/// The engine settings in use: a downloaded package when it is newer than the built-in one.
pub fn load_engine_config(app: &AppHandle) -> EngineConfig {
    let bundled = bundled_image_engine_dir(app);
    if let Ok(root) = library_root(app) {
        let active = store::active_dir(&root, Kind::ImageEngine, &bundled);
        if let Ok(text) = std::fs::read_to_string(active.join("config.json")) {
            if let Ok(config) = EngineConfig::parse(&text) {
                return config;
            }
        }
    }
    EngineConfig::bundled()
}

/// Creates the engine and starts its background work. Called once at start-up.
pub fn create(app: &AppHandle) -> Result<Arc<ImageGen>, AppError> {
    let dir = app.path().app_data_dir().map_err(|e| AppError::new("The app data folder could not be found.", e.to_string()))?.join("imagegen");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::new("The image generator folder could not be created.", e.to_string()))?;
    Ok(ImageGen::new(dir, Arc::new(AppSink(app.clone())), load_engine_config(app)))
}

/// Brings the engine settings up to date after a library update.
pub async fn reload_config(app: &AppHandle, ig: &Arc<ImageGen>) {
    let config = load_engine_config(app);
    if config != *ig.engine.config() {
        ig.set_config(config).await;
    }
}

#[tauri::command]
pub async fn imagegen_state(ig: Ig<'_>) -> Result<Snapshot, AppError> {
    Ok(ig.engine.snapshot())
}

#[tauri::command]
pub async fn imagegen_set_settings(ig: Ig<'_>, settings: ImageGenSettings) -> Result<(), AppError> {
    ig.set_settings(settings).await
}

#[tauri::command]
pub async fn imagegen_accept_consent(ig: Ig<'_>) -> Result<(), AppError> {
    ig.engine.accept_consent()
}

#[tauri::command]
pub async fn imagegen_detect_browser(ig: Ig<'_>) -> Result<Option<String>, AppError> {
    let chosen = ig.engine.settings().browser_path;
    Ok(locator::find(Some(&chosen)).map(|p| p.display().to_string()))
}

#[tauri::command]
pub async fn imagegen_add_account(ig: Ig<'_>, name: String) -> Result<String, AppError> {
    Ok(ig.add_account(&name))
}

#[tauri::command]
pub async fn imagegen_update_account(ig: Ig<'_>, id: String, name: Option<String>, enabled: Option<bool>) -> Result<(), AppError> {
    if ig.engine.with_accounts(|accounts, _| accounts.update(&id, name.as_deref(), enabled)) {
        Ok(())
    } else {
        Err(AppError::new("That account does not exist any more.", id))
    }
}

#[tauri::command]
pub async fn imagegen_remove_account(ig: Ig<'_>, id: String) -> Result<(), AppError> {
    ig.remove_account(&id).await
}

#[tauri::command]
pub async fn imagegen_sign_in(ig: Ig<'_>, id: String) -> Result<(), AppError> {
    ig.sign_in(&id).await
}

#[tauri::command]
pub async fn imagegen_finish_sign_in(ig: Ig<'_>, id: String) -> Result<(), AppError> {
    ig.finish_sign_in(&id);
    Ok(())
}

#[tauri::command]
pub async fn imagegen_verify(ig: Ig<'_>, id: String) -> Result<(), AppError> {
    ig.verify(&id).await
}

/// The finished answer of a chat question.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAnswer {
    pub text: String,
    pub code: Vec<String>,
}

/// Asks Gemini's chat one question through the Google accounts (no API key, no quota of the API).
#[tauri::command]
pub async fn imagegen_chat_ask(ig: Ig<'_>, prompt: String) -> Result<ChatAnswer, AppError> {
    let reply = ig.chat_ask(&prompt).await?;
    Ok(ChatAnswer { text: reply.text, code: reply.code })
}

/// A video made from a scene.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoResult {
    /// Project-relative path, e.g. `media/S01_000.0-005.1.mp4`.
    pub path: String,
    pub account_name: String,
    pub width: u32,
    pub height: u32,
    /// Seconds.
    pub duration: f64,
    /// Seconds since 1970 (file change time).
    pub modified: u64,
}

fn plain_media_name(name: &str) -> bool {
    !name.is_empty() && !name.contains(['/', '\\']) && !name.starts_with('.') && name.len() < 120
}

/// Makes one video from a prompt (and, when `image` is given, from that picture of the project's `media` folder) with
/// the next Google account that still has videos, and saves it in `media` under `file_name` (an `.mp4` name; an
/// existing different file is never overwritten). Progress and Cancel go through the job `job_id`; Cancel is only
/// looked at before the video starts, never in the middle of it.
#[tauri::command]
pub async fn imagegen_make_video(
    app: tauri::AppHandle,
    jobs: tauri::State<'_, crate::jobs::JobRegistry>,
    ig: Ig<'_>,
    project_id: String,
    prompt: String,
    image: Option<String>,
    file_name: String,
    job_id: String,
    source: Option<String>,
) -> Result<VideoResult, AppError> {
    if !plain_media_name(&file_name) || !file_name.to_lowercase().ends_with(".mp4") {
        return Err(AppError::new("That video file name cannot be used.", format!("file name: {file_name}")));
    }
    let dir = project_folder(&app, &project_id)?;
    let media = dir.join("media");
    let picture = match image.as_deref() {
        None => None,
        Some(relative) => {
            let name = relative.strip_prefix("media/").filter(|n| plain_media_name(n));
            let path = name.map(|n| media.join(n)).filter(|p| p.is_file());
            Some(path.ok_or_else(|| AppError::new("The picture of this scene could not be found.", format!("image: {relative}")))?)
        }
    };
    let job = jobs.begin(&job_id, "video", crate::jobs::event_sink(app))?;
    if job.is_cancelled() {
        return Err(AppError::cancelled());
    }
    let report = |msg: String| job.progress(&msg, 30.0);
    // The old one-video-at-a-time Flow project engine is no longer
    // offered anywhere in the UI: Batch Flow Studio has taken Flow's
    // place (see `flow_batch_run`). A stored "flow"/"auto" choice that
    // still reaches this command is refused with a pointer to it,
    // rather than silently running the deprecated engine.
    if matches!(source.as_deref(), Some("flow") | Some("auto")) {
        return Err(AppError::new(
            "Google Flow (one video at a time) is no longer offered. Use Batch Flow Studio in the Videos section instead: it sends all scenes as one batch and renames the downloads by scene number.",
            "flow deprecated",
        ));
    }
    let made = ig.make_video(VideoSource::Gemini, &prompt, picture.as_deref(), Some(&report)).await?;
    let account_name = made.account_name.clone();
    let name = crate::commands::blocking::run_blocking(move || -> Result<String, AppError> {
        std::fs::create_dir_all(&media).map_err(|e| AppError::new("The media folder could not be made.", e.to_string()))?;
        let name = crate::imagegen::queue::unique_target(&file_name, &|candidate| media.join(candidate).exists());
        crate::imagegen::store::write_durable(&media.join(&name), &made.bytes).map_err(|e| AppError::new("The video could not be saved in the project's media folder.", e.to_string()))?;
        Ok(name)
    })
    .await?;
    // The size and length are read from the saved file; a file that cannot be read still counts (the Auto Editor reads it again).
    let file = dir.join("media").join(&name);
    let modified = std::fs::metadata(&file).ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
    let info = match crate::probe::probe_text(&file, "The new video could not be read.").await {
        Ok(text) => crate::probe::parse_info(&text),
        Err(_) => crate::probe::ProbeInfo::default(),
    };
    let video = info.first(crate::probe::StreamKind::Video);
    Ok(VideoResult { path: format!("media/{name}"), account_name, width: video.map_or(0, |v| v.width), height: video.map_or(0, |v| v.height), duration: info.duration.unwrap_or(0.0), modified })
}

/// How many Google accounts can make a video now, and when the resting ones are back.
/// (Only Gemini is offered in the UI now; a "flow" value here only
/// answers for old stored choices and must not be used for new runs.)
#[tauri::command]
pub async fn imagegen_video_status(ig: Ig<'_>, source: Option<String>) -> Result<crate::imagegen::ops::VideoStatus, AppError> {
    Ok(ig.video_status(if source.as_deref() == Some("flow") { VideoSource::Flow } else { VideoSource::Gemini }))
}

#[tauri::command]
pub async fn imagegen_test_image(ig: Ig<'_>, id: String) -> Result<TestImage, AppError> {
    ig.test_image(&id).await
}

#[tauri::command]
pub async fn imagegen_background_snapshot(ig: Ig<'_>, id: String) -> Result<Option<String>, AppError> {
    Ok(ig.background_snapshot(&id).await)
}

#[tauri::command]
pub async fn imagegen_show_browser(ig: Ig<'_>, id: String) -> Result<bool, AppError> {
    Ok(ig.show_background_browser(&id).await)
}

/// Queues one picture per scene. `start` = begin working at once. `force` = make a new picture for
/// scenes that already have one.
#[tauri::command]
pub async fn imagegen_start(app: AppHandle, ig: Ig<'_>, project_id: String, jobs: Vec<NewJob>, force: bool, start: bool) -> Result<AddReport, AppError> {
    // An empty list only opens the project's queue (the page does that when it is shown).
    let jobs = if jobs.is_empty() { jobs } else { check_jobs(jobs)? };
    let dir = project_folder(&app, &project_id)?;
    let engine = ig.engine.clone();
    crate::commands::blocking::run_blocking(move || engine.start(&dir, jobs, force, start)).await
}

/// A folder the person picked for "Only images": it must exist and be a real folder.
fn checked_folder(folder: &str) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(folder.trim());
    if !path.is_absolute() || !path.is_dir() {
        return Err(AppError::new("Please choose a folder that exists on this computer.", format!("not a folder: {folder}")));
    }
    Ok(path)
}

/// "Only images": prompts typed or pasted by the person, saved in `<folder>/media`. Same queue, accounts and
/// crash safety as the scene pictures. An empty list only opens the folder's queue.
#[tauri::command]
pub async fn imagegen_start_folder(ig: Ig<'_>, folder: String, jobs: Vec<NewJob>, force: bool, start: bool) -> Result<AddReport, AppError> {
    let jobs = if jobs.is_empty() { jobs } else { check_free_jobs(jobs)? };
    let dir = checked_folder(&folder)?;
    let engine = ig.engine.clone();
    crate::commands::blocking::run_blocking(move || engine.start(&dir, jobs, force, start)).await
}

/// A small preview (WebP, as a data address) of a picture in the folder that the queue is working on.
/// Only files of the open queue's `media` folder can be read, so the page cannot ask for other files.
#[tauri::command]
pub async fn imagegen_preview(ig: Ig<'_>, folder: String, path: String, width: u32) -> Result<Option<String>, AppError> {
    let plain = path.strip_prefix("media/").is_some_and(|name| !name.is_empty() && !name.contains(['/', '\\']) && !name.starts_with('.'));
    let current = ig.engine.snapshot().project_dir;
    if !plain || current.as_deref() != Some(folder.trim()) {
        return Ok(None);
    }
    let file = PathBuf::from(folder.trim()).join(&path);
    if !file.is_file() {
        return Ok(None);
    }
    let mut command = crate::ffmpeg::command(crate::ffmpeg::Tool::Ffmpeg).map_err(|e| AppError::new("The video engine (FFmpeg) is missing or could not start.", e))?;
    command
        .args(["-hide_banner", "-nostdin", "-v", "error", "-i"])
        .arg(&file)
        .args(["-vf", &format!("scale={}:-2", width.clamp(64, 640)), "-frames:v", "1", "-c:v", "libwebp", "-quality", "70", "-f", "webp", "pipe:1"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    let output = command.output().await.map_err(|e| AppError::new("A preview picture could not be made.", e.to_string()))?;
    if !output.status.success() || output.stdout.is_empty() {
        return Ok(None);
    }
    Ok(Some(format!("data:image/webp;base64,{}", crate::api::base64::encode(&output.stdout))))
}

#[tauri::command]
pub async fn imagegen_pause(ig: Ig<'_>) -> Result<(), AppError> {
    ig.engine.pause();
    Ok(())
}

#[tauri::command]
pub async fn imagegen_resume(ig: Ig<'_>) -> Result<(), AppError> {
    ig.engine.resume();
    Ok(())
}

#[tauri::command]
pub async fn imagegen_retry_failed(ig: Ig<'_>, ids: Vec<String>) -> Result<usize, AppError> {
    Ok(ig.engine.retry_failed(&ids))
}

#[tauri::command]
pub async fn imagegen_remove_jobs(ig: Ig<'_>, ids: Vec<String>) -> Result<usize, AppError> {
    Ok(ig.engine.remove_jobs(&ids))
}

/// One picture to delete: the job id (scene id) and its saved file, if there is one.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteItem {
    pub id: String,
    pub file: Option<String>,
}

/// Deletes pictures: the files go to the Recycle Bin / Trash and their queue entries are removed (so they are not made or
/// saved again, also after a restart). `project_id` for Project scenes, `folder` for Only images. A file that could not be
/// moved keeps its queue entry.
#[tauri::command]
pub async fn imagegen_delete_images(
    app: AppHandle,
    ig: Ig<'_>,
    project_id: Option<String>,
    folder: Option<String>,
    items: Vec<DeleteItem>,
) -> Result<crate::imagegen::delete::DeleteReport, AppError> {
    let dir = match (project_id, folder) {
        (Some(id), _) => project_folder(&app, &id)?,
        (None, Some(folder)) => checked_folder(&folder)?,
        (None, None) => return Err(AppError::new("Nothing to delete.", "no project or folder")),
    };
    let files: Vec<String> = items.iter().filter_map(|i| i.file.clone()).collect();
    let report = crate::commands::blocking::run_blocking({
        let dir = dir.clone();
        move || Ok(crate::imagegen::delete::trash_pictures(&dir, &files, &crate::imagegen::delete::SystemTrash))
    })
    .await?;
    let gone = |file: &String| report.trashed.contains(file) || report.missing.contains(file);
    let ids: Vec<String> = items.iter().filter(|i| i.file.as_ref().map_or(true, gone)).map(|i| i.id.clone()).collect();
    let engine = ig.engine.clone();
    crate::commands::blocking::run_blocking(move || Ok(engine.delete_jobs(&ids))).await?;
    Ok(report)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub path: String,
    pub name: String,
    pub kind: &'static str,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub modified: u64,
}

/// Size and date of pictures the generator saved (`None` for a file that is not there). Used to put
/// pictures into the Auto Editor when the page missed the "picture saved" event (for example after a restart).
#[tauri::command]
pub async fn imagegen_media_info(app: AppHandle, project_id: String, paths: Vec<String>) -> Result<Vec<Option<MediaInfo>>, AppError> {
    let dir = project_folder(&app, &project_id)?;
    crate::commands::blocking::run_blocking(move || {
        use std::io::Read;
        Ok(paths
            .iter()
            .map(|relative| {
                let plain = relative.strip_prefix("media/").is_some_and(|name| !name.is_empty() && !name.contains(['/', '\\']) && !name.starts_with('.'));
                if !plain {
                    return None;
                }
                let path = dir.join(relative);
                let meta = std::fs::metadata(&path).ok().filter(|m| m.is_file() && m.len() > 0)?;
                let mut head = vec![0u8; 256];
                let read = std::fs::File::open(&path).and_then(|mut f| f.read(&mut head)).unwrap_or(0);
                let (width, height) = crate::imagegen::save::png_size(&head[..read]).unwrap_or((0, 0));
                let modified = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
                Some(MediaInfo { path: relative.clone(), name: relative.trim_start_matches("media/").to_string(), kind: "image", width, height, duration: 0.0, modified })
            })
            .collect())
    })
    .await
}

/// Re-reads the engine settings (after "Check for updates" in Settings).
#[tauri::command]
pub async fn imagegen_reload_config(app: AppHandle, ig: Ig<'_>) -> Result<String, AppError> {
    reload_config(&app, ig.inner()).await;
    Ok(ig.engine.config().config_version.clone())
}
