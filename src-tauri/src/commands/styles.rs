use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::styles::{self, StyleLibrary, StyleProfile};

fn custom_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let folder = app.path().app_data_dir().map_err(|e| AppError::new("The app data folder could not be found.", e.to_string()))?;
    Ok(folder.join("styles"))
}

/// The folder with the styles that ship with the app: the bundled resources, or the source tree when developing.
pub fn bundled_styles_dir(app: &AppHandle) -> PathBuf {
    if let Ok(resources) = app.path().resource_dir() {
        let bundled = resources.join("resources").join("styles");
        if bundled.is_dir() {
            return bundled;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("resources").join("styles")
}

/// Every style (built in and the user's), plus a warning for each file that was skipped.
#[tauri::command]
pub async fn list_styles(app: AppHandle) -> Result<StyleLibrary, AppError> {
    let custom = custom_dir(&app)?;
    let bundled = bundled_styles_dir(&app);
    let builtin = match crate::commands::library::library_root(&app) {
        Ok(root) => crate::library::store::active_dir(&root, crate::library::manifest::Kind::Styles, &bundled),
        Err(_) => bundled,
    };
    let log_dir = app.path().app_data_dir().ok().map(|d| d.join("logs"));
    run_blocking(move || {
        let library = styles::load_all(&builtin, &custom);
        for warning in &library.warnings {
            crate::logging::warn("styles", warning);
        }
        if let Some(dir) = log_dir {
            // Best effort: a short log of the last start, for people who ask why a style is missing.
            let _ = std::fs::create_dir_all(&dir);
            let _ = std::fs::write(dir.join("styles.log"), library.warnings.join("\n") + "\n");
        }
        Ok(library)
    })
    .await
}

#[tauri::command]
pub async fn save_custom_style(app: AppHandle, style: StyleProfile) -> Result<StyleProfile, AppError> {
    let custom = custom_dir(&app)?;
    run_blocking(move || styles::save_custom(&custom, style)).await
}

#[tauri::command]
pub async fn delete_custom_style(app: AppHandle, id: String) -> Result<(), AppError> {
    let custom = custom_dir(&app)?;
    run_blocking(move || styles::delete_custom(&custom, &id)).await
}

/// Makes the thumbnail of one of the user's own styles from a picture (any size; cropped to 4:3).
/// Returns the saved style with the thumbnail's full path.
#[tauri::command]
pub async fn set_custom_style_thumbnail(app: AppHandle, id: String, source: String) -> Result<StyleProfile, AppError> {
    let custom = custom_dir(&app)?;
    if !id.starts_with(styles::CUSTOM_PREFIX) || !styles::valid_id(&id) {
        return Err(AppError::new("Only your own styles can have their own picture.", format!("Not a custom style id: {id:?}")));
    }
    crate::thumbnails::convert(std::path::Path::new(&source), &custom.join(crate::thumbnails::rel_path(&id))).await?;
    run_blocking(move || {
        let file = custom.join(format!("{id}.json"));
        let text = std::fs::read_to_string(&file).map_err(|e| AppError::new("The style could not be read.", e.to_string()))?;
        let mut style = styles::parse_style(&text).map_err(|why| AppError::new("The style could not be read.", why))?;
        style.thumbnail = crate::thumbnails::rel_path(&id);
        styles::save_custom(&custom, style)
    })
    .await
}
