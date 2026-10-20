//! Tauri commands of the Admin Edition. All of them start with `admin_`.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use super::freesound::{self, SearchPage};
use super::package::{self, BuiltPackage};
use super::process::{self, Trim};
use super::workspace::{self, Credit};
use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::commands::library::library_root;
use crate::commands::sfx::bundled_sfx_folder;
use crate::commands::styles::bundled_styles_dir;
use crate::jobs::{event_sink, JobRegistry};
use crate::library::manifest::Kind;
use crate::library::store;
use crate::sfx::{load_library, SfxEntry, SfxLibrary};

fn root(app: &AppHandle) -> Result<PathBuf, AppError> {
    let folder = app.path().app_data_dir().map_err(|e| AppError::new("The app data folder could not be found.", e.to_string()))?;
    Ok(folder.join("admin"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminOverview {
    pub key_set: bool,
    pub sfx_dir: String,
    pub packages_dir: String,
    pub next_sfx_version: u64,
    pub next_styles_version: u64,
    pub sounds: SfxLibrary,
    pub styles: Vec<StyleRow>,
}

#[derive(Serialize)]
pub struct StyleRow {
    pub id: String,
    pub name: String,
}

fn style_rows(root: &std::path::Path) -> Vec<StyleRow> {
    let mut warnings = Vec::new();
    crate::styles::load_dir(&workspace::styles_dir(root), true, &mut warnings).into_iter().map(|s| StyleRow { id: s.id, name: s.name }).collect()
}

fn overview_of(app: &AppHandle) -> Result<AdminOverview, AppError> {
    let root = root(app)?;
    let lib_root = library_root(app)?;
    let installed = |kind: Kind, bundled: &std::path::Path| store::status(&lib_root, kind, bundled).version;
    Ok(AdminOverview {
        key_set: freesound::key_is_set()?,
        sfx_dir: workspace::sfx_dir(&root).to_string_lossy().into_owned(),
        packages_dir: workspace::packages_dir(&root).to_string_lossy().into_owned(),
        next_sfx_version: workspace::next_version(&root, Kind::Sfx, installed(Kind::Sfx, &bundled_sfx_folder(app))),
        next_styles_version: workspace::next_version(&root, Kind::Styles, installed(Kind::Styles, &bundled_styles_dir(app))),
        sounds: if workspace::sfx_dir(&root).join("index.json").exists() { load_library(&workspace::sfx_dir(&root)) } else { SfxLibrary::default() },
        styles: style_rows(&root),
    })
}

#[tauri::command]
pub async fn admin_overview(app: AppHandle) -> Result<AdminOverview, AppError> {
    run_blocking(move || overview_of(&app)).await
}

#[tauri::command]
pub async fn admin_save_key(key: String) -> Result<(), AppError> {
    run_blocking(move || freesound::save_key(&key)).await
}

#[tauri::command]
pub async fn admin_delete_key() -> Result<(), AppError> {
    run_blocking(freesound::delete_key).await
}

#[tauri::command]
pub async fn admin_search(query: String, page: u32) -> Result<SearchPage, AppError> {
    freesound::search(&query, page).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddSound {
    pub freesound_id: u64,
    pub name: String,
    pub username: String,
    pub license: String,
    pub preview_url: String,
    pub category: String,
    pub tags: Vec<String>,
    pub trim_start: f64,
    pub trim_end: Option<f64>,
}

/// Downloads one CC0 sound, normalizes it and adds it to the library.
#[tauri::command]
pub async fn admin_add_sound(app: AppHandle, jobs: State<'_, JobRegistry>, request: AddSound, job_id: String) -> Result<SfxEntry, AppError> {
    if !freesound::is_cc0(&request.license) {
        return Err(AppError::new("Only CC0 sounds can be added.", request.license));
    }
    let dir = workspace::sfx_dir(&root(&app)?);
    let id = workspace::make_id(request.freesound_id, &request.name);
    let job = jobs.begin(&job_id, "admin-sound", event_sink(app))?;
    {
        let dir = dir.clone();
        run_blocking(move || std::fs::create_dir_all(&dir).map_err(|e| AppError::new("The admin folder could not be created.", e.to_string()))).await?;
    }
    if workspace::read_index(&dir)?.iter().any(|e| e.id == id) {
        return Err(AppError::new("This sound is already in your library.", id));
    }
    job.progress("Downloading the sound", 5.0);
    let bytes = freesound::download_preview(&request.preview_url).await?;
    job.check()?;
    let source = dir.join(format!(".download-{id}.mp3"));
    std::fs::write(&source, &bytes).map_err(|e| AppError::new("The sound could not be saved.", e.to_string()))?;
    let wav = dir.join(format!("{id}.wav"));
    let result = process::make_sound(&job, &source, &wav, Trim { start: request.trim_start, end: request.trim_end }).await;
    let _ = std::fs::remove_file(&source);
    let duration = match result {
        Ok(d) => d,
        Err(e) => {
            let _ = std::fs::remove_file(&wav);
            return Err(e);
        }
    };
    let entry = SfxEntry { id: id.clone(), file: format!("{id}.wav"), category: request.category, tags: workspace::clean_tags(&request.tags), duration, default_gain: 0.7 };
    let credit = Credit { id, freesound_id: request.freesound_id, name: request.name, username: request.username, license: request.license };
    if let Err(e) = workspace::register(&dir, entry.clone(), Some(credit)) {
        let _ = std::fs::remove_file(&wav);
        return Err(e);
    }
    Ok(entry)
}

#[tauri::command]
pub async fn admin_update_sound(app: AppHandle, id: String, category: String, tags: Vec<String>, gain: f64) -> Result<(), AppError> {
    let dir = workspace::sfx_dir(&root(&app)?);
    run_blocking(move || workspace::update(&dir, &id, &category, &tags, gain)).await
}

#[tauri::command]
pub async fn admin_remove_sound(app: AppHandle, id: String) -> Result<(), AppError> {
    let dir = workspace::sfx_dir(&root(&app)?);
    run_blocking(move || workspace::remove(&dir, &id)).await
}

/// Starts the working library from the sounds and styles that ship with the app (or the installed package).
#[tauri::command]
pub async fn admin_import_current(app: AppHandle) -> Result<AdminOverview, AppError> {
    let root = root(&app)?;
    let lib_root = library_root(&app)?;
    let sfx_from = store::active_dir(&lib_root, Kind::Sfx, &bundled_sfx_folder(&app));
    let styles_from = store::active_dir(&lib_root, Kind::Styles, &bundled_styles_dir(&app));
    run_blocking(move || {
        let sfx_to = workspace::sfx_dir(&root);
        if sfx_to.join("index.json").exists() {
            return Err(AppError::new("Your working library already has sounds, so nothing was copied.", "index.json exists"));
        }
        workspace::import_folder(&sfx_from, &sfx_to, |n| n.ends_with(".wav") || n == "index.json")?;
        workspace::import_folder(&styles_from, &workspace::styles_dir(&root), |n| n.ends_with(".json"))?;
        let thumbs_from = styles_from.join(crate::thumbnails::FOLDER);
        if thumbs_from.is_dir() {
            workspace::import_folder(&thumbs_from, &workspace::styles_dir(&root).join(crate::thumbnails::FOLDER), |n| n.ends_with(".webp"))?;
        }
        Ok(())
    })
    .await?;
    run_blocking(move || overview_of(&app)).await
}

#[tauri::command]
pub async fn admin_save_style(app: AppHandle, text: String) -> Result<String, AppError> {
    let dir = workspace::styles_dir(&root(&app)?);
    run_blocking(move || {
        let style = crate::styles::parse_style(&text).map_err(|why| AppError::new("That style is not valid.", why))?;
        if style.id.starts_with(crate::styles::CUSTOM_PREFIX) {
            return Err(AppError::new("Library style ids cannot start with \"custom_\".", style.id));
        }
        std::fs::create_dir_all(&dir).map_err(|e| AppError::new("The admin folder could not be created.", e.to_string()))?;
        std::fs::write(dir.join(format!("{}.json", style.id)), text).map_err(|e| AppError::new("The style could not be saved.", e.to_string()))?;
        Ok(style.id)
    })
    .await
}

#[tauri::command]
pub async fn admin_read_style(app: AppHandle, id: String) -> Result<String, AppError> {
    let dir = workspace::styles_dir(&root(&app)?);
    run_blocking(move || {
        if !crate::styles::valid_id(&id) {
            return Err(AppError::new("That style id is not valid.", id));
        }
        std::fs::read_to_string(dir.join(format!("{id}.json"))).map_err(|e| AppError::new("The style could not be read.", e.to_string()))
    })
    .await
}

#[tauri::command]
pub async fn admin_remove_style(app: AppHandle, id: String) -> Result<(), AppError> {
    let dir = workspace::styles_dir(&root(&app)?);
    run_blocking(move || {
        if !crate::styles::valid_id(&id) {
            return Err(AppError::new("That style id is not valid.", id));
        }
        std::fs::remove_file(dir.join(format!("{id}.json"))).map_err(|e| AppError::new("The style could not be removed.", e.to_string()))
    })
    .await
}

/// Builds a package of one kind into the packages folder (or `out_dir`).
#[tauri::command]
pub async fn admin_build_package(app: AppHandle, kind: Kind, out_dir: Option<String>) -> Result<BuiltPackage, AppError> {
    let overview = overview_of(&app)?;
    let root = root(&app)?;
    run_blocking(move || {
        let (source, version) = match kind {
            Kind::Sfx => (workspace::sfx_dir(&root), overview.next_sfx_version),
            Kind::Styles => (workspace::styles_dir(&root), overview.next_styles_version),
        };
        let out = out_dir.filter(|d| !d.trim().is_empty()).map(PathBuf::from).unwrap_or_else(|| workspace::packages_dir(&root));
        let built = package::build(kind, &source, &out, version, &package::today())?;
        workspace::record_version(&root, kind, version)?;
        Ok(built)
    })
    .await
}

#[derive(Deserialize)]
pub struct ThumbnailItem {
    pub id: String,
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailReport {
    pub imported: Vec<String>,
    /// File name and reason.
    pub failed: Vec<(String, String)>,
    /// Styles of the working copy that still have no thumbnail.
    pub missing: Vec<String>,
}

/// Where the style profiles of this checkout live, when the app runs from the source tree (development).
fn source_styles_dir() -> Option<PathBuf> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("resources").join("styles");
    (cfg!(debug_assertions) && dir.is_dir()).then_some(dir)
}

/// Crops, resizes and converts the chosen pictures to thumbnails in the working styles (which go into the next
/// package) and, when running from the source tree, in resources/styles too.
#[tauri::command]
pub async fn admin_import_thumbnails(app: AppHandle, items: Vec<ThumbnailItem>) -> Result<ThumbnailReport, AppError> {
    let workspace_dir = workspace::styles_dir(&root(&app)?);
    let pairs: Vec<(String, PathBuf)> = items.into_iter().map(|i| (i.id, PathBuf::from(i.path))).collect();
    let report = crate::thumbnails::import_into(&workspace_dir, &pairs).await;
    let mut primary = workspace_dir;
    if let Some(source) = source_styles_dir() {
        let done: Vec<(String, PathBuf)> = pairs.iter().filter(|(id, _)| report.imported.contains(id)).cloned().collect();
        crate::thumbnails::import_into(&source, &done).await;
        primary = source;
    }
    let missing = run_blocking(move || Ok(crate::thumbnails::missing_in(&primary))).await?;
    Ok(ThumbnailReport { imported: report.imported, failed: report.failed, missing })
}
