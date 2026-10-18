//! Checking for a newer package and installing it.
//!
//! No API keys are used here: only two plain downloads (the manifest, then the zip) from the address in Settings.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use super::manifest::{valid_base_url, Kind, Manifest};
use super::store::{self, LibraryStatus};
use crate::api::client::{http, send};
use crate::api::error::ApiError;
use crate::commands::error::AppError;
use crate::jobs::Job;

const MAX_MANIFEST_BYTES: usize = 64 * 1024;
const MAX_PACKAGE_BYTES: usize = 400 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(900);

/// What happened to one package.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOutcome {
    pub kind: Kind,
    /// "updated", "up-to-date" or "not-published"
    pub result: &'static str,
    pub version: u64,
}

async fn get_bytes(url: &str, limit: usize, job: Option<&Job>, stage: &str) -> Result<Vec<u8>, AppError> {
    let client = http()?;
    let mut response = send(|| client.get(url).timeout(DOWNLOAD_TIMEOUT)).await.map_err(|e| match e {
        // These servers use no keys, so "invalid key" would only confuse.
        ApiError::InvalidKey(d) | ApiError::BadResponse(d) => AppError::new("The update server did not give the file. Please try again later.", d),
        other => other.into(),
    })?;
    if response.content_length().is_some_and(|n| n as usize > limit) {
        return Err(AppError::new("The download is too big, so it was stopped.", format!("{url} is larger than {limit} bytes")));
    }
    let total = response.content_length().unwrap_or(0);
    let mut data = Vec::new();
    loop {
        let chunk = match job {
            Some(job) => tokio::select! {
                chunk = response.chunk() => chunk,
                () = job.cancelled() => return Err(AppError::cancelled()),
            },
            None => response.chunk().await,
        };
        let Some(chunk) = chunk.map_err(|e| AppError::new("The download was interrupted. Please check your internet connection and try again.", e.to_string()))? else { break };
        data.extend_from_slice(&chunk);
        if data.len() > limit {
            return Err(AppError::new("The download is too big, so it was stopped.", format!("{url} is larger than {limit} bytes")));
        }
        if let (Some(job), true) = (job, total > 0) {
            job.progress(stage, data.len() as f64 / total as f64 * 100.0);
        }
    }
    Ok(data)
}

/// Fetches the manifest. A 404 means that nothing is published yet (`None`).
async fn fetch_manifest(base: &str, kind: Kind) -> Result<Option<Manifest>, AppError> {
    let url = format!("{}/{}", base.trim_end_matches('/'), kind.manifest_file());
    match get_bytes(&url, MAX_MANIFEST_BYTES, None, "").await {
        Ok(bytes) => Manifest::parse(&String::from_utf8_lossy(&bytes), kind).map(Some),
        Err(e) if e.details.contains("HTTP 404") => Ok(None),
        Err(e) => Err(e),
    }
}

/// Checks one package kind and installs the newer version, if there is one.
pub async fn update_kind(root: &Path, kind: Kind, bundled: &Path, base: &str, job: &Job) -> Result<UpdateOutcome, AppError> {
    job.check()?;
    job.progress(&format!("Checking {}", kind.label()), 0.0);
    let current = store::status(root, kind, bundled).version;
    let Some(manifest) = fetch_manifest(base, kind).await? else {
        return Ok(UpdateOutcome { kind, result: "not-published", version: current });
    };
    if manifest.version <= current {
        return Ok(UpdateOutcome { kind, result: "up-to-date", version: current });
    }
    let stage = format!("Downloading {}", kind.label());
    job.progress(&stage, 0.0);
    let url = manifest.zip_url(base);
    if !valid_base_url(&url) {
        return Err(AppError::new("The update address is not secure, so nothing was changed.", url));
    }
    let bytes = get_bytes(&url, MAX_PACKAGE_BYTES, Some(job), &stage).await?;
    job.check()?;
    job.progress(&format!("Installing {}", kind.label()), 100.0);
    let root = root.to_path_buf();
    let new_manifest = manifest.clone();
    crate::commands::blocking::run_blocking(move || store::install(&root, kind, &bytes, &new_manifest)).await?;
    Ok(UpdateOutcome { kind, result: "updated", version: manifest.version })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReport {
    pub outcomes: Vec<UpdateOutcome>,
    pub status: Vec<LibraryStatus>,
}

/// Checks every package kind. Sound effects and styles are separate: one failing does not stop the other,
/// unless the person pressed Cancel.
pub async fn update_all(root: &Path, bundled: &[(Kind, std::path::PathBuf)], base: &str, job: &Job) -> Result<UpdateReport, AppError> {
    if !valid_base_url(base) {
        return Err(AppError::new("The update address in Settings is not valid. It must start with https://.", base.to_string()));
    }
    let mut outcomes = Vec::new();
    let mut first_error: Option<AppError> = None;
    let count = bundled.len().max(1) as f64;
    for (i, (kind, dir)) in bundled.iter().enumerate() {
        job.set_range(i as f64 / count * 100.0, (i as f64 + 1.0) / count * 100.0);
        match update_kind(root, *kind, dir, base, job).await {
            Ok(outcome) => outcomes.push(outcome),
            Err(e) if e.code.as_deref() == Some("cancelled") => return Err(e),
            Err(e) => first_error = first_error.or(Some(e)),
        }
    }
    job.set_range(0.0, 100.0);
    if outcomes.is_empty() {
        if let Some(e) = first_error {
            return Err(e);
        }
    }
    let status = bundled.iter().map(|(kind, dir)| store::status(root, *kind, dir)).collect();
    Ok(UpdateReport { outcomes, status })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jobs::{test_job, JobRegistry};
    use crate::library::store::tests::{sfx_package, styles_package, temp};
    use std::collections::HashMap;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// A tiny web server that answers from a map of path -> bytes (404 otherwise).
    async fn serve(files: HashMap<String, Vec<u8>>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else { return };
                let files = files.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 4096];
                    let n = socket.read(&mut buf).await.unwrap_or(0);
                    let request = String::from_utf8_lossy(&buf[..n]).to_string();
                    let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let reply = match files.get(&path) {
                        Some(body) => {
                            let mut r = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).into_bytes();
                            r.extend_from_slice(body);
                            r
                        }
                        None => b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
                    };
                    let _ = socket.write_all(&reply).await;
                });
            }
        });
        format!("http://127.0.0.1:{port}/rel")
    }

    fn files_for(zip: &[u8], manifest: &Manifest, manifest_name: &str) -> HashMap<String, Vec<u8>> {
        let mut m = HashMap::new();
        m.insert(format!("/rel/{manifest_name}"), serde_json::to_vec(manifest).unwrap());
        m.insert(format!("/rel/{}", manifest.file), zip.to_vec());
        m
    }

    #[tokio::test]
    async fn a_newer_package_is_downloaded_checked_and_installed() {
        let (zip, manifest) = sfx_package(2, 3);
        let base = serve(files_for(&zip, &manifest, "manifest.json")).await;
        let root = temp("upd-ok");
        let bundled = temp("upd-ok-bundled");
        let registry = JobRegistry::default();
        let (job, log) = test_job(&registry, "j1");

        let outcome = update_kind(&root, Kind::Sfx, &bundled, &base, &job).await.unwrap();
        assert_eq!((outcome.result, outcome.version), ("updated", 2));
        assert_eq!(store::status(&root, Kind::Sfx, &bundled).count, 3);
        assert!(log.lock().unwrap().iter().any(|p| p.stage.starts_with("Downloading")));

        let again = update_kind(&root, Kind::Sfx, &bundled, &base, &job).await.unwrap();
        assert_eq!(again.result, "up-to-date");
    }

    #[tokio::test]
    async fn a_download_with_the_wrong_hash_is_refused() {
        let (zip, mut manifest) = sfx_package(2, 3);
        manifest.sha256 = "0".repeat(64);
        let base = serve(files_for(&zip, &manifest, "manifest.json")).await;
        let root = temp("upd-bad");
        let bundled = temp("upd-bad-bundled");
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "j2");
        let error = update_kind(&root, Kind::Sfx, &bundled, &base, &job).await.unwrap_err();
        assert!(error.message.contains("SHA-256"), "{}", error.message);
        assert_eq!(store::status(&root, Kind::Sfx, &bundled).source, "built-in");
    }

    #[tokio::test]
    async fn update_all_handles_missing_packages_and_both_kinds() {
        let (sfx_zip, sfx_manifest) = sfx_package(2, 2);
        let (style_zip, style_manifest) = styles_package(2);
        let mut files = files_for(&sfx_zip, &sfx_manifest, "manifest.json");
        let _ = &style_zip;
        files.remove("/rel/styles-package-2.zip");
        files.insert("/rel/styles-manifest.json".into(), serde_json::to_vec(&style_manifest).unwrap());
        let base = serve(files).await;
        let root = temp("upd-all");
        let (b1, b2) = (temp("upd-all-sfx"), temp("upd-all-styles"));
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "j3");
        let list = vec![(Kind::Sfx, b1.clone()), (Kind::Styles, b2.clone())];
        // Styles zip is missing (404), sfx works: the report still shows the sound update.
        let report = update_all(&root, &list, &base, &job).await.unwrap();
        assert_eq!(report.outcomes.len(), 1);
        assert_eq!(report.outcomes[0].kind, Kind::Sfx);
        assert_eq!(report.status[0].version, 2);

        // Nothing published at all is not an error.
        let empty = serve(HashMap::new()).await;
        let report = update_all(&temp("upd-none"), &list, &empty, &job).await.unwrap();
        assert!(report.outcomes.iter().all(|o| o.result == "not-published"));

        assert!(update_all(&root, &list, "http://example.com/x", &job).await.is_err(), "plain http is refused");
    }

    #[tokio::test]
    async fn an_unreachable_server_gives_a_friendly_error() {
        let registry = JobRegistry::default();
        let (job, _) = test_job(&registry, "j4");
        let error = update_all(&temp("upd-down"), &[(Kind::Sfx, temp("upd-down-b"))], "http://127.0.0.1:1/rel", &job).await.unwrap_err();
        assert!(error.message.contains("internet"), "{}", error.message);
    }
}
