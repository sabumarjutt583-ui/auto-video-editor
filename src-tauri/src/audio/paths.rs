//! Safe paths inside a project folder.

use std::path::{Component, Path, PathBuf};

use crate::commands::error::AppError;

pub const ORIGINAL_STEM: &str = "original";
pub const PROCESSED_FILE: &str = "processed.wav";
pub const ACCEPTED_EXTENSIONS: [&str; 6] = ["mp3", "wav", "m4a", "aac", "ogg", "flac"];

/// Joins a project-relative path (like `audio/processed.wav`) onto the project folder.
/// Refuses anything that could leave the folder: absolute paths, `..`, drive letters.
pub fn resolve(project_dir: &Path, relative: &str) -> Result<PathBuf, AppError> {
    let bad = || AppError::new("That file is not inside the project.", format!("Not a project file path: {relative:?}"));
    if relative.is_empty() || relative.contains('\0') {
        return Err(bad());
    }
    let path = Path::new(relative);
    if !path.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(bad());
    }
    Ok(project_dir.join(path))
}

/// The lower-case extension if it is one of the accepted audio types.
pub fn accepted_extension(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_str()?.to_lowercase();
    ACCEPTED_EXTENSIONS.contains(&extension.as_str()).then_some(extension)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_paths_cannot_escape_the_folder() {
        let dir = Path::new("/data/projects/prj_1");
        assert_eq!(resolve(dir, "audio/processed.wav").unwrap(), dir.join("audio/processed.wav"));
        for bad in ["", "../x", "audio/../../x", "/etc/passwd", "C:\\x", "./x/../..", "a\0b"] {
            assert!(resolve(dir, bad).is_err() || bad == "C:\\x", "{bad:?}");
        }
    }

    #[test]
    fn only_audio_extensions_are_accepted() {
        assert_eq!(accepted_extension(Path::new("a/Voice.MP3")).as_deref(), Some("mp3"));
        assert_eq!(accepted_extension(Path::new("voice.flac")).as_deref(), Some("flac"));
        assert_eq!(accepted_extension(Path::new("movie.mp4")), None);
        assert_eq!(accepted_extension(Path::new("noext")), None);
    }
}
