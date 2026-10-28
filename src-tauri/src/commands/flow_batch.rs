//! Commands for Batch Flow Studio (the shared tool link only).
//!
//! These commands prepare, run and rename a batch; they do not sign
//! the user in, bypass a captcha/limit, or spend credits beyond the
//! guard. The browser run (`flow_batch_run`) reuses the Image
//! Generator's Google-account browser through the worker's `batch_tab`
//! (a new tab of the account's own session — a profile can be open
//! only once, so no second browser is launched on it): it opens the
//! shared tool link, fills the Batch Prompt Box with the paragraph
//! text, sets Generation Type (Images or Videos) and the chosen model
//! (Images: Nano Banana 2.1, 16:9; Videos: Omni 1.1 Flash by default,
//! Text to Video, duration/resolution chosen by the user), clicks
//! Generate All as Images / Generate All as Videos, polls the Batch
//! Media Queue (Batch Size 8) until cards are Ready, and downloads
//! per card in card order via its "Download Sxx.png" / "Download
//! Sxx.mp4" button (Download All only in batch order). The selectors
//! for that run live in `FlowBatchConfig` (config.json `flowBatch`
//! block); the paragraph format, queue counters and card names were
//! verified in a live manual 20-image test, but the automated loop
//! itself has NOT been live-run, so a page change is fixed by a
//! config update, not a new app version.
//!
//! The rename step is wired twice: the run loop renames every
//! download it saves (the download-completion step), and
//! `flow_batch_rename` is also a real panel action ("Rename one Flow
//! file") for files downloaded by hand. A Flow file arrives as
//! `S01.png` / `S01.mp4`, and the timecode name comes from the
//! project scene record (`S01_000.0-008.0.png` / `.mp4`). Saving uses
//! `queue::unique_target`, so a taken name becomes `(2)`, `(3)`, ...
//! A file whose name does not parse to the scene it is claimed for is
//! refused with a clear error — the tool never guesses a scene.

use serde::{Deserialize, Serialize};

use crate::commands::error::AppError;
use crate::imagegen::accounts::AccountStatus;
use crate::imagegen::config::{EngineConfig, FlowBatchConfig};
use crate::imagegen::engine::now_ms;
use crate::imagegen::flow_batch::{self, GenerationType, VideoModel};
use crate::imagegen::flow_batch_run::{self, RunRequest};
use crate::imagegen::ops::ImageGen;
use crate::imagegen::queue::{unique_target, NewJob};

/// What the frontend shows before it opens the Batch tool: the shared link
/// (never an old Flow project link), the defaults, and the credit guard.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowBatchInfo {
    pub url: String,
    pub images_model: String,
    pub videos_model: String,
    pub video_model_options: Vec<String>,
    pub video_duration_options: Vec<String>,
    pub aspect: String,
    pub video_seconds: u32,
    pub video_resolution: String,
    pub video_credits_per_video: u32,
    pub max_credits_per_video: u32,
    pub batch_size: u32,
}

impl From<FlowBatchConfig> for FlowBatchInfo {
    fn from(cfg: FlowBatchConfig) -> Self {
        Self {
            url: cfg.url,
            images_model: cfg.images_model,
            videos_model: cfg.videos_model,
            video_model_options: cfg.video_model_options,
            video_duration_options: cfg.video_duration_options,
            aspect: cfg.aspect,
            video_seconds: cfg.video_seconds,
            video_resolution: cfg.video_resolution,
            video_credits_per_video: cfg.video_credits_per_video,
            max_credits_per_video: cfg.max_credits_per_video,
            batch_size: cfg.batch_size,
        }
    }
}

#[tauri::command]
pub fn flow_batch_config() -> FlowBatchInfo {
    EngineConfig::bundled().flow_batch.into()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowBatchPrepareRequest {
    pub jobs: Vec<NewJob>,
    /// "images" or "videos".
    pub generation_type: String,
    /// Video model, e.g. "Omni 1.1 Flash" (absent = config default).
    pub video_model: Option<String>,
    pub video_seconds: Option<u32>,
    pub video_resolution: Option<String>,
    pub max_credits_per_video: Option<u32>,
}

/// Resolves the video choice for prepare/run: explicit values win,
/// otherwise the config defaults. Unknown model names are refused —
/// a cost must never be guessed.
fn resolve_video_choice(
    cfg: &FlowBatchConfig,
    video_model: Option<String>,
    video_seconds: Option<u32>,
    video_resolution: Option<String>,
    max_credits_per_video: Option<u32>,
) -> Result<(VideoModel, u32, String, u32), AppError> {
    let model = match video_model.as_deref() {
        Some(name) => VideoModel::from_display(name).ok_or_else(|| {
            AppError::new(
                format!("\"{name}\" is not a Batch Flow Studio video model."),
                "flow_batch_model",
            )
        })?,
        None => VideoModel::from_display(&cfg.videos_model).unwrap_or(VideoModel::OmniFlash),
    };
    Ok((
        model,
        video_seconds.unwrap_or(cfg.video_seconds),
        video_resolution.unwrap_or_else(|| cfg.video_resolution.clone()),
        max_credits_per_video.unwrap_or(cfg.max_credits_per_video),
    ))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowBatchRenamePreview {
    /// As downloaded from the Batch tool: `S01.png` / `S01.mp4`.
    pub flow_name: String,
    /// As saved by the Auto Editor: `S01_000.0-008.0.png` / `.mp4`.
    pub timecode_name: String,
    pub scene_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowBatchPrepared {
    /// Paragraph text for the Batch Prompt Box: one paragraph per prompt,
    /// exactly one blank line between prompts.
    pub text: String,
    pub paragraph_count: usize,
    pub scene_ids: Vec<String>,
    pub estimated_credits: u32,
    pub per_video_credits: u32,
    pub max_credits_per_video: u32,
    pub rename_preview: Vec<FlowBatchRenamePreview>,
}

fn generation_of(value: &str) -> Result<GenerationType, AppError> {
    match value {
        "images" => Ok(GenerationType::Images),
        "videos" => Ok(GenerationType::Videos),
        other => Err(AppError::new(
            "Batch Flow Studio needs Images or Videos, nothing else.",
            format!("generation_type {other:?}"),
        )),
    }
}

/// Validates the jobs (scene id must match the timecode file name with
/// the generation's own extension — `.png` for images, `.mp4` for
/// videos — prompt non-empty, aspect valid, no duplicate scene id,
/// whole list refused if one entry is bad), formats the prompts as
/// paragraphs, checks the credit guard for videos using the live
/// model + duration table, and returns the rename preview. Nothing is
/// sent to Flow by this command.
#[tauri::command]
pub fn flow_batch_prepare(request: FlowBatchPrepareRequest) -> Result<FlowBatchPrepared, AppError> {
    let generation = generation_of(&request.generation_type)?;
    let cfg = EngineConfig::bundled().flow_batch;
    let (model, seconds, resolution, cap) = resolve_video_choice(
        &cfg,
        request.video_model,
        request.video_seconds,
        request.video_resolution,
        request.max_credits_per_video,
    )?;
    let tuples: Vec<(String, String, String, String)> = request
        .jobs
        .iter()
        .map(|j| (j.scene_id.clone(), j.file_name.clone(), j.prompt.clone(), j.aspect.clone()))
        .collect();
    flow_batch::check_flow_batch_jobs(&tuples, generation)
        .map_err(|message| AppError::new(message, "flow_batch_jobs"))?;
    let jobs = request.jobs;
    let prompts: Vec<String> = jobs.iter().map(|job| job.prompt.clone()).collect();
    let text = flow_batch::format_prompts(&prompts)
        .map_err(|message| AppError::new(message.clone(), "flow_batch_format"))?;
    let (estimated_credits, per_video_credits) = if generation == GenerationType::Videos {
        let total = flow_batch::check_video_credits_for(model, seconds, &resolution, u32::try_from(jobs.len()).unwrap_or(u32::MAX), cap)
            .map_err(|message| AppError::new(message.clone(), "flow_batch_credits"))?;
        let per_video = flow_batch::video_credits_per_video(model, seconds, &resolution).unwrap_or(0);
        (total, per_video)
    } else {
        (0, 0)
    };
    let rename_preview = jobs
        .iter()
        .map(|job| FlowBatchRenamePreview {
            flow_name: format!("{}.{}", job.scene_id, generation.extension()),
            timecode_name: job.file_name.clone(),
            scene_id: job.scene_id.clone(),
        })
        .collect();
    Ok(FlowBatchPrepared {
        text,
        paragraph_count: jobs.len(),
        scene_ids: jobs.iter().map(|job| job.scene_id.clone()).collect(),
        estimated_credits,
        per_video_credits,
        max_credits_per_video: cap,
        rename_preview,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowBatchRunRequest {
    pub project_id: String,
    /// A Google account id (absent = the first ready account).
    pub account_id: Option<String>,
    pub jobs: Vec<NewJob>,
    /// "images" or "videos".
    pub generation_type: String,
    pub video_model: Option<String>,
    pub video_seconds: Option<u32>,
    pub video_resolution: Option<String>,
    pub max_credits_per_video: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowBatchSavedFile {
    pub scene_id: String,
    pub flow_name: String,
    pub saved_name: String,
    /// Project-relative path, e.g. `media/S01_000.0-008.0.png`.
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub modified: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowBatchRunReport {
    pub saved: Vec<FlowBatchSavedFile>,
    pub failed_scene_ids: Vec<String>,
    pub account_name: String,
    pub estimated_credits: u32,
    pub per_video_credits: u32,
}

/// The wired run: prepare (validate + format + credit guard), open
/// the shared tool in a tab of the account's browser, generate, poll,
/// download per card in card order, and save each download through
/// the rename step into the project's `media` folder. A failed card
/// is listed in `failed_scene_ids` and its number is never reassigned.
#[tauri::command]
pub async fn flow_batch_run(
    app: tauri::AppHandle,
    ig: tauri::State<'_, std::sync::Arc<ImageGen>>,
    request: FlowBatchRunRequest,
) -> Result<FlowBatchRunReport, AppError> {
    let prepared = flow_batch_prepare(FlowBatchPrepareRequest {
        jobs: request.jobs.clone(),
        generation_type: request.generation_type.clone(),
        video_model: request.video_model.clone(),
        video_seconds: request.video_seconds,
        video_resolution: request.video_resolution.clone(),
        max_credits_per_video: request.max_credits_per_video,
    })?;
    let generation = generation_of(&request.generation_type)?;
    let cfg = EngineConfig::bundled().flow_batch;
    let (model, seconds, resolution, _) = resolve_video_choice(
        &cfg,
        request.video_model,
        request.video_seconds,
        request.video_resolution,
        request.max_credits_per_video,
    )?;
    let dir = crate::commands::projects::project_folder(&app, &request.project_id)?;
    let media = dir.join("media");
    std::fs::create_dir_all(&media)
        .map_err(|e| AppError::new("The project's media folder could not be made.", e.to_string()))?;

    // Pick the account: the requested one, else the first ready one.
    let account_id = match request.account_id {
        Some(id) => id,
        None => {
            let now = now_ms();
            ig.engine
                .read_accounts(|accounts| {
                    accounts
                        .views(now)
                        .into_iter()
                        .find(|view| view.enabled && matches!(view.status, AccountStatus::Ready | AccountStatus::Busy))
                        .map(|view| view.id)
                })
                .ok_or_else(|| {
                    AppError::new(
                        "No Google account is ready for Batch Flow Studio. Add one in Settings, Google accounts, and press Sign in.",
                        "no account for batch",
                    )
                })?
        }
    };
    let account_name = ig
        .engine
        .read_accounts(|accounts| {
            accounts
                .views(now_ms())
                .into_iter()
                .find(|view| view.id == account_id)
                .map(|view| view.name)
        })
        .unwrap_or_default();
    let settings = ig.engine.settings();
    let worker = ig
        .real
        .worker(&account_id, &settings)
        .map_err(|e| AppError::new(e.message.clone(), format!("{:?}", e.kind)))?;
    let (session, tab) = worker
        .batch_tab()
        .await
        .map_err(|e| AppError::new(e.message.clone(), format!("{:?}", e.kind)))?;
    let run_result = flow_batch_run::run_batch(
        &session,
        &tab,
        &cfg,
        &RunRequest {
            generation,
            video_model: model,
            video_seconds: seconds,
            video_resolution: resolution,
            text: prepared.text.clone(),
            scene_ids: prepared.scene_ids.clone(),
            batch_size: cfg.batch_size,
        },
    )
    .await;
    session.close_tab(&tab).await;
    let downloads = run_result.map_err(|e| AppError::new(e.message.clone(), format!("{:?}", e.kind)))?;

    let scenes: std::collections::HashMap<String, (f64, f64)> = request
        .jobs
        .iter()
        .filter_map(|job| {
            // The timecode name carries start-end; the rename step
            // itself re-derives it from these same jobs, so parse
            // defensively and skip anything that does not parse.
            let rest = job.file_name.strip_prefix(&job.scene_id)?.strip_prefix('_')?;
            let times = rest.strip_suffix(&format!(".{}", generation.extension()))?;
            let (start, end) = times.split_once('-')?;
            Some((job.scene_id.clone(), (start.parse().ok()?, end.parse().ok()?)))
        })
        .collect();
    let mut saved = Vec::new();
    let mut failed: Vec<String> = Vec::new();
    for download in downloads {
        let Some((start, end)) = scenes.get(&download.flow_name.rsplit_once('.').map(|(s, _)| s.to_string()).unwrap_or_default()) else {
            failed.push(download.flow_name.clone());
            continue;
        };
        let scene_id = download.flow_name.rsplit_once('.').map(|(s, _)| s.to_string()).unwrap_or_default();
        let Some(timecode) = flow_batch::rename_flow_file(&download.flow_name, &scene_id, *start, *end, generation) else {
            failed.push(download.flow_name.clone());
            continue;
        };
        let name = crate::commands::blocking::run_blocking({
            let media = media.clone();
            let timecode = timecode.clone();
            let bytes = download.bytes.clone();
            move || -> Result<String, AppError> {
                let name = unique_target(&timecode, &|candidate| media.join(candidate).exists());
                crate::imagegen::store::write_durable(&media.join(&name), &bytes)
                    .map_err(|e| AppError::new("The file could not be saved in the project's media folder.", e.to_string()))?;
                Ok(name)
            }
        })
        .await?;
        let file = media.join(&name);
        let modified = std::fs::metadata(&file)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_secs());
        let (width, height, duration) = match crate::probe::probe_text(&file, "The saved file could not be read.").await {
            Ok(text) => {
                let info = crate::probe::parse_info(&text);
                // FFmpeg reports a PNG as a Video stream too, so the
                // first Video stream gives width/height for both.
                let stream = info.first(crate::probe::StreamKind::Video);
                (
                    stream.map_or(0, |s| s.width),
                    stream.map_or(0, |s| s.height),
                    info.duration.unwrap_or(0.0),
                )
            }
            Err(_) => (0, 0, 0.0),
        };
        saved.push(FlowBatchSavedFile {
            scene_id,
            flow_name: download.flow_name,
            saved_name: name.clone(),
            path: format!("media/{name}"),
            width,
            height,
            duration,
            modified,
        });
    }
    // Scenes the tool never produced a download for are failures, not
    // gaps to be filled by renumbering another scene.
    for scene_id in &prepared.scene_ids {
        if !saved.iter().any(|s| &s.scene_id == scene_id) && !failed.iter().any(|f| f.contains(scene_id)) {
            failed.push(scene_id.clone());
        }
    }
    Ok(FlowBatchRunReport {
        saved,
        failed_scene_ids: failed,
        account_name,
        estimated_credits: prepared.estimated_credits,
        per_video_credits: prepared.per_video_credits,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowBatchRenameRequest {
    /// As downloaded: `S01.png` / `S01.mp4`.
    pub flow_name: String,
    pub scene_id: String,
    pub start: f64,
    pub end: f64,
    /// "images" or "videos".
    pub generation_type: String,
}

/// Builds the timecode name for one Flow file from the project scene
/// record. Refuses (never guesses) when the Flow name's scene id does not
/// match the scene record, or the extension does not match the type.
#[tauri::command]
pub fn flow_batch_rename(request: FlowBatchRenameRequest) -> Result<String, AppError> {
    let generation = generation_of(&request.generation_type)?;
    flow_batch::rename_flow_file(
        &request.flow_name,
        &request.scene_id,
        request.start,
        request.end,
        generation,
    )
    .ok_or_else(|| {
        AppError::new(
            "That Flow file does not belong to the scene it was claimed for, so it was not renamed.",
            format!(
                "flow_name {:?} does not match scene {:?}",
                request.flow_name, request.scene_id
            ),
        )
    })
}
