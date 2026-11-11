use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::api::{gemini, groq, rotate};
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextOptions {
    text_provider: String,
    gemini_model: String,
    groq_text_model: String,
    fallback_to_groq: bool,
}

impl TextOptions {
    fn apply(self, settings: &mut settings::Settings) -> Result<(), AppError> {
        if self.text_provider != "gemini" && self.text_provider != "groq" {
            return Err(AppError::new("Unknown text provider.", self.text_provider));
        }
        settings.text_provider = self.text_provider;
        settings.gemini_model = self.gemini_model;
        settings.groq_text_model = self.groq_text_model;
        settings.fallback_to_groq = self.fallback_to_groq;
        Ok(())
    }
}

/// Asks the chosen writer (Gemini or Groq, set in Settings) for text. With several keys of that provider the next key
/// is used when one hits its limit. When every key fails and the backup is switched on, the other provider is asked.
/// Used for scene grouping, the character bible and prompt writing. Can be cancelled.
#[tauri::command]
pub async fn generate_text(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    system: Option<String>,
    prompt: String,
    json: bool,
    job_id: String,
    options: Option<TextOptions>,
) -> Result<TextAnswer, AppError> {
    let job = jobs.begin(&job_id, "ai", event_sink(app.clone()))?;
    let mut settings = run_blocking(move || settings::load(&app)).await?;
    if let Some(options) = options { options.apply(&mut settings)?; }
    let system = system.as_deref();
    let first = if settings.text_provider == "groq" { Provider::Groq } else { Provider::Gemini };

    job.progress(&format!("Asking {}", name_of(first)), 5.0);
    let answer = tokio::select! {
        () = job.cancelled() => return Err(AppError::cancelled()),
        answer = ask(first, &settings, system, &prompt, json) => answer,
    };
    match answer {
        Ok(text) => Ok(TextAnswer { text, provider: name_of(first).to_lowercase() }),
        Err(error) => {
            let other = if first == Provider::Groq { Provider::Gemini } else { Provider::Groq };
            let other_ready = settings.fallback_to_groq && keys::status(other).is_ok_and(|s| s == KeyStatus::Set);
            if !other_ready {
                return Err(error);
            }
            job.progress(&format!("{} failed, asking {} instead", name_of(first), name_of(other)), 50.0);
            let second = tokio::select! {
                () = job.cancelled() => return Err(AppError::cancelled()),
                answer = ask(other, &settings, system, &prompt, json) => answer,
            };
            match second {
                Ok(text) => Ok(TextAnswer { text, provider: name_of(other).to_lowercase() }),
                // Show the first problem, with the backup's problem in the details.
                Err(second) => Err(AppError::new(error.message.clone(), format!("{} | {} backup also failed: {}", error.details, name_of(other), second.details))),
            }
        }
    }
}

fn name_of(provider: Provider) -> &'static str {
    match provider {
        Provider::Groq => "Groq",
        Provider::Gemini => "Gemini",
        Provider::OpenAi => "OpenAI",
    }
}

/// One text request to one provider, over all its saved keys.
async fn ask(provider: Provider, settings: &settings::Settings, system: Option<&str>, prompt: &str, json: bool) -> Result<String, AppError> {
    match provider {
        Provider::Gemini => rotate::run(provider, |key| async move { gemini::generate(&key, &settings.gemini_model, system, prompt, json).await }).await,
        Provider::Groq => rotate::run(provider, |key| async move { groq::chat(&key, &settings.groq_text_model, system, prompt).await }).await,
        Provider::OpenAi => Err(AppError::new("OpenAI does not write the texts.", "text provider openai")),
    }
}

/// The web chat has no separate "system instruction" or "JSON mode", so both go into the question.
/// (Used by the style analysis, which can still ask the web chat about pictures.)
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

#[cfg(test)]
mod tests {
    use super::{chat_question, TextOptions};

    #[test]
    fn frozen_text_choices_override_live_defaults_without_saving_them() {
        let mut settings = crate::settings::Settings::default();
        TextOptions { text_provider: "groq".into(), gemini_model: "saved-gemini".into(),
            groq_text_model: "saved-groq".into(), fallback_to_groq: false }.apply(&mut settings).unwrap();
        assert_eq!(settings.text_provider, "groq");
        assert_eq!(settings.gemini_model, "saved-gemini");
        assert_eq!(settings.groq_text_model, "saved-groq");
        assert!(!settings.fallback_to_groq);
        assert!(TextOptions { text_provider: "unknown".into(), gemini_model: "x".into(),
            groq_text_model: "x".into(), fallback_to_groq: true }.apply(&mut settings).is_err());
    }

    #[test]
    fn the_chat_question_carries_instructions_task_and_json_rule() {
        let q = chat_question(Some(" Be short. "), " Split this. ", true);
        assert!(q.starts_with("INSTRUCTIONS (follow them exactly):\nBe short.\n\nTASK:\nSplit this."));
        assert!(q.ends_with("```json code block. No other text."));
        assert_eq!(chat_question(None, "Hi", false), "Hi");
        assert_eq!(chat_question(Some("  "), "Hi", false), "Hi");
    }
}
