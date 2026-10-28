//! Voice-over from a script with Gemini's speech models (same API key as the text models).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::api::clean_model_name;
use crate::api::edge_tts::{self, EdgeVoice, DEFAULT_EDGE_VOICE};
use crate::api::error::ApiError;
use crate::api::rotate;
use crate::api::gemini_tts::{speak, Spoken};
use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::commands::projects::project_folder;
use crate::jobs::{event_sink, JobRegistry};
use crate::keys::{self, Provider};
use crate::tts::split::{split_script, DEFAULT_BUDGET};
use crate::tts::voices::{is_voice, TtsModel, Voice, DEFAULT_MODEL, DEFAULT_VOICE, MODELS, VOICES};
use crate::tts::{self, wav};

/// Pieces spoken at the same time (the preview models have low limits per minute).
const AT_ONCE: usize = 2;
/// Most letters in one script (about 8 hours of speech): a typing slip must not become a large bill.
const MAX_CHARS: usize = 400_000;
/// Tries per piece when the model answers with words instead of sound or the connection drops.
const TRIES: u32 = 3;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsOptions {
    pub voices: Vec<Voice>,
    pub models: Vec<TtsModel>,
    pub default_model: &'static str,
    pub default_voice: &'static str,
    /// The built-in Edge fallback voices. The live list comes from the
    /// `edge_voices` command, which the UI calls when Edge is chosen.
    pub edge_voices: Vec<EdgeVoice>,
    pub edge_default_voice: &'static str,
}

#[tauri::command]
pub fn tts_options() -> TtsOptions {
    TtsOptions {
        voices: VOICES.to_vec(),
        models: MODELS.to_vec(),
        default_model: DEFAULT_MODEL,
        default_voice: DEFAULT_VOICE,
        edge_voices: edge_tts::fallback_voices(),
        edge_default_voice: DEFAULT_EDGE_VOICE,
    }
}

/// The live Microsoft voice list (cached for a day inside the Edge module);
/// falls back to the built-in list when Microsoft cannot be reached, so the
/// picker is never empty. No key, card, or account is needed for the list.
#[tauri::command]
pub async fn edge_voices() -> Vec<EdgeVoice> {
    edge_tts::voices().await
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsRequest {
    pub text: String,
    pub voice: String,
    pub model: String,
    #[serde(default)]
    pub style: String,
    /// `"gemini"` (the default, when empty or anything else) or `"edge"`.
    #[serde(default)]
    pub provider: String,
    /// Edge only: speaking rate in percent (-50..+100, clamped by the client).
    #[serde(default)]
    pub rate: i32,
    /// Edge only: volume in percent (-100..+100, clamped by the client).
    #[serde(default)]
    pub volume: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsResult {
    /// The joined voice (a WAV file in the project) that the Voice step imports.
    pub path: String,
    pub duration: f64,
    pub pieces: usize,
    /// Pieces taken from an earlier run (nothing was paid for them again).
    pub reused: usize,
}

/// A checked request: which provider speaks, and what identifies the sound
/// (the piece cache key uses `model_key`, so a Gemini piece is never reused
/// for an Edge voice, or the other way round).
struct Checked {
    provider: String,
    /// Gemini model id, or `"edge-tts"` for Edge (Edge has no model choice).
    model_key: String,
    rate: i32,
    volume: i32,
    /// Gemini only. Edge has no style note: Gemini's "Say in a calm voice:"
    /// prefix would be spoken aloud by Edge, so it is dropped for Edge.
    style: String,
}

fn checked(request: &TtsRequest) -> Result<Checked, AppError> {
    if request.text.trim().is_empty() {
        return Err(AppError::new("Please paste the script first.", "empty text"));
    }
    if request.text.chars().count() > MAX_CHARS {
        return Err(AppError::new("This script is too long for one voice-over. Please split it into parts.", format!("{} characters", request.text.chars().count())));
    }
    let provider = if request.provider.trim().eq_ignore_ascii_case("edge") {
        "edge".to_string()
    } else {
        "gemini".to_string()
    };
    if provider == "edge" {
        if !edge_tts::is_edge_voice(&request.voice) {
            return Err(AppError::new(
                "Please choose one of the Microsoft voices in the list.",
                format!("unknown Edge voice {}", request.voice),
            ));
        }
        return Ok(Checked {
            provider,
            model_key: "edge-tts".to_string(),
            rate: request.rate,
            volume: request.volume,
            style: String::new(),
        });
    }
    if !is_voice(&request.voice) {
        return Err(AppError::new("Please choose one of the voices in the list.", format!("unknown voice {}", request.voice)));
    }
    let model = clean_model_name(&request.model, false).ok_or_else(|| AppError::new("The voice model name is not valid.", request.model.clone()))?;
    Ok(Checked {
        provider,
        model_key: model,
        rate: 0,
        volume: 0,
        style: request.style.trim().chars().take(300).collect(),
    })
}

async fn speak_with_tries(model: &str, voice: &str, text: &str) -> Result<Spoken, ApiError> {
    let mut last = ApiError::BadResponse("no try".to_string());
    for attempt in 0..TRIES {
        // Every saved Gemini key is tried before a limit is reported.
        match rotate::run_api(Provider::Gemini, |key| async move { speak(&key, model, voice, text).await }).await {
            Ok(spoken) => return Ok(spoken),
            // A wrong key or a full quota will not get better by asking again.
            Err(error @ (ApiError::InvalidKey(_) | ApiError::RateLimited(_))) => return Err(error),
            Err(error) => {
                last = error;
                if attempt + 1 < TRIES {
                    tokio::time::sleep(std::time::Duration::from_secs(2 + u64::from(attempt) * 3)).await;
                }
            }
        }
    }
    Err(last)
}

/// Speaks one piece with the chosen provider. Gemini keeps its key rotation;
/// Edge is called directly (no key exists to rotate) and retried the same
/// number of times on network/server failures. A rate limit is returned at
/// once for both, and neither provider is ever silently swapped for the other:
/// a failed Edge piece reports Edge, so the user can switch provider by hand.
async fn speak_piece(check: &Checked, voice: &str, text: &str) -> Result<Spoken, ApiError> {
    if check.provider == "edge" {
        let mut last = ApiError::BadResponse("no try".to_string());
        for attempt in 0..TRIES {
            match edge_tts::speak(voice, check.rate, check.volume, text).await {
                Ok(spoken) => return Ok(spoken),
                Err(error @ ApiError::RateLimited(_)) => return Err(error),
                Err(error) => {
                    last = error;
                    if attempt + 1 < TRIES {
                        tokio::time::sleep(std::time::Duration::from_secs(2 + u64::from(attempt) * 3)).await;
                    }
                }
            }
        }
        return Err(last);
    }
    speak_with_tries(&check.model_key, voice, text).await
}

/// A short sentence in the chosen voice, to hear it before the whole script is made. Returns a `data:audio/wav` address.
#[tauri::command]
pub async fn tts_preview(voice: String, model: String, style: String, text: String) -> Result<String, AppError> {
    tts_preview_full(voice, model, style, text, String::new(), 0, 0).await
}

/// The preview with provider and Edge rate/volume (the frontend calls this
/// when Edge is chosen; `tts_preview` stays as the Gemini-only alias).
#[tauri::command]
pub async fn tts_preview_full(
    voice: String,
    model: String,
    style: String,
    text: String,
    provider: String,
    rate: i32,
    volume: i32,
) -> Result<String, AppError> {
    let request = TtsRequest { text: text.chars().take(400).collect(), voice, model, style, provider, rate, volume };
    let check = checked(&request)?;
    let spoken_text = if check.provider == "edge" {
        request.text.trim().to_string()
    } else {
        tts::spoken_text(&check.style, request.text.trim())
    };
    let spoken = speak_piece(&check, &request.voice, &spoken_text).await?;
    let samples = wav::trim_silence(&wav::samples_from_pcm(&spoken.pcm), spoken.rate, 100);
    Ok(format!("data:audio/wav;base64,{}", crate::api::base64::encode(&wav::wav_bytes(&samples, spoken.rate))))
}

/// Speaks the whole script piece by piece and joins the pieces into `audio/tts/voice.wav` of the project.
#[tauri::command]
pub async fn tts_generate(app: AppHandle, jobs: State<'_, JobRegistry>, project_id: String, request: TtsRequest, job_id: String) -> Result<TtsResult, AppError> {
    let check = checked(&request)?;
    let folder: PathBuf = project_folder(&app, &project_id)?.join("audio").join("tts");
    let job = jobs.begin(&job_id, "tts", event_sink(app.clone()))?;
    // Gemini needs a saved key; Edge needs none (no key, card, or account).
    if check.provider == "gemini" {
        run_blocking(|| keys::require(Provider::Gemini)).await?;
    }

    let chunks = split_script(&request.text, DEFAULT_BUDGET);
    let total = chunks.len();
    let names: Vec<String> = chunks.iter().map(|c| tts::piece_key(&check.model_key, &request.voice, &check.style, &c.text)).collect();
    let keep: Vec<PathBuf> = names.iter().enumerate().map(|(i, n)| tts::piece_file(&folder, i, n)).collect();
    {
        let folder = folder.clone();
        let keep = keep.clone();
        run_blocking(move || {
            tts::clean_folder(&folder, &keep);
            Ok(())
        })
        .await?;
    }

    let mut pieces: Vec<Option<(Vec<i16>, u32)>> = vec![None; total];
    let mut reused = 0usize;
    for (index, name) in names.iter().enumerate() {
        if let Some(found) = tts::load_piece(&folder, index, name) {
            pieces[index] = Some(found);
            reused += 1;
        }
    }
    let mut done = reused;
    job.progress(&format!("Voice: piece {done} of {total}"), done as f64 / total as f64 * 95.0);

    let limit = Arc::new(Semaphore::new(AT_ONCE));
    let mut running: JoinSet<(usize, Result<Spoken, ApiError>)> = JoinSet::new();
    let mut texts: HashMap<usize, String> = HashMap::new();
    for (index, chunk) in chunks.iter().enumerate() {
        if pieces[index].is_some() {
            continue;
        }
        let (provider, model_key, rate, volume, style) =
            (check.provider.clone(), check.model_key.clone(), check.rate, check.volume, check.style.clone());
        let voice = request.voice.clone();
        let text = if provider == "edge" {
            chunk.text.clone()
        } else {
            tts::spoken_text(&style, &chunk.text)
        };
        texts.insert(index, chunk.text.clone());
        let limit = limit.clone();
        running.spawn(async move {
            let _slot = limit.acquire_owned().await;
            let piece_check = Checked { provider, model_key, rate, volume, style };
            (index, speak_piece(&piece_check, &voice, &text).await)
        });
    }
    while !running.is_empty() {
        let next = tokio::select! {
            () = job.cancelled() => {
                running.abort_all();
                return Err(AppError::cancelled());
            }
            next = running.join_next() => next,
        };
        let Some(joined) = next else { break };
        let (index, outcome) = joined.map_err(|e| AppError::new("A voice piece stopped unexpectedly.", e.to_string()))?;
        match outcome {
            Ok(spoken) => {
                let samples = wav::samples_from_pcm(&spoken.pcm);
                let (saving, name) = (folder.clone(), names[index].clone());
                let to_save = samples.clone();
                run_blocking(move || tts::save_piece(&saving, index, &name, &to_save, spoken.rate).map_err(|e| AppError::new("A finished piece of the voice could not be saved.", e.to_string()))).await?;
                pieces[index] = Some((samples, spoken.rate));
                done += 1;
                job.progress(&format!("Voice: piece {done} of {total}"), done as f64 / total as f64 * 95.0);
            }
            Err(error) => {
                // The pieces that are finished stay saved: pressing Generate again continues from here.
                running.abort_all();
                let first = texts.get(&index).map(|t| t.chars().take(60).collect::<String>()).unwrap_or_default();
                let app_error: AppError = error.clone().into();
                return Err(AppError::new(
                    format!("{} Piece {} of {total} failed; the {done} finished pieces are kept, so pressing Generate again continues from there.", app_error.message, index + 1),
                    format!("{} | piece starts: {first}", app_error.details),
                ));
            }
        }
    }

    job.progress("Joining the pieces", 97.0);
    let rate = pieces.iter().flatten().map(|(_, r)| *r).next().unwrap_or(wav::SAMPLE_RATE);
    let ordered: Vec<(Vec<i16>, bool)> = pieces.into_iter().zip(chunks.iter()).map(|(p, c)| (p.map(|(s, _)| s).unwrap_or_default(), c.paragraph_end)).collect();
    let target = folder.join("voice.wav");
    let (out_path, duration) = {
        let target = target.clone();
        run_blocking(move || {
            let joined = tts::assemble(&ordered, rate);
            if joined.is_empty() {
                return Err(AppError::new("The voice came out empty. Please try again.", "no samples after joining"));
            }
            std::fs::create_dir_all(target.parent().unwrap_or(&target)).map_err(|e| AppError::new("The voice folder could not be created.", e.to_string()))?;
            std::fs::write(&target, wav::wav_bytes(&joined, rate)).map_err(|e| AppError::new("The voice file could not be saved.", format!("{e} ({})", target.display())))?;
            Ok((target, wav::seconds(&joined, rate)))
        })
        .await?
    };
    job.progress("Done", 100.0);
    Ok(TtsResult { path: out_path.to_string_lossy().into_owned(), duration, pieces: total, reused })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(text: &str, voice: &str, model: &str) -> TtsRequest {
        TtsRequest {
            text: text.into(),
            voice: voice.into(),
            model: model.into(),
            style: " in a calm voice ".into(),
            provider: String::new(),
            rate: 0,
            volume: 0,
        }
    }

    fn edge_request(text: &str, voice: &str) -> TtsRequest {
        TtsRequest {
            text: text.into(),
            voice: voice.into(),
            model: String::new(),
            style: " in a calm voice ".into(),
            provider: "edge".into(),
            rate: 20,
            volume: -10,
        }
    }

    #[test]
    fn the_request_is_checked_before_anything_is_paid_for() {
        assert!(checked(&request("Hello.", "Kore", DEFAULT_MODEL)).is_ok());
        assert_eq!(checked(&request("Hello.", "Kore", DEFAULT_MODEL)).unwrap().style, "in a calm voice");
        assert!(checked(&request("  ", "Kore", DEFAULT_MODEL)).is_err());
        assert!(checked(&request("Hello.", "Nobody", DEFAULT_MODEL)).is_err());
        assert!(checked(&request("Hello.", "Kore", "bad model!")).is_err());
        assert!(checked(&request(&"a".repeat(MAX_CHARS + 1), "Kore", DEFAULT_MODEL)).is_err());
    }

    #[test]
    fn an_edge_request_needs_no_gemini_model_and_drops_the_style_note() {
        let check = checked(&edge_request("Hello.", "ko-KR-SunHiNeural")).unwrap();
        assert_eq!(check.provider, "edge");
        assert_eq!(check.model_key, "edge-tts");
        assert_eq!(check.style, "");
        assert_eq!((check.rate, check.volume), (20, -10));
        assert!(checked(&edge_request("Hello.", "Kore")).is_err());
        assert!(checked(&edge_request("Hello.", "ko KR SunHi")).is_err());
    }

    #[test]
    fn the_options_list_everything_the_screen_needs() {
        let options = tts_options();
        assert_eq!(options.voices.len(), 30);
        assert!(options.models.iter().any(|m| m.id == options.default_model));
        assert_eq!(options.edge_default_voice, DEFAULT_EDGE_VOICE);
        assert!(options.edge_voices.iter().any(|v| v.name == "ko-KR-SunHiNeural"));
    }
}
