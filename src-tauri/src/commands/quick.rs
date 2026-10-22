//! Quick Prompts: the Prompt Generator without a project. The session is one hidden project in its own
//! folder (`app_data/quick`), so every step works on it exactly as on a project; it is never listed.

use serde::Serialize;
use tauri::AppHandle;

use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::commands::projects::{quick_store, store, QUICK_ID};
use crate::project::{Project, ProjectSettings, ProjectSummary};
use crate::settings;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickOpen {
    pub project: Project,
    /// True when an earlier session was found (and not just made).
    pub restored: bool,
}

/// True when the person did anything in the session (so "restored" is worth saying).
fn has_content(project: &Project) -> bool {
    !project.script.trim().is_empty() || !project.words.is_empty() || !project.scenes.is_empty() || project.voice_path.is_some()
}

/// Opens the quick session, making an empty one the first time.
#[tauri::command]
pub async fn quick_open(app: AppHandle) -> Result<QuickOpen, AppError> {
    let store = quick_store(&app)?;
    run_blocking(move || match store.open(QUICK_ID) {
        Ok(project) => {
            let restored = has_content(&project);
            Ok(QuickOpen { project, restored })
        }
        Err(_) => {
            let defaults = ProjectSettings::from_app_settings(&settings::load(&app)?);
            Ok(QuickOpen { project: store.create_fixed(QUICK_ID, "Quick session", defaults)?, restored: false })
        }
    })
    .await
}

/// Starts a new, empty session. The style and the options of the old one are kept (they are the
/// "last used" ones of quick mode). The old files, including the voice, are deleted.
#[tauri::command]
pub async fn quick_reset(app: AppHandle) -> Result<Project, AppError> {
    let store = quick_store(&app)?;
    run_blocking(move || {
        let old = store.open(QUICK_ID).ok();
        store.delete(QUICK_ID)?;
        let defaults = ProjectSettings::from_app_settings(&settings::load(&app)?);
        let mut fresh = store.create_fixed(QUICK_ID, "Quick session", old.as_ref().map_or(defaults, |p| p.settings))?;
        if let Some(old) = old {
            fresh.style_id = old.style_id;
            fresh.prompt_settings = old.prompt_settings;
            store.save(fresh.clone())?;
        }
        Ok(fresh)
    })
    .await
}

/// Turns the quick session into a normal project (everything moves into it). Returns the new project.
#[tauri::command]
pub async fn quick_save_as_project(app: AppHandle, name: String) -> Result<ProjectSummary, AppError> {
    let quick = quick_store(&app)?;
    let main = store(&app)?;
    run_blocking(move || {
        let old = quick.open(QUICK_ID)?;
        let summary = quick.move_to(QUICK_ID, &main, &name)?;
        // A fresh session is ready for next time, with the same style and options ("last used" of quick mode).
        if let Ok(mut fresh) = quick.create_fixed(QUICK_ID, "Quick session", old.settings) {
            fresh.style_id = old.style_id;
            fresh.prompt_settings = old.prompt_settings;
            let _ = quick.save(fresh);
        }
        Ok(summary)
    })
    .await
}
