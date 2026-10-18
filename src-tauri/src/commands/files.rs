use std::path::{Path, PathBuf};

use crate::commands::blocking::run_blocking;
use crate::commands::error::AppError;

const MAX_EXPORT_BYTES: usize = 20 * 1024 * 1024;
const ALLOWED_EXTENSIONS: [&str; 5] = ["txt", "csv", "json", "srt", "vtt"];

/// Saves an export (prompts as TXT, CSV or JSON) to the place the user chose in the save dialog.
#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> Result<(), AppError> {
    run_blocking(move || write_export(Path::new(&path), &content)).await
}

pub fn write_export(path: &Path, content: &str) -> Result<(), AppError> {
    let extension = path.extension().and_then(|e| e.to_str()).map(str::to_lowercase).unwrap_or_default();
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Err(AppError::new("Only .txt, .csv, .json, .srt and .vtt files can be saved here.", format!("Refused extension: {extension:?}")));
    }
    if content.len() > MAX_EXPORT_BYTES {
        return Err(AppError::new("The export is too big to save.", format!("{} bytes", content.len())));
    }
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if name.is_empty() {
        return Err(AppError::new("Please choose a file name.", "empty file name"));
    }
    let temp: PathBuf = path.with_file_name(format!(".{name}.saving"));
    std::fs::write(&temp, content).map_err(|e| AppError::new("The file could not be saved. Please check the folder and try again.", format!("{e} ({})", temp.display())))?;
    std::fs::rename(&temp, path).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        AppError::new("The file could not be saved. Please check the folder and try again.", format!("{e} ({})", path.display()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_text_including_non_latin_and_replaces_existing_files() {
        let path = std::env::temp_dir().join(format!("ave-export-{}.csv", std::process::id()));
        write_export(&path, "한국어,日本語\n").unwrap();
        write_export(&path, "second\n").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "second\n");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn other_file_types_and_missing_folders_are_refused() {
        assert!(write_export(Path::new("/tmp/x.exe"), "a").is_err());
        assert!(write_export(Path::new("/tmp/noext"), "a").is_err());
        assert!(write_export(Path::new("/definitely/not/here/x.txt"), "a").is_err());
    }
}
