//! Commands of the Image Generator page. Heavy work (browsers, API calls, saving) runs in Rust;
//! the page only sends scenes and shows the state it receives as `imagegen-state` events.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::error::AppError;
use crate::commands::library::library_root;
use crate::commands::projects::project_folder;
use crate::imagegen::browser::locator;
use crate::imagegen::config::EngineConfig;
use crate::imagegen::engine::{Sink, Snapshot};
use crate::imagegen::mapping::check_jobs;
use crate::imagegen::ops::{ImageGen, TestImage};
use crate::imagegen::queue::{AddReport, NewJob};
use crate::imagegen::settings::ImageGenSettings;
use crate::library::manifest::Kind;
use crate::library::store;

pub type Ig<'a> = State<'a, Arc<ImageGen>>;

struct AppSink(AppHandle);

impl Sink for AppSink {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        let _ = self.0.emit(event, payload);
    }
}

/// The folder with the settings file that ships with the app.
pub fn bundled_image_engine_dir(app: &AppHandle) -> PathBuf {
    if let Ok(resources) = app.path().resource_dir() {
        let bundled = resources.join("resources").join("image-engine");
        if bundled.is_dir() {
            return bundled;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("resources").join("image-engine")
}

/// The engine settings in use: a downloaded package when it is newer than the built-in one.
pub fn load_engine_config(app: &AppHandle) -> EngineConfig {
    let bundled = bundled_image_engine_dir(app);
    if let Ok(root) = library_root(app) {
        let active = store::active_dir(&root, Kind::ImageEngine, &bundled);
        if let Ok(text) = std::fs::read_to_string(active.join("config.json")) {
            if let Ok(config) = EngineConfig::parse(&text) {
                return config;
            }
        }
    }
    EngineConfig::bundled()
}

/// Creates the engine and starts its background work. Called once at start-up.
pub fn create(app: &AppHandle) -> Result<Arc<ImageGen>, AppError> {
    let dir = app.path().app_data_dir().map_err(|e| AppError::new("The app data folder could not be found.", e.to_string()))?.join("imagegen");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::new("The image generator folder could not be created.", e.to_string()))?;
    Ok(ImageGen::new(dir, Arc::new(AppSink(app.clone())), load_engine_config(app)))
}

/// Brings the engine settings up to date after a library update.
pub async fn reload_config(app: &AppHandle, ig: &Arc<ImageGen>) {
    let config = load_engine_config(app);
    if config != *ig.engine.config() {
        ig.set_config(config).await;
    }
}

#[tauri::command]
pub async fn imagegen_state(ig: Ig<'_>) -> Result<Snapshot, AppError> {
    Ok(ig.engine.snapshot())
}

#[tauri::command]
pub async fn imagegen_set_settings(ig: Ig<'_>, settings: ImageGenSettings) -> Result<(), AppError> {
    ig.set_settings(settings).await
}

#[tauri::command]
pub async fn imagegen_accept_consent(ig: Ig<'_>) -> Result<(), AppError> {
    ig.engine.accept_consent()
}

#[tauri::command]
pub async fn imagegen_detect_browser(ig: Ig<'_>) -> Result<Option<String>, AppError> {
    let chosen = ig.engine.settings().browser_path;
    Ok(locator::find(Some(&chosen)).map(|p| p.display().to_string()))
}

#[tauri::command]
pub async fn imagegen_add_account(ig: Ig<'_>, name: String) -> Result<String, AppError> {
    Ok(ig.add_account(&name))
}

#[tauri::command]
pub async fn imagegen_update_account(ig: Ig<'_>, id: String, name: Option<String>, enabled: Option<bool>) -> Result<(), AppError> {
    if ig.engine.with_accounts(|accounts, _| accounts.update(&id, name.as_deref(), enabled)) {
        Ok(())
    } else {
        Err(AppError::new("That account does not exist any more.", id))
    }
}

#[tauri::command]
pub async fn imagegen_remove_account(ig: Ig<'_>, id: String) -> Result<(), AppError> {
    ig.remove_account(&id).await
}

#[tauri::command]
pub async fn imagegen_sign_in(ig: Ig<'_>, id: String) -> Result<(), AppError> {
    ig.sign_in(&id).await
}

#[tauri::command]
pub async fn imagegen_finish_sign_in(ig: Ig<'_>, id: String) -> Result<(), AppError> {
    ig.finish_sign_in(&id);
    Ok(())
}

#[tauri::command]
pub async fn imagegen_verify(ig: Ig<'_>, id: String) -> Result<(), AppError> {
    ig.verify(&id).await
}

#[tauri::command]
pub async fn imagegen_test_image(ig: Ig<'_>, id: String) -> Result<TestImage, AppError> {
    ig.test_image(&id).await
}

#[tauri::command]
pub async fn imagegen_background_snapshot(ig: Ig<'_>, id: String) -> Result<Option<String>, AppError> {
    Ok(ig.background_snapshot(&id).await)
}

#[tauri::command]
pub async fn imagegen_show_browser(ig: Ig<'_>, id: String) -> Result<bool, AppError> {
    Ok(ig.show_background_browser(&id).await)
}

/// Queues one picture per scene. `start` = begin working at once. `force` = make a new picture for
/// scenes that already have one.
#[tauri::command]
pub async fn imagegen_start(app: AppHandle, ig: Ig<'_>, project_id: String, jobs: Vec<NewJob>, force: bool, start: bool) -> Result<AddReport, AppError> {
    let jobs = check_jobs(jobs)?;
    let dir = project_folder(&app, &project_id)?;
    let engine = ig.engine.clone();
    crate::commands::blocking::run_blocking(move || engine.start(&dir, jobs, force, start)).await
}

#[tauri::command]
pub async fn imagegen_pause(ig: Ig<'_>) -> Result<(), AppError> {
    ig.engine.pause();
    Ok(())
}

#[tauri::command]
pub async fn imagegen_resume(ig: Ig<'_>) -> Result<(), AppError> {
    ig.engine.resume();
    Ok(())
}

#[tauri::command]
pub async fn imagegen_retry_failed(ig: Ig<'_>, ids: Vec<String>) -> Result<usize, AppError> {
    Ok(ig.engine.retry_failed(&ids))
}

#[tauri::command]
pub async fn imagegen_remove_jobs(ig: Ig<'_>, ids: Vec<String>) -> Result<usize, AppError> {
    Ok(ig.engine.remove_jobs(&ids))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub path: String,
    pub name: String,
    pub kind: &'static str,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub modified: u64,
}

/// Size and date of pictures the generator saved (`None` for a file that is not there). Used to put
/// pictures into the Auto Editor when the page missed the "picture saved" event (for example after a restart).
#[tauri::command]
pub async fn imagegen_media_info(app: AppHandle, project_id: String, paths: Vec<String>) -> Result<Vec<Option<MediaInfo>>, AppError> {
    let dir = project_folder(&app, &project_id)?;
    crate::commands::blocking::run_blocking(move || {
        use std::io::Read;
        Ok(paths
            .iter()
            .map(|relative| {
                let plain = relative.strip_prefix("media/").is_some_and(|name| !name.is_empty() && !name.contains(['/', '\\']) && !name.starts_with('.'));
                if !plain {
                    return None;
                }
                let path = dir.join(relative);
                let meta = std::fs::metadata(&path).ok().filter(|m| m.is_file() && m.len() > 0)?;
                let mut head = vec![0u8; 256];
                let read = std::fs::File::open(&path).and_then(|mut f| f.read(&mut head)).unwrap_or(0);
                let (width, height) = crate::imagegen::save::png_size(&head[..read]).unwrap_or((0, 0));
                let modified = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
                Some(MediaInfo { path: relative.clone(), name: relative.trim_start_matches("media/").to_string(), kind: "image", width, height, duration: 0.0, modified })
            })
            .collect())
    })
    .await
}

/// Re-reads the engine settings (after "Check for updates" in Settings).
#[tauri::command]
pub async fn imagegen_reload_config(app: AppHandle, ig: Ig<'_>) -> Result<String, AppError> {
    reload_config(&app, ig.inner()).await;
    Ok(ig.engine.config().config_version.clone())
}
