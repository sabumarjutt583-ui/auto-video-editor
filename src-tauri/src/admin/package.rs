//! Building `sfx-library-<version>.zip` / `styles-package-<version>.zip` and their manifest files.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::commands::error::AppError;
use crate::library::hash::sha256_hex;
use crate::library::manifest::{Kind, Manifest};
use crate::library::store;
use crate::library::zip::{read_zip, write_stored, ZipEntry};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltPackage {
    pub zip_path: String,
    pub manifest_path: String,
    pub version: u64,
    pub count: usize,
    pub sha256: String,
    pub size_bytes: u64,
}

pub use crate::clock::today;

fn io(message: &str, e: std::io::Error, path: &Path) -> AppError {
    AppError::new(message, format!("{e} ({})", path.display()))
}

fn read(path: &Path) -> Result<Vec<u8>, AppError> {
    std::fs::read(path).map_err(|e| io("A library file could not be read.", e, path))
}

/// The files that go into the zip.
fn collect(kind: Kind, source: &Path) -> Result<Vec<ZipEntry>, AppError> {
    let mut entries = Vec::new();
    match kind {
        Kind::Sfx => {
            for sound in super::workspace::read_index(source)? {
                entries.push(ZipEntry { data: read(&source.join(&sound.file))?, name: sound.file });
            }
            entries.push(ZipEntry { name: "index.json".into(), data: read(&source.join("index.json"))? });
            let credits = source.join(super::workspace::CREDITS_FILE);
            if credits.is_file() {
                entries.push(ZipEntry { name: super::workspace::CREDITS_FILE.into(), data: read(&credits)? });
            }
        }
        Kind::ImageEngine => {
            entries.push(ZipEntry { name: "config.json".into(), data: read(&source.join("config.json"))? });
        }
        Kind::Styles => {
            let mut names: Vec<String> = std::fs::read_dir(source)
                .map_err(|e| io("The styles folder could not be read.", e, source))?
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| n.ends_with(".json") && n != store::INFO_FILE)
                .collect();
            names.sort();
            for name in names {
                entries.push(ZipEntry { data: read(&source.join(&name))?, name });
            }
            // The thumbnails travel with the styles, so users get new pictures without a new app version.
            let thumbs = source.join(crate::thumbnails::FOLDER);
            if thumbs.is_dir() {
                let mut files: Vec<String> = std::fs::read_dir(&thumbs).map_err(|e| io("The thumbnails folder could not be read.", e, &thumbs))?.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.ends_with(".webp")).collect();
                files.sort();
                for file in files {
                    entries.push(ZipEntry { data: read(&thumbs.join(&file))?, name: format!("{}/{file}", crate::thumbnails::FOLDER) });
                }
            }
        }
    }
    Ok(entries)
}

/// Checks the library, writes the zip and the manifest next to each other, and checks them again as a user would.
pub fn build(kind: Kind, source: &Path, out_dir: &Path, version: u64, date: &str) -> Result<BuiltPackage, AppError> {
    let count = store::validate(kind, source)?;
    let entries = collect(kind, source)?;
    let zip = write_stored(&entries);
    let manifest = Manifest { kind: kind.tag().into(), version, sha256: sha256_hex(&zip), count, date: date.into(), file: kind.zip_name(version) };
    manifest.check(kind)?;

    std::fs::create_dir_all(out_dir).map_err(|e| io("The package folder could not be created.", e, out_dir))?;
    let zip_path: PathBuf = out_dir.join(&manifest.file);
    let manifest_path = out_dir.join(kind.manifest_file());
    std::fs::write(&zip_path, &zip).map_err(|e| io("The package could not be saved. Please check that the disk is not full.", e, &zip_path))?;
    let json = serde_json::to_string_pretty(&manifest).map_err(|e| AppError::new("The manifest could not be prepared.", e.to_string()))?;
    std::fs::write(&manifest_path, json).map_err(|e| io("The manifest could not be saved.", e, &manifest_path))?;

    // Read back what was written, the way the user's app will.
    let written = read(&zip_path)?;
    if sha256_hex(&written) != manifest.sha256 || read_zip(&written).map_err(|e| AppError::new("The new package could not be read back.", e))?.len() != entries.len() {
        return Err(AppError::new("The new package did not pass its own check. Please build it again.", "read-back mismatch"));
    }
    Ok(BuiltPackage { zip_path: zip_path.to_string_lossy().into_owned(), manifest_path: manifest_path.to_string_lossy().into_owned(), version, count, sha256: manifest.sha256, size_bytes: written.len() as u64 })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::store::tests::temp;
    use crate::sfx::SfxEntry;

    #[test]
    fn today_is_a_date() {
        assert_eq!(today().len(), 10);
    }

    pub fn make_workspace(name: &str, n: usize) -> PathBuf {
        let dir = temp(name);
        for i in 0..n {
            let id = format!("s{i}");
            std::fs::write(dir.join(format!("{id}.wav")), vec![i as u8; 100]).unwrap();
            let entry = SfxEntry { id: id.clone(), file: format!("{id}.wav"), category: "click".into(), tags: vec!["t".into()], duration: 0.2, default_gain: 0.6 };
            super::super::workspace::register(&dir, entry, None).unwrap();
        }
        dir
    }

    #[test]
    fn a_package_built_by_the_admin_installs_in_the_user_build() {
        let ws = make_workspace("pkg-ws-a", 4);
        std::fs::write(ws.join("stray.txt"), "not part of the package").unwrap();
        let out = temp("pkg-out");
        let built = build(Kind::Sfx, &ws, &out, 7, "2026-10-18").unwrap();
        assert_eq!(built.count, 4);

        let manifest = Manifest::parse(&std::fs::read_to_string(&built.manifest_path).unwrap(), Kind::Sfx).unwrap();
        assert_eq!((manifest.version, manifest.file.as_str()), (7, "sfx-library-7.zip"));

        let user_root = temp("pkg-user");
        let info = store::install(&user_root, Kind::Sfx, &std::fs::read(&built.zip_path).unwrap(), &manifest).unwrap();
        assert_eq!((info.version, info.count), (7, 4));
        let installed = store::installed_dir(&user_root, Kind::Sfx);
        assert!(!installed.join("stray.txt").exists());
        assert_eq!(crate::sfx::load_library(&installed).sounds.len(), 4);
    }

    #[test]
    fn a_broken_library_is_not_packaged() {
        let ws = make_workspace("pkg-ws-b", 2);
        std::fs::remove_file(ws.join("s1.wav")).unwrap();
        assert!(build(Kind::Sfx, &ws, &temp("pkg-out2"), 2, "2026-10-18").is_err());
        let empty = temp("pkg-empty");
        assert!(build(Kind::Sfx, &empty, &temp("pkg-out3"), 2, "2026-10-18").is_err());
    }

    #[test]
    fn a_style_package_installs_too() {
        let dir = temp("pkg-styles");
        for id in ["neon", "paper"] {
            std::fs::write(dir.join(format!("{id}.json")), serde_json::json!({"id": id, "name": id, "category": "test"}).to_string()).unwrap();
        }
        let out = temp("pkg-styles-out");
        let built = build(Kind::Styles, &dir, &out, 3, "2026-10-18").unwrap();
        assert!(built.manifest_path.ends_with("styles-manifest.json"));
        let manifest = Manifest::parse(&std::fs::read_to_string(&built.manifest_path).unwrap(), Kind::Styles).unwrap();
        let user = temp("pkg-styles-user");
        store::install(&user, Kind::Styles, &std::fs::read(&built.zip_path).unwrap(), &manifest).unwrap();
        let library = crate::styles::load_all(&store::installed_dir(&user, Kind::Styles), &temp("none"));
        assert_eq!(library.styles.len(), 2, "{:?}", library.warnings);
    }

    /// Builds the styles package from the styles that ship in resources/styles.
    /// Set `STYLES_PACKAGE_OUT=<folder>` to keep the zip and manifest there.
    #[test]
    fn the_shipped_styles_make_a_valid_package() {
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../resources/styles");
        let info: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(source.join(store::INFO_FILE)).unwrap()).unwrap();
        let version = info["version"].as_u64().unwrap();
        let out = std::env::var("STYLES_PACKAGE_OUT").map(PathBuf::from).unwrap_or_else(|_| temp("pkg-styles-out"));
        let built = build(Kind::Styles, &source, &out, version, info["date"].as_str().unwrap()).unwrap();
        assert_eq!(built.count, 51);
        let manifest = Manifest::parse(&std::fs::read_to_string(&built.manifest_path).unwrap(), Kind::Styles).unwrap();
        let user_root = temp("pkg-styles-user");
        store::install(&user_root, Kind::Styles, &std::fs::read(&built.zip_path).unwrap(), &manifest).unwrap();
        let mut warnings = Vec::new();
        let styles = crate::styles::load_dir(&store::installed_dir(&user_root, Kind::Styles), true, &mut warnings);
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(styles.len(), 51);
    }
}
