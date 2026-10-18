use serde::Serialize;
use tauri::{AppHandle, State};

use crate::api::error::ApiError;
use crate::api::{gemini, groq};
use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::jobs::{event_sink, JobRegistry};
use crate::keys::{self, KeyStatus, Provider};
use crate::settings;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextAnswer {
    pub text: String,
    /// "gemini" or "groq" (when the backup was used).
    pub provider: String,
}

/// Asks Gemini (and, when the backup is switched on in Settings and Gemini fails, Groq) for text.
/// Used for scene grouping, the character bible and prompt writing. Can be cancelled.
#[tauri::command]
pub async fn generate_text(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    system: Option<String>,
    prompt: String,
    json: bool,
    job_id: String,
) -> Result<TextAnswer, AppError> {
    let job = jobs.begin(&job_id, "ai", event_sink(app.clone()))?;
    let app_for_settings = app.clone();
    let settings = run_blocking(move || settings::load(&app_for_settings)).await?;
    let gemini_key = run_blocking(|| keys::require(Provider::Gemini)).await;
    let system = system.as_deref();
    let gemini_key = match gemini_key {
        Ok(key) => key,
        Err(error) => return fallback_or(error, &settings, &job, system, &prompt).await,
    };

    job.progress("Asking Gemini", 5.0);
    let first: Result<String, ApiError> = tokio::select! {
        () = job.cancelled() => return Err(AppError::cancelled()),
        answer = gemini::generate(&gemini_key, &settings.gemini_model, system, &prompt, json) => answer,
    };
    match first {
        Ok(text) => Ok(TextAnswer { text, provider: "gemini".into() }),
        Err(error) => fallback_or(error.into(), &settings, &job, system, &prompt).await,
    }
}

async fn fallback_or(
    error: AppError,
    settings: &settings::Settings,
    job: &crate::jobs::Job,
    system: Option<&str>,
    prompt: &str,
) -> Result<TextAnswer, AppError> {
    let groq_ready = settings.fallback_to_groq && keys::status(Provider::Groq).is_ok_and(|s| s == KeyStatus::Set);
    if !groq_ready {
        return Err(error);
    }
    let key = keys::require(Provider::Groq)?;
    job.progress("Gemini failed, asking Groq instead", 50.0);
    let answer = tokio::select! {
        () = job.cancelled() => return Err(AppError::cancelled()),
        answer = groq::chat(&key, &settings.groq_text_model, system, prompt) => answer,
    };
    match answer {
        Ok(text) => Ok(TextAnswer { text, provider: "groq".into() }),
        // Show the first problem (Gemini's), with the backup's problem in the details.
        Err(second) => Err(AppError::new(error.message.clone(), format!("{} | Groq backup also failed: {}", error.details, second.details()))),
    }
}
