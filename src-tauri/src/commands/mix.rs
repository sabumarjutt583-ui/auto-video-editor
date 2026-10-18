use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::audio::mix::{self, Loudness, MixRequest, SfxFile};
use crate::audio::paths::resolve;
use crate::commands::error::AppError;
use crate::commands::projects::project_folder;
use crate::commands::sfx::sfx_folder;
use crate::jobs::{event_sink, JobRegistry};
use crate::sfx::load_library;

const OUTPUT_FILE: &str = "audio_mix.wav";
const MAX_SECONDS: f64 = 4.0 * 3600.0;
const MAX_CUES: usize = 3000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MixResult {
    /// Inside the project, "exports/audio_mix.wav".
    pub path: String,
    pub duration: f64,
    pub loudness: Loudness,
}

fn must_exist(path: &Path, what: &str) -> Result<(), AppError> {
    if path.is_file() {
        Ok(())
    } else {
        Err(AppError::new(format!("{what} could not be found. It may have been moved or deleted."), format!("Missing: {}", path.display())))
    }
}

/// The files a mix needs, found and checked: the voice, the music in play order, and the sound effects.
pub struct MixInputs {
    pub voice: PathBuf,
    pub music: Vec<(PathBuf, f64)>,
    pub cues: Vec<SfxFile>,
}

/// Checks the request and finds every file it names inside the project and the sound library.
pub fn prepare_mix(project_dir: &Path, sfx_dir: &Path, request: &MixRequest) -> Result<MixInputs, AppError> {
    if !(request.duration.is_finite() && request.duration > 0.0 && request.duration <= MAX_SECONDS) {
        return Err(AppError::new("The video length is not valid.", format!("duration = {}", request.duration)));
    }
    if request.sfx.len() > MAX_CUES {
        return Err(AppError::new("There are too many sound effects.", format!("{} cues", request.sfx.len())));
    }
    let voice = resolve(project_dir, &request.voice_path)?;
    must_exist(&voice, "The voice-over file")?;

    let mut music = Vec::new();
    for index in mix::music_sequence(&request.music.tracks, request.duration, request.music.mode) {
        let track = &request.music.tracks[index];
        let path = resolve(project_dir, &track.path)?;
        must_exist(&path, &format!("The music file {}", track.path))?;
        music.push((path, track.duration));
    }

    let library = load_library(sfx_dir);
    let cues: Vec<SfxFile> = request
        .sfx
        .iter()
        .filter(|cue| cue.time.is_finite() && cue.time >= 0.0 && cue.time < request.duration)
        .filter_map(|cue| {
            let sound = library.sounds.iter().find(|s| s.id == cue.sound_id)?;
            Some(SfxFile { path: sfx_dir.join(&sound.file), time: cue.time, gain: cue.gain.clamp(0.0, 1.0) })
        })
        .collect();
    Ok(MixInputs { voice, music, cues })
}

/// Mixes the voice, the music and the sound effects, sets the loudness to -14 LUFS and writes `exports/audio_mix.wav`.
#[tauri::command]
pub async fn build_audio_mix(app: AppHandle, jobs: State<'_, JobRegistry>, project_id: String, request: MixRequest, job_id: String) -> Result<MixResult, AppError> {
    let project_dir = project_folder(&app, &project_id)?;
    let inputs = prepare_mix(&project_dir, &sfx_folder(&app), &request)?;
    let folder = project_dir.join("exports");
    let output = folder.join(OUTPUT_FILE);
    let job = jobs.begin(&job_id, "audio-mix", event_sink(app))?;
    let loudness = mix::render_mix(&job, &request, &inputs.voice, &inputs.music, &inputs.cues, &folder, &output).await?;
    Ok(MixResult { path: format!("exports/{OUTPUT_FILE}"), duration: request.duration, loudness })
}
