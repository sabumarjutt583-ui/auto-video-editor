//! Looks at small pictures of the scenes to find where the main subject is (graphics are placed away from it).
//! Uses the current text engine: the Gemini API, or the Gemini web chat when "text via chat" is on.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::api::gemini;
use crate::audio::paths::resolve;
use crate::commands::ai::chat_question;
use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::commands::projects::project_folder;
use crate::imagegen::chat::json_from_reply;
use crate::imagegen::ops::ImageGen;
use crate::jobs::{event_sink, JobRegistry};
use crate::keys::{self, Provider};
use crate::settings;

/// The web chat takes four pictures per question; the same limit is used for both engines.
pub const MAX_PICTURES: usize = 4;

/// Only the preview pictures the app made itself (`thumbs/<name>.jpg`) may be sent.
pub fn check_pictures(pictures: &[String]) -> Result<(), AppError> {
    if pictures.is_empty() || pictures.len() > MAX_PICTURES {
        return Err(AppError::new("Too many pictures were sent to the AI at once.", format!("{} pictures", pictures.len())));
    }
    for picture in pictures {
        if !picture.starts_with("thumbs/") || !picture.ends_with(".jpg") || picture.contains("..") {
            return Err(AppError::new("One of the pictures is not a preview picture of this project.", format!("not allowed: {picture}")));
        }
    }
    Ok(())
}

/// Asks the AI about up to four preview pictures of a project and returns its (JSON) answer text.
#[tauri::command]
pub async fn placement_ask(
    app: AppHandle,
    jobs: State<'_, JobRegistry>,
    ig: State<'_, Arc<ImageGen>>,
    project_id: String,
    system: String,
    prompt: String,
    pictures: Vec<String>,
    job_id: String,
) -> Result<String, AppError> {
    check_pictures(&pictures)?;
    let dir = project_folder(&app, &project_id)?;
    let paths: Vec<PathBuf> = pictures.iter().map(|p| resolve(&dir, p)).collect::<Result<_, _>>()?;
    let job = jobs.begin(&job_id, "placement", event_sink(app.clone()))?;
    let settings_app = app.clone();
    let settings = run_blocking(move || settings::load(&settings_app)).await?;
    if settings.text_via_chat {
        job.progress("Asking Gemini in the web chat", 10.0);
        let question = chat_question(Some(&system), &format!("{prompt}\nThe pictures are attached to this message, in order."), true);
        let reply = tokio::select! {
            () = job.cancelled() => return Err(AppError::cancelled()),
            reply = ig.chat_ask_images(&question, &paths) => reply?,
        };
        return Ok(json_from_reply(&reply).unwrap_or(reply.text));
    }
    let key = run_blocking(|| keys::require(Provider::Gemini)).await?;
    let mut parts = vec![serde_json::json!({ "text": prompt })];
    for path in &paths {
        let bytes = std::fs::read(path).map_err(|e| AppError::new("A preview picture could not be read.", e.to_string()))?;
        parts.push(gemini::image_part("image/jpeg", &bytes));
    }
    job.progress("Asking Gemini", 10.0);
    let answer = tokio::select! {
        () = job.cancelled() => return Err(AppError::cancelled()),
        answer = gemini::generate_parts(&key, &settings.gemini_model, Some(&system), parts, true) => answer,
    }?;
    Ok(answer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_preview_pictures_are_allowed() {
        assert!(check_pictures(&["thumbs/a.jpg".into()]).is_ok());
        assert!(check_pictures(&[]).is_err());
        assert!(check_pictures(&vec!["thumbs/a.jpg".to_string(); 5]).is_err());
        assert!(check_pictures(&["media/a.jpg".into()]).is_err());
        assert!(check_pictures(&["thumbs/../secret.jpg".into()]).is_err());
        assert!(check_pictures(&["thumbs/a.png".into()]).is_err());
    }
}
