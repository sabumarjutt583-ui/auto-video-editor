use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;
use crate::library::manifest::Kind;
use crate::sfx::{load_library, SfxLibrary};

/// The folder with the sound effects in use: a downloaded package when it is newer, otherwise the built-in ones.
pub fn sfx_folder(app: &AppHandle) -> PathBuf {
    let bundled = bundled_sfx_folder(app);
    match crate::commands::library::library_root(app) {
        Ok(root) => crate::library::store::active_dir(&root, Kind::Sfx, &bundled),
        Err(_) => bundled,
    }
}

/// The sound effects that ship inside the app: the bundled resources, or the source tree when developing.
pub fn bundled_sfx_folder(app: &AppHandle) -> PathBuf {
    if let Ok(resources) = app.path().resource_dir() {
        let bundled = resources.join("resources").join("sfx");
        if bundled.join("index.json").is_file() {
            return bundled;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("resources").join("sfx")
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SfxListing {
    /// Folder with the sound files (the preview plays them from here).
    pub dir: String,
    #[serde(flatten)]
    pub library: SfxLibrary,
}

/// Every built-in sound effect, with a warning for each entry that was skipped.
#[tauri::command]
pub async fn list_sfx(app: AppHandle) -> Result<SfxListing, AppError> {
    let dir = sfx_folder(&app);
    run_blocking(move || {
        let library = load_library(&dir);
        for warning in &library.warnings {
            crate::logging::warn("sfx", warning);
        }
        Ok(SfxListing { dir: dir.to_string_lossy().into_owned(), library })
    })
    .await
}
