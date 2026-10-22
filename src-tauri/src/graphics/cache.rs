//! Cache of drawn graphic clips. The key is a SHA-256 of everything that changes the picture (spec, renderer version, brand
//! kit, fonts, assets, size, fps), made in TypeScript. A hit copies the cached clip into the project instead of drawing every frame again.
//! Entries are `<key>.mov` + `<key>.json` (frames, width, height). The folder is limited to 5 GB: the least recently used entries go first.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;

use crate::commands::error::AppError;
use crate::graphics::export::GraphicClip;

pub const LIMIT_BYTES: u64 = 5 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo {
    pub bytes: u64,
    pub files: u32,
    pub limit_bytes: u64,
}

fn bad(message: &str, details: String) -> AppError {
    AppError::new(message, details)
}

/// A key is 64 lower-case hex characters (so it can never leave the cache folder).
pub fn valid_key(key: &str) -> bool {
    key.len() == 64 && key.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn clip_file(dir: &Path, key: &str) -> PathBuf {
    dir.join(format!("{key}.mov"))
}
fn meta_file(dir: &Path, key: &str) -> PathBuf {
    dir.join(format!("{key}.json"))
}

fn check_key(key: &str) -> Result<(), AppError> {
    if valid_key(key) { Ok(()) } else { Err(bad("The graphic cache was asked in a wrong way.", format!("invalid key: {key}"))) }
}

/// Copies a cached clip to `<project>/graphics/<id>/clip.mov` and returns it, or None when the key is not in the cache.
pub fn restore(cache: &Path, key: &str, project_dir: &Path, graphic_id: &str) -> Result<Option<GraphicClip>, AppError> {
    check_key(key)?;
    if !crate::graphics::export::valid_graphic_id(graphic_id) {
        return Err(bad("The graphic has a wrong name.", format!("graphic id = {graphic_id:?}")));
    }
    let (clip, meta) = (clip_file(cache, key), meta_file(cache, key));
    if !clip.is_file() || !meta.is_file() {
        return Ok(None);
    }
    let Ok(text) = std::fs::read_to_string(&meta) else { return Ok(None) };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else { return Ok(None) };
    let field = |name: &str| value.get(name).and_then(|v| v.as_u64()).map(|v| v as u32);
    let (Some(frames), Some(width), Some(height)) = (field("frames"), field("width"), field("height")) else { return Ok(None) };

    let folder = project_dir.join("graphics").join(graphic_id);
    std::fs::create_dir_all(&folder).map_err(|e| bad("The graphic could not be copied from the cache.", e.to_string()))?;
    let (tmp, done) = (folder.join("clip.mov.tmp"), folder.join("clip.mov"));
    if std::fs::copy(&clip, &tmp).is_err() || std::fs::rename(&tmp, &done).is_err() {
        let _ = std::fs::remove_file(&tmp);
        return Ok(None); // a broken cache entry is just a miss
    }
    touch(&clip);
    touch(&meta);
    let size_bytes = std::fs::metadata(&done).map(|m| m.len()).unwrap_or(0);
    Ok(Some(GraphicClip { path: format!("graphics/{graphic_id}/clip.mov"), frames, width, height, size_bytes }))
}

/// Keeps a finished clip of the project in the cache, then trims the cache to `limit` bytes.
pub fn store(cache: &Path, key: &str, project_dir: &Path, clip: &GraphicClip, limit: u64) -> Result<(), AppError> {
    check_key(key)?;
    let source = project_dir.join(&clip.path);
    if !source.is_file() || clip.path.contains("..") {
        return Err(bad("The graphic could not be kept in the cache.", format!("missing clip: {}", clip.path)));
    }
    std::fs::create_dir_all(cache).map_err(|e| bad("The graphic cache folder could not be made.", e.to_string()))?;
    let (target, tmp) = (clip_file(cache, key), cache.join(format!("{key}.tmp")));
    std::fs::copy(&source, &tmp).map_err(|e| bad("The graphic could not be kept in the cache.", e.to_string()))?;
    std::fs::rename(&tmp, &target).map_err(|e| { let _ = std::fs::remove_file(&tmp); bad("The graphic could not be kept in the cache.", e.to_string()) })?;
    // The description goes last: an entry without it is ignored.
    let meta = serde_json::json!({ "frames": clip.frames, "width": clip.width, "height": clip.height });
    std::fs::write(meta_file(cache, key), meta.to_string()).map_err(|e| bad("The graphic could not be kept in the cache.", e.to_string()))?;
    trim(cache, limit);
    Ok(())
}

fn touch(path: &Path) {
    if let Ok(file) = std::fs::OpenOptions::new().write(true).open(path) {
        let _ = file.set_modified(SystemTime::now());
    }
}

fn entries(cache: &Path) -> Vec<(PathBuf, u64, SystemTime)> {
    let Ok(read) = std::fs::read_dir(cache) else { return Vec::new() };
    read.flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            meta.is_file().then(|| (e.path(), meta.len(), meta.modified().unwrap_or(SystemTime::UNIX_EPOCH)))
        })
        .collect()
}

/// Removes the least recently used clips until the folder is at most `limit` bytes (a clip and its description go together).
pub fn trim(cache: &Path, limit: u64) {
    let mut all = entries(cache);
    let mut total: u64 = all.iter().map(|e| e.1).sum();
    if total <= limit {
        return;
    }
    all.sort_by_key(|e| e.2);
    for (path, size, _) in all {
        if total <= limit {
            break;
        }
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            continue;
        }
        let meta = path.with_extension("json");
        let meta_size = std::fs::metadata(&meta).map(|m| m.len()).unwrap_or(0);
        if std::fs::remove_file(&path).is_ok() {
            let _ = std::fs::remove_file(&meta);
            total = total.saturating_sub(size + meta_size);
        }
    }
}

pub fn info(cache: &Path) -> CacheInfo {
    let all = entries(cache);
    CacheInfo { bytes: all.iter().map(|e| e.1).sum(), files: all.iter().filter(|e| e.0.extension().and_then(|x| x.to_str()) == Some("mov")).count() as u32, limit_bytes: LIMIT_BYTES }
}

/// Deletes every cached clip. Clips already in projects are not touched.
pub fn clear(cache: &Path) -> Result<(), AppError> {
    if !cache.exists() {
        return Ok(());
    }
    for (path, _, _) in entries(cache) {
        std::fs::remove_file(&path).map_err(|e| bad("The graphic cache could not be emptied.", format!("{}: {e}", path.display())))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("avgc-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
    const KEY: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    fn key(n: u8) -> String {
        format!("{:02x}{}", n, &KEY[2..])
    }
    fn project_with_clip(dir: &Path, id: &str, bytes: usize) -> GraphicClip {
        let folder = dir.join("graphics").join(id);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("clip.mov"), vec![7u8; bytes]).unwrap();
        GraphicClip { path: format!("graphics/{id}/clip.mov"), frames: 90, width: 320, height: 180, size_bytes: bytes as u64 }
    }

    #[test]
    fn keys_are_64_lowercase_hex_characters() {
        assert!(valid_key(KEY));
        assert!(!valid_key("../../etc/passwd"));
        assert!(!valid_key(&KEY.to_uppercase()));
        assert!(!valid_key(&KEY[1..]));
    }

    #[test]
    fn a_stored_clip_comes_back_into_another_project() {
        let (cache, a, b) = (temp("c1"), temp("a1"), temp("b1"));
        let clip = project_with_clip(&a, "g1", 1000);
        assert!(restore(&cache, KEY, &b, "g9").unwrap().is_none(), "a miss before anything is stored");
        store(&cache, KEY, &a, &clip, LIMIT_BYTES).unwrap();
        let back = restore(&cache, KEY, &b, "g9").unwrap().expect("a hit");
        assert_eq!((back.path.as_str(), back.frames, back.width, back.height, back.size_bytes), ("graphics/g9/clip.mov", 90, 320, 180, 1000));
        assert_eq!(std::fs::read(b.join("graphics/g9/clip.mov")).unwrap().len(), 1000);
        assert!(!b.join("graphics/g9/clip.mov.tmp").exists());
    }

    #[test]
    fn a_clip_without_its_description_or_with_a_wrong_key_is_a_miss_or_an_error() {
        let (cache, a) = (temp("c2"), temp("a2"));
        std::fs::write(clip_file(&cache, KEY), b"x").unwrap();
        assert!(restore(&cache, KEY, &a, "g1").unwrap().is_none());
        assert!(restore(&cache, "../x", &a, "g1").is_err());
        assert!(restore(&cache, KEY, &a, "../g").is_err());
    }

    #[test]
    fn the_cache_is_trimmed_oldest_first_and_clear_empties_it() {
        let (cache, a) = (temp("c3"), temp("a3"));
        let clip = project_with_clip(&a, "g1", 1000);
        for n in 1..=4u8 {
            store(&cache, &key(n), &a, &clip, LIMIT_BYTES).unwrap();
            // Older entries get an older time.
            let when = SystemTime::now() - std::time::Duration::from_secs(100 - n as u64 * 10);
            for ext in ["mov", "json"] {
                let f = std::fs::OpenOptions::new().write(true).open(cache.join(format!("{}.{ext}", key(n)))).unwrap();
                f.set_modified(when).unwrap();
            }
        }
        assert_eq!(info(&cache).files, 4);
        trim(&cache, 2300);
        assert_eq!(info(&cache).files, 2);
        assert!(clip_file(&cache, &key(4)).exists() && clip_file(&cache, &key(3)).exists());
        assert!(!clip_file(&cache, &key(1)).exists() && !meta_file(&cache, &key(1)).exists());
        assert_eq!(info(&cache).limit_bytes, 5 * 1024 * 1024 * 1024);
        clear(&cache).unwrap();
        assert_eq!((info(&cache).files, info(&cache).bytes), (0, 0));
    }

    #[test]
    fn restoring_makes_the_entry_recent() {
        let (cache, a, b) = (temp("c4"), temp("a4"), temp("b4"));
        let clip = project_with_clip(&a, "g1", 500);
        store(&cache, &key(1), &a, &clip, LIMIT_BYTES).unwrap();
        store(&cache, &key(2), &a, &clip, LIMIT_BYTES).unwrap();
        let old = SystemTime::now() - std::time::Duration::from_secs(1000);
        for n in [1u8, 2] {
            for ext in ["mov", "json"] {
                std::fs::OpenOptions::new().write(true).open(cache.join(format!("{}.{ext}", key(n)))).unwrap().set_modified(old).unwrap();
            }
        }
        restore(&cache, &key(1), &b, "g2").unwrap().unwrap();
        trim(&cache, 700);
        assert!(clip_file(&cache, &key(1)).exists() && !clip_file(&cache, &key(2)).exists());
    }
}
