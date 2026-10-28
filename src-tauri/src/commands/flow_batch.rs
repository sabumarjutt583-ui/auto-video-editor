//! Commands for Batch Flow Studio (the shared tool link only).
//!
//! These commands prepare and rename a batch; they do not themselves sign
//! the user in, bypass a captcha/limit, or spend credits. The browser run
//! itself reuses the Image Generator's Google-account browser (the same
//! profile/session pattern as the Gemini Canvas tool): it opens the shared
//! tool link, fills the Batch Prompt Box with the paragraph text returned
//! by `flow_batch_prepare`, sets Generation Type (Images or Videos) and the
//! tool's defaults (Images: Nano Banana 2.1, 16:9; Videos: Veo 3.1 Flash,
//! Text to Video, 4s @ 720p), clicks Generate All as Images / Generate All
//! as Videos, polls the Batch Media Queue (Batch Size 8) until cards are
//! Ready, and downloads per card in card order via its "Download Sxx.png"
//! / "Download Sxx.mp4" button (Download All only in batch order). The
//! selectors for that run live in `FlowBatchConfig` (config.json
//! `flowBatch` block) and are UNVERIFIED against a live signed-in session,
//! because they were taken from screenshots only; a live run must confirm
//! them before any batch is trusted, and a page change is fixed by a
//! config update, not a new app version.
//!
//! The rename step is the safe part and it is fully implemented here:
//! a Flow file arrives as `S01.png` / `S01.mp4`, `flow_batch_rename`
//! parses that scene id and builds the timecode name from the project
//! scene record (`S01_000.0-008.0.png` / `.mp4`). Saving still goes
//! through the existing `save::save_new` / `queue::unique_target` path in
//! the engine, so a taken name becomes `(2)`, `(3)`, ... and an identical
//! file is reported as already saved. A file whose name does not parse to
//! the scene it is claimed for is refused with a clear error — the tool
//! never guesses a scene.

use serde::{Deserialize, Serialize};

use crate::commands::error::AppError;
use crate::imagegen::config::{EngineConfig, FlowBatchConfig};
use crate::imagegen::flow_batch::{self, GenerationType};
use crate::imagegen::mapping::check_jobs;
use crate::imagegen::queue::NewJob;

/// What the frontend shows before it opens the Batch tool: the shared link
/// (never an old Flow project link), the defaults, and the credit guard.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowBatchInfo {
    pub url: String,
    pub images_model: String,
    pub videos_model: String,
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

/// Validates the jobs exactly like the image engine does (scene id must
/// match the timecode file name, prompt non-empty, aspect valid, no
/// duplicate scene id, whole list refused if one entry is bad), formats
/// the prompts as paragraphs, checks the credit guard for videos, and
/// returns the rename preview. Nothing is sent to Flow by this command.
#[tauri::command]
pub fn flow_batch_prepare(request: FlowBatchPrepareRequest) -> Result<FlowBatchPrepared, AppError> {
    let generation = generation_of(&request.generation_type)?;
    let cfg = EngineConfig::bundled().flow_batch;
    let jobs = check_jobs(request.jobs)?;
    let prompts: Vec<String> = jobs.iter().map(|job| job.prompt.clone()).collect();
    let text = flow_batch::format_prompts(&prompts)
        .map_err(|message| AppError::new(message.clone(), "flow_batch_format"))?;
    let estimated_credits = if generation == GenerationType::Videos {
        flow_batch::check_video_credits(
            u32::try_from(jobs.len()).unwrap_or(u32::MAX),
            cfg.video_credits_per_video,
            cfg.max_credits_per_video,
        )
        .map_err(|message| AppError::new(message.clone(), "flow_batch_credits"))?
    } else {
        0
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
        per_video_credits: cfg.video_credits_per_video,
        max_credits_per_video: cfg.max_credits_per_video,
        rename_preview,
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
