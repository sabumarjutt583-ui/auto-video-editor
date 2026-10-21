//! Motion graphics written by the AI (see `motion/`).

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::commands::error::AppError;
use crate::commands::projects::project_folder;
use crate::imagegen::ops::ImageGen;
use crate::jobs::{event_sink, JobRegistry};
use crate::motion::generate::{generate, MotionRequest, MotionResult};

/// Asks Gemini (web chat, no API key) for a motion graphic, checks it and draws its frames.
#[tauri::command]
pub async fn motion_generate(app: AppHandle, jobs: State<'_, JobRegistry>, ig: State<'_, Arc<ImageGen>>, project_id: String, request: MotionRequest, job_id: String) -> Result<MotionResult, AppError> {
    let project_dir = project_folder(&app, &project_id)?;
    request.validate()?;
    let exe = ig.browser_exe()?;
    let args = ig.browser_args();
    let job = jobs.begin(&job_id, "motion", event_sink(app))?;
    crate::logging::info("motion", &format!("Motion graphic {} started ({:.1} s)", request.id, request.seconds));
    let chat = Arc::clone(ig.inner());
    let ask = move |prompt: String| -> crate::imagegen::engine::BoxFuture<Result<crate::imagegen::chat::ChatReply, AppError>> {
        let chat = Arc::clone(&chat);
        Box::pin(async move { chat.chat_ask(&prompt).await })
    };
    let result = generate(&request, &project_dir, exe, args, &ask, &job).await;
    if let Err(error) = &result {
        crate::logging::warn("motion", &error.details);
    }
    result
}
