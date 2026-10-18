//! Turns dropped files and folders into a list of media files.

use std::path::{Path, PathBuf};

use super::kind_of;

const MAX_DEPTH: usize = 3;
const MAX_FILES: usize = 5000;

fn hidden(path: &Path) -> bool {
    path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with('.'))
}

fn walk(folder: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(folder) else { return };
    let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
    paths.sort();
    for path in paths {
        if out.len() >= MAX_FILES || hidden(&path) {
            continue;
        }
        if path.is_dir() {
            if depth < MAX_DEPTH {
                walk(&path, depth + 1, out);
            }
        } else if kind_of(&path).is_some() {
            out.push(path);
        }
    }
}

/// Files stay as they are (when they are images or videos); folders are searched a few levels deep.
/// The result has no duplicates. The second value lists dropped files that are not images or videos.
pub fn expand(paths: &[String]) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut found = Vec::new();
    let mut skipped = Vec::new();
    for raw in paths {
        let path = PathBuf::from(raw);
        if path.is_dir() {
            walk(&path, 0, &mut found);
        } else if path.is_file() {
            if kind_of(&path).is_some() {
                found.push(path);
            } else {
                skipped.push(path);
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    found.retain(|p| seen.insert(p.clone()));
    found.truncate(MAX_FILES);
    (found, skipped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folders_are_searched_and_other_files_are_skipped() {
        let dir = std::env::temp_dir().join("ave-expand-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        for name in ["a.png", "b.MP4", "notes.txt", "sub/c.webp", ".hidden.png"] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }
        let single = dir.join("a.png").to_string_lossy().into_owned();
        let (found, skipped) = expand(&[dir.to_string_lossy().into_owned(), single, dir.join("notes.txt").to_string_lossy().into_owned()]);
        let names: Vec<String> = found.iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(names, vec!["a.png", "b.MP4", "c.webp"], "sorted, no duplicates, no hidden files");
        assert_eq!(skipped.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
