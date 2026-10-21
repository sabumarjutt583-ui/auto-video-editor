use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::api::error::ApiError;
use crate::api::{gemini, groq};
use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::imagegen::chat::json_from_reply;
use crate::imagegen::ops::ImageGen;
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
    ig: State<'_, Arc<ImageGen>>,
    system: Option<String>,
    prompt: String,
    json: bool,
    job_id: String,
) -> Result<TextAnswer, AppError> {
    let job = jobs.begin(&job_id, "ai", event_sink(app.clone()))?;
    let app_for_settings = app.clone();
    let settings = run_blocking(move || settings::load(&app_for_settings)).await?;
    if settings.text_via_chat {
        job.progress("Asking Gemini in the web chat", 5.0);
        let question = chat_question(system.as_deref(), &prompt, json);
        let reply = tokio::select! {
            () = job.cancelled() => return Err(AppError::cancelled()),
            reply = ig.chat_ask(&question) => reply?,
        };
        let text = if json { json_from_reply(&reply).unwrap_or(reply.text) } else { reply.text };
        return Ok(TextAnswer { text, provider: "chat".into() });
    }
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

/// The chat has no separate "system instruction" or "JSON mode", so both go into the question.
pub fn chat_question(system: Option<&str>, prompt: &str, json: bool) -> String {
    let mut out = String::new();
    if let Some(system) = system.filter(|s| !s.trim().is_empty()) {
        out.push_str("INSTRUCTIONS (follow them exactly):\n");
        out.push_str(system.trim());
        out.push_str("\n\nTASK:\n");
    }
    out.push_str(prompt.trim());
    if json {
        out.push_str("\n\nAnswer with the JSON only, inside one ```json code block. No other text.");
    }
    out
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

#[cfg(test)]
mod tests {
    use super::chat_question;

    #[test]
    fn the_chat_question_carries_instructions_task_and_json_rule() {
        let q = chat_question(Some(" Be short. "), " Split this. ", true);
        assert!(q.starts_with("INSTRUCTIONS (follow them exactly):\nBe short.\n\nTASK:\nSplit this."));
        assert!(q.ends_with("```json code block. No other text."));
        assert_eq!(chat_question(None, "Hi", false), "Hi");
        assert_eq!(chat_question(Some("  "), "Hi", false), "Hi");
    }
}
