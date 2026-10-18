use tauri::{AppHandle, Manager};

use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::project::{Project, ProjectList, ProjectSettings, ProjectStore, ProjectSummary};
use crate::settings;

pub fn store(app: &AppHandle) -> Result<ProjectStore, AppError> {
    let folder = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::new("The app data folder could not be found.", e.to_string()))?;
    Ok(ProjectStore::new(folder.join("projects")))
}

/// The folder of a project (checked to be a plain project id).
pub fn project_folder(app: &AppHandle, id: &str) -> Result<std::path::PathBuf, AppError> {
    store(app)?.folder(id)
}

/// Makes a new project using the defaults from Settings. Does not open it.
#[tauri::command]
pub async fn create_project(app: AppHandle, name: String) -> Result<Project, AppError> {
    let store = store(&app)?;
    run_blocking(move || {
        let defaults = ProjectSettings::from_app_settings(&settings::load(&app)?);
        store.create(&name, defaults)
    })
    .await
}

#[tauri::command]
pub async fn list_projects(app: AppHandle) -> Result<ProjectList, AppError> {
    let store = store(&app)?;
    run_blocking(move || store.list()).await
}

#[tauri::command]
pub async fn open_project(app: AppHandle, id: String) -> Result<Project, AppError> {
    let store = store(&app)?;
    run_blocking(move || store.open(&id)).await
}

/// Saves the project and returns its new `updatedAt`.
#[tauri::command]
pub async fn save_project(app: AppHandle, project: Project) -> Result<String, AppError> {
    let store = store(&app)?;
    run_blocking(move || store.save(project)).await
}

#[tauri::command]
pub async fn rename_project(app: AppHandle, id: String, name: String) -> Result<ProjectSummary, AppError> {
    let store = store(&app)?;
    run_blocking(move || store.rename(&id, &name)).await
}

#[tauri::command]
pub async fn delete_project(app: AppHandle, id: String) -> Result<(), AppError> {
    let store = store(&app)?;
    run_blocking(move || store.delete(&id)).await
}

#[tauri::command]
pub async fn duplicate_project(app: AppHandle, id: String) -> Result<ProjectSummary, AppError> {
    let store = store(&app)?;
    run_blocking(move || store.duplicate(&id)).await
}
