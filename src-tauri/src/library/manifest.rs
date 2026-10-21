//! The small file that says which version of a package is current.
//!
//! ```json
//! { "kind": "sfx-library", "version": 3, "sha256": "…64 hex…", "count": 120,
//!   "date": "2026-10-18", "file": "sfx-library-3.zip" }
//! ```

use serde::{Deserialize, Serialize};

use crate::commands::error::AppError;

/// What a package holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Sfx,
    Styles,
    /// The image engine's settings file (selectors, texts, address of the shared tool).
    ImageEngine,
}

impl Kind {
    /// The `kind` written in a manifest.
    pub fn tag(self) -> &'static str {
        match self {
            Kind::Sfx => "sfx-library",
            Kind::Styles => "styles-package",
            Kind::ImageEngine => "image-engine-config",
        }
    }

    /// Folder name under the app's `library` folder.
    pub fn folder(self) -> &'static str {
        match self {
            Kind::Sfx => "sfx",
            Kind::Styles => "styles",
            Kind::ImageEngine => "image-engine",
        }
    }

    pub fn manifest_file(self) -> &'static str {
        match self {
            Kind::Sfx => "manifest.json",
            Kind::Styles => "styles-manifest.json",
            Kind::ImageEngine => "image-engine-manifest.json",
        }
    }

    /// `sfx-library-3.zip` or `styles-package-3.zip`.
    #[cfg(any(feature = "admin", test))]
    pub fn zip_name(self, version: u64) -> String {
        format!("{}-{version}.zip", self.tag())
    }

    pub fn label(self) -> &'static str {
        match self {
            Kind::Sfx => "sound effects",
            Kind::Styles => "styles",
            Kind::ImageEngine => "image engine settings",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    pub kind: String,
    pub version: u64,
    /// SHA-256 of the zip file, in lower-case hex.
    pub sha256: String,
    /// How many sounds or styles are in the package.
    pub count: usize,
    /// "2026-10-18"
    pub date: String,
    /// The zip's file name next to the manifest (or a full https address).
    pub file: String,
}

fn bad(details: impl Into<String>) -> AppError {
    AppError::new("The update information is not valid, so nothing was changed.", details)
}

impl Manifest {
    pub fn parse(text: &str, kind: Kind) -> Result<Self, AppError> {
        let manifest: Manifest = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| bad(format!("The manifest could not be read: {e}")))?;
        manifest.check(kind)?;
        Ok(manifest)
    }

    pub fn check(&self, kind: Kind) -> Result<(), AppError> {
        if self.kind != kind.tag() {
            return Err(bad(format!("The manifest is for {:?}, not {:?}.", self.kind, kind.tag())));
        }
        if self.version == 0 {
            return Err(bad("The version must be 1 or more."));
        }
        if self.sha256.len() != 64 || !self.sha256.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')) {
            return Err(bad("The SHA-256 must be 64 lower-case hex characters."));
        }
        if self.count == 0 {
            return Err(bad("The package says it holds nothing."));
        }
        let plain_name = !self.file.is_empty() && !self.file.contains(['/', '\\', ':']) && !self.file.starts_with('.');
        if !plain_name && !self.file.starts_with("https://") {
            return Err(bad(format!("The package file name is not valid: {:?}.", self.file)));
        }
        Ok(())
    }

    /// The address of the zip, given the folder address the manifest came from.
    pub fn zip_url(&self, base: &str) -> String {
        if self.file.starts_with("https://") {
            self.file.clone()
        } else {
            format!("{}/{}", base.trim_end_matches('/'), self.file)
        }
    }
}

/// Only secure addresses are used, except for this computer (for testing a release by hand).
pub fn valid_base_url(url: &str) -> bool {
    let url = url.trim();
    let local = ["http://localhost", "http://127.0.0.1"].iter().any(|p| url.starts_with(p));
    (url.starts_with("https://") || local) && url.len() <= 500 && !url.contains(char::is_whitespace)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(kind: &str, version: u64, sha: &str, file: &str) -> String {
        format!(r#"{{"kind":"{kind}","version":{version},"sha256":"{sha}","count":19,"date":"2026-10-18","file":"{file}"}}"#)
    }
    const SHA: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    #[test]
    fn a_good_manifest_is_read() {
        let m = Manifest::parse(&text("sfx-library", 3, SHA, "sfx-library-3.zip"), Kind::Sfx).unwrap();
        assert_eq!((m.version, m.count), (3, 19));
        assert_eq!(m.zip_url("https://example.com/releases/"), "https://example.com/releases/sfx-library-3.zip");
        assert_eq!(Kind::Sfx.zip_name(3), "sfx-library-3.zip");
        assert_eq!(Kind::Styles.manifest_file(), "styles-manifest.json");
    }

    #[test]
    fn wrong_or_damaged_manifests_are_refused() {
        assert!(Manifest::parse(&text("styles-package", 3, SHA, "x.zip"), Kind::Sfx).is_err(), "wrong kind");
        assert!(Manifest::parse(&text("sfx-library", 0, SHA, "x.zip"), Kind::Sfx).is_err());
        assert!(Manifest::parse(&text("sfx-library", 1, "ABC", "x.zip"), Kind::Sfx).is_err());
        assert!(Manifest::parse(&text("sfx-library", 1, &SHA.to_uppercase(), "x.zip"), Kind::Sfx).is_err());
        assert!(Manifest::parse(&text("sfx-library", 1, SHA, "../x.zip"), Kind::Sfx).is_err());
        assert!(Manifest::parse(&text("sfx-library", 1, SHA, "http://evil.example/x.zip"), Kind::Sfx).is_err());
        assert!(Manifest::parse("not json", Kind::Sfx).is_err());
        assert!(Manifest::parse(&text("sfx-library", 1, SHA, "https://cdn.example.com/x.zip"), Kind::Sfx).is_ok());
    }

    #[test]
    fn only_secure_addresses_are_used() {
        assert!(valid_base_url("https://github.com/a/b/releases/latest/download"));
        assert!(valid_base_url("http://127.0.0.1:8080/x"));
        assert!(!valid_base_url("http://example.com/x"));
        assert!(!valid_base_url("file:///etc"));
        assert!(!valid_base_url(""));
    }
}
