//! What the frontend sends to start a render, and what it gets back.

use serde::{Deserialize, Serialize};

use crate::audio::mix::MixRequest;
use crate::captions::AssRequest;
use crate::commands::error::AppError;

pub const MAX_SCENES: usize = 5000;
const MAX_SECONDS: f64 = 4.0 * 3600.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    Image,
    Video,
    /// No picture: a black frame.
    Black,
}

/// The picture or clip of a scene.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub kind: SourceKind,
    /// Inside the project, e.g. "media/S01_000.0-005.1.png".
    #[serde(default)]
    pub path: String,
    /// Seconds. 0 for pictures.
    #[serde(default)]
    pub duration: f64,
    /// Use only the last picture of the clip (a "hold previous" scene).
    #[serde(default)]
    pub last_frame: bool,
    /// Show it as a blurred background only (a "blurred previous" scene).
    #[serde(default)]
    pub blur_all: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Motion {
    ZoomIn,
    ZoomOut,
    PanLeft,
    PanRight,
    PanUp,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Fit {
    Crop,
    Blur,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransitionKind {
    Cut,
    Dissolve,
    Fade,
    Slide,
    Zoom,
    Whip,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneTransition {
    pub kind: TransitionKind,
    /// How long it lasts, in seconds.
    pub seconds: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderScene {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub source: Source,
    pub motion: Motion,
    pub fit: Fit,
    /// Playback speed for a clip that is shorter than its scene (1 = automatic).
    #[serde(default = "one")]
    pub speed: f64,
    /// The transition into this scene.
    pub transition: SceneTransition,
}

/// A motion graphic laid over the video: a folder of transparent PNG frames made by `motion/`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlay {
    /// Inside the project, e.g. "motion/m1/frames" (files 00000.png, 00001.png ...). Empty when `clip` is used.
    #[serde(default)]
    pub frames_dir: String,
    /// Inside the project, e.g. "graphics/g1/clip.mov": a transparent clip made by `graphics/export.rs`.
    #[serde(default)]
    pub clip: Option<String>,
    /// When it appears in the video, in seconds.
    pub start: f64,
    /// The frame rate the frames were drawn at.
    pub fps: u32,
}

pub const MAX_OVERLAYS: usize = 100;

fn one() -> f64 {
    1.0
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderRequest {
    pub project_name: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// The voice length: the video must be exactly this long.
    pub duration: f64,
    pub scenes: Vec<RenderScene>,
    /// Ken Burns on or off for the whole video.
    pub ken_burns: bool,
    /// None when the captions are off.
    #[serde(default)]
    pub captions: Option<AssRequest>,
    /// Sentence-level SRT text to save next to the video.
    #[serde(default)]
    pub srt: Option<String>,
    pub mix: MixRequest,
    /// Motion graphics laid over the whole video (above the pictures, below the captions).
    #[serde(default)]
    pub overlays: Vec<Overlay>,
    /// For the file name, e.g. "16x9".
    pub aspect_label: String,
    /// For the file name, e.g. "shorts".
    #[serde(default)]
    pub suffix: Option<String>,
    /// Today, "2026-10-18", for the file name.
    pub date: String,
}

fn bad(message: &str, details: String) -> AppError {
    AppError::new(message, details)
}

impl RenderRequest {
    pub fn validate(&self) -> Result<(), AppError> {
        let size_ok = |v: u32| (64..=8192).contains(&v) && v % 2 == 0;
        if !size_ok(self.width) || !size_ok(self.height) {
            return Err(bad("The video size is not valid.", format!("{}x{}", self.width, self.height)));
        }
        if !(12..=120).contains(&self.fps) {
            return Err(bad("The frame rate is not valid.", format!("{} fps", self.fps)));
        }
        if !(self.duration.is_finite() && self.duration > 0.0 && self.duration <= MAX_SECONDS) {
            return Err(bad("The video length is not valid.", format!("duration = {}", self.duration)));
        }
        if self.scenes.is_empty() {
            return Err(bad("There are no scenes to render.", "scenes is empty".to_string()));
        }
        if self.scenes.len() > MAX_SCENES {
            return Err(bad("There are too many scenes.", format!("{} scenes", self.scenes.len())));
        }
        if self.scenes.iter().any(|s| !(s.start.is_finite() && s.end.is_finite() && s.start >= 0.0 && s.end >= s.start)) {
            return Err(bad("A scene has a wrong time.", "non-finite or reversed scene time".to_string()));
        }
        if self.overlays.len() > MAX_OVERLAYS {
            return Err(bad("There are too many motion graphics.", format!("{} overlays", self.overlays.len())));
        }
        for overlay in &self.overlays {
            let inside_project = |text: &str| {
                let path = std::path::Path::new(text);
                !text.is_empty() && path.is_relative() && !path.components().any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::Prefix(_) | std::path::Component::RootDir))
            };
            match overlay.clip.as_deref() {
                Some(clip) => {
                    if !inside_project(clip) || !clip.ends_with(".mov") || !overlay.frames_dir.is_empty() {
                        return Err(bad("A motion graphic has a wrong file.", format!("clip = {clip:?}, frames_dir = {:?}", overlay.frames_dir)));
                    }
                }
                None if !inside_project(&overlay.frames_dir) => {
                    return Err(bad("A motion graphic has a wrong folder.", format!("frames_dir = {:?}", overlay.frames_dir)));
                }
                None => {}
            }
            if !(overlay.start.is_finite() && overlay.start >= 0.0 && overlay.start < self.duration && (12..=120).contains(&overlay.fps)) {
                return Err(bad("A motion graphic has a wrong time.", format!("start = {}, fps = {}", overlay.start, overlay.fps)));
            }
        }
        Ok(())
    }
}

/// The finished video.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderResult {
    /// Full path of the video in the project's exports folder.
    pub path: String,
    /// Full path of the extra copy in the user's export folder, if one is set.
    pub copy_path: Option<String>,
    pub srt_path: Option<String>,
    pub size_bytes: u64,
    /// Measured with FFprobe.
    pub duration: f64,
    pub expected_duration: f64,
    /// True when `duration` is within 0.1 s of `expected_duration`.
    pub duration_ok: bool,
    pub width: u32,
    pub height: u32,
    /// The video encoder that was used, e.g. "NVIDIA NVENC (GPU)".
    pub encoder: String,
    pub seconds_taken: f64,
    /// Things that went wrong without stopping the render (e.g. the extra copy could not be saved).
    pub warnings: Vec<String>,
}
