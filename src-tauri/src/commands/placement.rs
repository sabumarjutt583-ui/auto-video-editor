//! Looks at small pictures of the scenes to find where the main subject is (graphics are placed away from it).
//! Uses the Gemini API (all saved Gemini keys, the next one when a limit is reached).

use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::api::{gemini, rotate};
use crate::audio::paths::resolve;
use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::commands::projects::project_folder;
use crate::jobs::{event_sink, JobRegistry};
use crate::keys::Provider;
use crate::settings;

/// Pictures per question.
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
    let mut parts = vec![serde_json::json!({ "text": prompt })];
    for path in &paths {
        let bytes = std::fs::read(path).map_err(|e| AppError::new("A preview picture could not be read.", e.to_string()))?;
        parts.push(gemini::image_part("image/jpeg", &bytes));
    }
    job.progress("Asking Gemini", 10.0);
    let answer = tokio::select! {
        () = job.cancelled() => return Err(AppError::cancelled()),
        answer = rotate::run(Provider::Gemini, |key| {
            let (model, system, parts) = (settings.gemini_model.clone(), system.clone(), parts.clone());
            async move { gemini::generate_parts(&key, &model, Some(&system), parts, true).await }
        }) => answer,
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
