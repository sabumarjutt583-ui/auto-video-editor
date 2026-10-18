//! Installing a downloaded package, keeping the one before it, and rolling back.
//!
//! Folders under `<app data>/library`:
//! `sfx/` (current), `sfx.previous/` (the one before), `sfx.staging/` (while installing). Same for `styles`.
//! The app's own bundled files are used until a downloaded package is newer than them.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::hash::sha256_hex;
use super::manifest::{Kind, Manifest};
use super::zip::read_zip;
use crate::commands::error::AppError;

pub const INFO_FILE: &str = "package.json";
/// The version of the files that ship inside the app when they do not say so themselves.
pub const BUNDLED_DEFAULT_VERSION: u64 = 1;

/// What is written next to an installed package.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageInfo {
    pub version: u64,
    pub date: String,
    pub count: usize,
    #[serde(default)]
    pub sha256: String,
}

fn io(message: &str, e: std::io::Error, path: &Path) -> AppError {
    AppError::new(message, format!("{e} ({})", path.display()))
}

fn read_info(dir: &Path) -> Option<PackageInfo> {
    let text = std::fs::read_to_string(dir.join(INFO_FILE)).ok()?;
    let value: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    Some(PackageInfo {
        version: value.get("version")?.as_u64()?,
        date: value.get("date").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        count: value.get("count").and_then(|v| v.as_u64()).unwrap_or(0) as usize,
        sha256: value.get("sha256").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
    })
}

pub fn installed_dir(root: &Path, kind: Kind) -> PathBuf {
    root.join(kind.folder())
}

fn previous_dir(root: &Path, kind: Kind) -> PathBuf {
    root.join(format!("{}.previous", kind.folder()))
}

fn staging_dir(root: &Path, kind: Kind) -> PathBuf {
    root.join(format!("{}.staging", kind.folder()))
}

/// The version of the files bundled in the app (their `package.json`, or 1).
pub fn bundled_version(bundled: &Path) -> u64 {
    read_info(bundled).map_or(BUNDLED_DEFAULT_VERSION, |i| i.version)
}

/// Which folder to use: the downloaded package when it is newer than the bundled files, otherwise the bundled one.
pub fn active_dir(root: &Path, kind: Kind, bundled: &Path) -> PathBuf {
    let installed = installed_dir(root, kind);
    match read_info(&installed) {
        Some(info) if info.version > bundled_version(bundled) => installed,
        _ => bundled.to_path_buf(),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStatus {
    pub kind: Kind,
    pub version: u64,
    /// "built-in" or "downloaded"
    pub source: &'static str,
    pub date: String,
    pub count: usize,
    pub has_previous: bool,
}

pub fn status(root: &Path, kind: Kind, bundled: &Path) -> LibraryStatus {
    let active = active_dir(root, kind, bundled);
    let downloaded = active != bundled;
    let info = read_info(&active);
    LibraryStatus {
        kind,
        version: info.as_ref().map_or(BUNDLED_DEFAULT_VERSION, |i| i.version),
        source: if downloaded { "downloaded" } else { "built-in" },
        date: info.as_ref().map(|i| i.date.clone()).unwrap_or_default(),
        count: info.as_ref().map_or(0, |i| i.count),
        has_previous: read_info(&previous_dir(root, kind)).is_some(),
    }
}

/// Checks that the unpacked files really are a package of this kind, and counts what is in them.
pub fn validate(kind: Kind, dir: &Path) -> Result<usize, AppError> {
    match kind {
        Kind::Sfx => {
            let library = crate::sfx::load_library(dir);
            if library.sounds.is_empty() {
                return Err(AppError::new("The sound package has no usable sounds, so nothing was changed.", library.warnings.join(" ")));
            }
            if let Some(warning) = library.warnings.first() {
                return Err(AppError::new("The sound package is damaged, so nothing was changed.", warning.clone()));
            }
            Ok(library.sounds.len())
        }
        Kind::Styles => {
            let mut count = 0;
            let mut seen = std::collections::HashSet::new();
            for entry in std::fs::read_dir(dir).map_err(|e| io("The style package could not be read.", e, dir))?.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("json") || path.file_name().and_then(|n| n.to_str()) == Some(INFO_FILE) {
                    continue;
                }
                let text = std::fs::read_to_string(&path).map_err(|e| io("A style file could not be read.", e, &path))?;
                let style = crate::styles::parse_style(&text).map_err(|why| AppError::new("The style package is damaged, so nothing was changed.", format!("{}: {why}", path.display())))?;
                if style.id.starts_with(crate::styles::CUSTOM_PREFIX) || !seen.insert(style.id) {
                    return Err(AppError::new("The style package has a style id that cannot be used, so nothing was changed.", path.display().to_string()));
                }
                count += 1;
            }
            if count == 0 {
                return Err(AppError::new("The style package has no styles, so nothing was changed.", "no *.json style files"));
            }
            Ok(count)
        }
    }
}

/// Installs a downloaded zip. Nothing in the app changes unless every check passes.
pub fn install(root: &Path, kind: Kind, zip_bytes: &[u8], manifest: &Manifest) -> Result<PackageInfo, AppError> {
    manifest.check(kind)?;
    if sha256_hex(zip_bytes) != manifest.sha256 {
        return Err(AppError::new(
            "The download is damaged (its SHA-256 check failed), so nothing was changed. Please try again.",
            format!("expected {}, got {}", manifest.sha256, sha256_hex(zip_bytes)),
        ));
    }
    let entries = read_zip(zip_bytes).map_err(|e| AppError::new("The downloaded package could not be opened, so nothing was changed.", e))?;
    if entries.iter().any(|e| e.name.contains('/')) {
        return Err(AppError::new("The package has folders inside it, which is not allowed. Nothing was changed.", "nested file names"));
    }

    std::fs::create_dir_all(root).map_err(|e| io("The library folder could not be created.", e, root))?;
    let staging = staging_dir(root, kind);
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| io("The library folder could not be created.", e, &staging))?;
    let result = (|| {
        for entry in &entries {
            if entry.name == INFO_FILE {
                continue;
            }
            let path = staging.join(&entry.name);
            std::fs::write(&path, &entry.data).map_err(|e| io("The package could not be saved. Please check that the disk is not full.", e, &path))?;
        }
        let count = validate(kind, &staging)?;
        if count != manifest.count {
            return Err(AppError::new("The package does not match its manifest, so nothing was changed.", format!("manifest says {}, package has {count}", manifest.count)));
        }
        let info = PackageInfo { version: manifest.version, date: manifest.date.clone(), count, sha256: manifest.sha256.clone() };
        let json = serde_json::to_string_pretty(&info).map_err(|e| AppError::new("The package could not be saved.", e.to_string()))?;
        std::fs::write(staging.join(INFO_FILE), json).map_err(|e| io("The package could not be saved.", e, &staging))?;
        Ok(info)
    })();
    let info = match result {
        Ok(info) => info,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(e);
        }
    };

    // Swap: current -> previous, staging -> current. If the second step fails, the first is undone.
    let current = installed_dir(root, kind);
    let previous = previous_dir(root, kind);
    let had_current = current.is_dir();
    if had_current {
        let _ = std::fs::remove_dir_all(&previous);
        std::fs::rename(&current, &previous).map_err(|e| io("The old package could not be kept for rollback.", e, &current))?;
    }
    if let Err(e) = std::fs::rename(&staging, &current) {
        if had_current {
            let _ = std::fs::rename(&previous, &current);
        }
        let _ = std::fs::remove_dir_all(&staging);
        return Err(io("The new package could not be put in place. Nothing was changed.", e, &current));
    }
    Ok(info)
}

/// Goes back to the package before the current one (and the current one becomes the "previous" one).
pub fn rollback(root: &Path, kind: Kind) -> Result<PackageInfo, AppError> {
    let current = installed_dir(root, kind);
    let previous = previous_dir(root, kind);
    let info = read_info(&previous).ok_or_else(|| AppError::new("There is no earlier version to go back to.", format!("{} is missing", previous.display())))?;
    let swap = root.join(format!("{}.swap", kind.folder()));
    let _ = std::fs::remove_dir_all(&swap);
    if current.is_dir() {
        std::fs::rename(&current, &swap).map_err(|e| io("The packages could not be switched.", e, &current))?;
    }
    if let Err(e) = std::fs::rename(&previous, &current) {
        if swap.is_dir() {
            let _ = std::fs::rename(&swap, &current);
        }
        return Err(io("The packages could not be switched.", e, &previous));
    }
    if swap.is_dir() {
        let _ = std::fs::rename(&swap, &previous);
    }
    Ok(info)
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::library::hash::sha256_hex;
    use crate::library::zip::{write_stored, ZipEntry};

    pub fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ave-lib-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A tiny valid sound package with `n` sounds (the audio is not real, only its listing matters here).
    pub fn sfx_package(version: u64, n: usize) -> (Vec<u8>, Manifest) {
        let mut entries = Vec::new();
        let mut index = Vec::new();
        for i in 0..n {
            let file = format!("pop_{i}.wav");
            index.push(serde_json::json!({"id": format!("pop_{i}"), "file": file, "category": "pop", "tags": ["t"], "duration": 0.5, "defaultGain": 0.7}));
            entries.push(ZipEntry { name: file, data: vec![version as u8; 64] });
        }
        entries.push(ZipEntry { name: "index.json".into(), data: serde_json::to_vec(&index).unwrap() });
        let zip = write_stored(&entries);
        let manifest = Manifest { kind: "sfx-library".into(), version, sha256: sha256_hex(&zip), count: n, date: "2026-10-18".into(), file: format!("sfx-library-{version}.zip") };
        (zip, manifest)
    }

    pub fn styles_package(version: u64) -> (Vec<u8>, Manifest) {
        let style = |id: &str| serde_json::to_vec(&serde_json::json!({"id": id, "name": id, "category": "test"})).unwrap();
        let zip = write_stored(&[ZipEntry { name: "new_style.json".into(), data: style("new_style") }, ZipEntry { name: "other.json".into(), data: style("other") }]);
        let manifest = Manifest { kind: "styles-package".into(), version, sha256: sha256_hex(&zip), count: 2, date: "2026-10-18".into(), file: format!("styles-package-{version}.zip") };
        (zip, manifest)
    }

    #[test]
    fn a_newer_package_replaces_the_bundled_files_and_the_old_one_is_kept() {
        let root = temp("install");
        let bundled = temp("bundled");
        std::fs::write(bundled.join(INFO_FILE), r#"{"version":1,"date":"2026-01-01","count":5}"#).unwrap();
        assert_eq!(active_dir(&root, Kind::Sfx, &bundled), bundled);
        assert_eq!(status(&root, Kind::Sfx, &bundled).source, "built-in");

        let (zip2, m2) = sfx_package(2, 3);
        let info = install(&root, Kind::Sfx, &zip2, &m2).unwrap();
        assert_eq!((info.version, info.count), (2, 3));
        assert_eq!(active_dir(&root, Kind::Sfx, &bundled), installed_dir(&root, Kind::Sfx));
        let s = status(&root, Kind::Sfx, &bundled);
        assert_eq!((s.version, s.source, s.count, s.has_previous), (2, "downloaded", 3, false));

        let (zip3, m3) = sfx_package(3, 4);
        install(&root, Kind::Sfx, &zip3, &m3).unwrap();
        assert!(status(&root, Kind::Sfx, &bundled).has_previous);
        assert_eq!(crate::sfx::load_library(&installed_dir(&root, Kind::Sfx)).sounds.len(), 4);

        let back = rollback(&root, Kind::Sfx).unwrap();
        assert_eq!(back.version, 2);
        assert_eq!(status(&root, Kind::Sfx, &bundled).version, 2);
        let forward = rollback(&root, Kind::Sfx).unwrap();
        assert_eq!(forward.version, 3, "rolling back again goes forward");
        assert!(!staging_dir(&root, Kind::Sfx).exists());
    }

    #[test]
    fn a_bundled_library_newer_than_the_download_wins() {
        let root = temp("newer-bundled");
        let bundled = temp("bundled-newer");
        let (zip, m) = sfx_package(2, 2);
        install(&root, Kind::Sfx, &zip, &m).unwrap();
        std::fs::write(bundled.join(INFO_FILE), r#"{"version":5}"#).unwrap();
        assert_eq!(active_dir(&root, Kind::Sfx, &bundled), bundled);
    }

    #[test]
    fn a_damaged_download_changes_nothing() {
        let root = temp("damaged");
        let (zip, m) = sfx_package(2, 3);
        install(&root, Kind::Sfx, &zip, &m).unwrap();
        let before = read_info(&installed_dir(&root, Kind::Sfx)).unwrap();

        let (mut bad, m3) = sfx_package(3, 3);
        let last = bad.len() / 2;
        bad[last] ^= 1;
        let error = install(&root, Kind::Sfx, &bad, &m3).unwrap_err();
        assert!(error.message.contains("SHA-256"), "{}", error.message);
        assert_eq!(read_info(&installed_dir(&root, Kind::Sfx)).unwrap(), before);
        assert!(!staging_dir(&root, Kind::Sfx).exists());

        // A package whose count does not match its manifest.
        let (zip4, mut m4) = sfx_package(4, 3);
        m4.count = 9;
        assert!(install(&root, Kind::Sfx, &zip4, &m4).unwrap_err().message.contains("does not match"));
        assert_eq!(read_info(&installed_dir(&root, Kind::Sfx)).unwrap(), before);
    }

    #[test]
    fn packages_with_unsafe_or_wrong_contents_are_refused() {
        let root = temp("unsafe");
        let zip = write_stored(&[ZipEntry { name: "../evil.wav".into(), data: vec![1] }]);
        let m = Manifest { kind: "sfx-library".into(), version: 2, sha256: sha256_hex(&zip), count: 1, date: String::new(), file: "x.zip".into() };
        assert!(install(&root, Kind::Sfx, &zip, &m).is_err());
        let zip = write_stored(&[ZipEntry { name: "index.json".into(), data: b"[]".to_vec() }]);
        let m = Manifest { sha256: sha256_hex(&zip), ..m };
        assert!(install(&root, Kind::Sfx, &zip, &m).unwrap_err().message.contains("no usable sounds"));
        assert!(rollback(&root, Kind::Sfx).is_err(), "nothing to go back to");
    }

    #[test]
    fn style_packages_install_and_reject_bad_ids() {
        let root = temp("styles");
        let bundled = temp("styles-bundled");
        let (zip, m) = styles_package(2);
        install(&root, Kind::Styles, &zip, &m).unwrap();
        assert_eq!(status(&root, Kind::Styles, &bundled).count, 2);

        let bad = write_stored(&[ZipEntry { name: "x.json".into(), data: br#"{"id":"custom_x","name":"x","category":"c"}"#.to_vec() }]);
        let m = Manifest { kind: "styles-package".into(), version: 3, sha256: sha256_hex(&bad), count: 1, date: String::new(), file: "x.zip".into() };
        assert!(install(&root, Kind::Styles, &bad, &m).is_err(), "custom_ ids belong to the user");
        assert_eq!(status(&root, Kind::Styles, &bundled).version, 2);
    }
}
