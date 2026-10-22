//! Deleting generated pictures: the files go to the system Recycle Bin / Trash (never deleted for good), and the
//! queue entries are removed so the same pictures are not generated or saved again, also after a restart.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// Moves a file to the Recycle Bin. A trait so tests do not touch the real bin.
pub trait Disposer {
    fn dispose(&self, path: &Path) -> Result<(), String>;
}

pub struct SystemTrash;

impl Disposer for SystemTrash {
    fn dispose(&self, path: &Path) -> Result<(), String> {
        trash::delete(path).map_err(|e| e.to_string())
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteReport {
    /// Relative paths (`media/NAME.png`) that went to the Recycle Bin.
    pub trashed: Vec<String>,
    /// Files that were already gone.
    pub missing: Vec<String>,
    /// Files that could not be moved, with the reason.
    pub failed: Vec<String>,
}

/// `media/NAME` with a plain file name, nothing else (so the page cannot ask for other files).
pub fn plain_media_path(relative: &str) -> Option<&str> {
    relative.strip_prefix("media/").filter(|name| !name.is_empty() && !name.contains(['/', '\\']) && !name.starts_with('.') && *name != "..")
}

/// Moves the given pictures of `dir/media` to the Recycle Bin.
pub fn trash_pictures(dir: &Path, files: &[String], disposer: &dyn Disposer) -> DeleteReport {
    let mut report = DeleteReport::default();
    for relative in files {
        let Some(name) = plain_media_path(relative) else {
            report.failed.push(format!("{relative}: not a picture of this project"));
            continue;
        };
        let path: PathBuf = dir.join("media").join(name);
        if !path.is_file() {
            report.missing.push(relative.clone());
            continue;
        }
        match disposer.dispose(&path) {
            Ok(()) => report.trashed.push(relative.clone()),
            Err(error) => report.failed.push(format!("{relative}: {error}")),
        }
    }
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Fake {
        moved: RefCell<Vec<PathBuf>>,
        fail: bool,
    }

    impl Disposer for Fake {
        fn dispose(&self, path: &Path) -> Result<(), String> {
            if self.fail {
                return Err("denied".into());
            }
            self.moved.borrow_mut().push(path.to_path_buf());
            std::fs::remove_file(path).map_err(|e| e.to_string())
        }
    }

    fn dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ave-del-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("media")).unwrap();
        dir
    }

    #[test]
    fn only_plain_media_paths_are_accepted() {
        assert_eq!(plain_media_path("media/S01_000.0-005.0.png"), Some("S01_000.0-005.0.png"));
        for bad in ["S01.png", "media/", "media/../x.png", "media/a/b.png", "media\\a.png", "/etc/passwd", "media/.hidden", "media/..\\x"] {
            assert_eq!(plain_media_path(bad), None, "{bad}");
        }
    }

    #[test]
    fn pictures_go_to_the_bin_and_the_report_tells_what_happened() {
        let dir = dir("ok");
        std::fs::write(dir.join("media/a.png"), b"x").unwrap();
        std::fs::write(dir.join("media/b.png"), b"x").unwrap();
        let fake = Fake { moved: RefCell::new(vec![]), fail: false };
        let report = trash_pictures(&dir, &["media/a.png".into(), "media/gone.png".into(), "../evil.png".into()], &fake);
        assert_eq!(report.trashed, ["media/a.png"]);
        assert_eq!(report.missing, ["media/gone.png"]);
        assert_eq!(report.failed.len(), 1);
        assert!(dir.join("media/b.png").exists(), "other pictures stay");
        assert!(!dir.join("media/a.png").exists());
        let denied = trash_pictures(&dir, &["media/b.png".into()], &Fake { moved: RefCell::new(vec![]), fail: true });
        assert!(denied.trashed.is_empty() && denied.failed[0].contains("denied"));
        assert!(dir.join("media/b.png").exists(), "a failed move deletes nothing");
        let _ = std::fs::remove_dir_all(dir);
    }
}
