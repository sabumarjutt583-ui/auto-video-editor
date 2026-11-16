//! Read-only, bounded diagnostics for unreferenced revision artifacts.
 //! A filename derived from job+operation ID cannot authenticate the original
 //! request, so Phase 03G NEVER attaches an orphan or fabricates job history.
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::model::{digest, valid_revision_id, ScriptJobRecord, MAX_IMPORT_BYTES};
use super::store::{StoreError, StoreErrorCode};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryArtifactKind {
    OrphanRevision,
    IncompleteRevisionTemporary,
    AmbiguousRevision,
    UnsafeRevisionEntry,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryArtifact {
    pub artifact_id: String,
    pub kind: RecoveryArtifactKind,
    pub byte_length: Option<u64>,
    pub content_digest: Option<String>,
    pub can_read_text: bool,
    /// Always false until a separately authorized durable intent protocol exists.
    pub attachment_proven: bool,
    pub explanation: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryInspection {
    pub job_id: String,
    pub channel_id: String,
    pub request_id: String,
    pub last_verified_state_revision: u64,
    pub blocked: bool,
    pub issues: Vec<super::store::RecoveryIssue>,
    pub artifacts: Vec<RecoveryArtifact>,
    pub reconciliation_supported: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryArtifactText {
    pub artifact_id: String,
    pub content_digest: String,
    pub byte_length: u64,
    /// Deliberately returned ONLY on an explicit request, never in diagnostics/logs.
    pub text: String,
}

fn error(code: StoreErrorCode, message: &'static str) -> StoreError {
    StoreError { code, details: message }
}
fn storage() -> StoreError {
    error(StoreErrorCode::StorageFailure, "Local revision inspection failed; data was not changed.")
}
fn unsafe_entry() -> StoreError {
    error(StoreErrorCode::RecoveryBlocked, "Unsafe or ambiguous artifact cannot be inspected.")
}
fn good_dir(path: &Path) -> Result<bool, StoreError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => Ok(true),
        Ok(_) => Err(unsafe_entry()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(storage()),
    }
}
fn safe_file_info(path: &Path) -> Result<Option<u64>, StoreError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => Ok(Some(meta.len())),
        Ok(_) => Err(unsafe_entry()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(storage()),
    }
}
fn read_bounded(path: &Path, expected_len: u64) -> Result<Vec<u8>, StoreError> {
    if expected_len == 0 || expected_len > MAX_IMPORT_BYTES as u64 {
        return Err(unsafe_entry());
    }
    let mut bytes = Vec::new();
    File::open(path).map_err(|_| storage())?
        .take(MAX_IMPORT_BYTES as u64 + 1)
        .read_to_end(&mut bytes).map_err(|_| storage())?;
    if bytes.len() as u64 != expected_len {
        return Err(unsafe_entry());
    }
    Ok(bytes)
}
fn is_tmp(name: &str) -> bool {
    name.starts_with("revision-") && name.ends_with(".tmp")
        && name.len() == "revision-".len() + 32 + ".tmp".len()
        && name["revision-".len()..name.len()-4].bytes().all(|x| x.is_ascii_hexdigit())
}

/// Scan only direct children beneath an already-validated job directory.
pub fn inspect_revision_artifacts(
    folder: &Path, job: &ScriptJobRecord,
) -> Result<Vec<RecoveryArtifact>, StoreError> {
    let root = folder.join("revisions");
    if !good_dir(&root)? { return Ok(Vec::new()); }
    let committed: HashSet<&str> = job.revisions.iter()
        .map(|reference| reference.revision_id.as_str()).collect();
    let mut seen = HashSet::<String>::new();
    let mut ambiguous = HashSet::<String>::new();
    let mut entries = Vec::new();
    // First pass prevents a case-insensitive collision from being exposed as safe
    // on Windows OR Linux, regardless of directory iteration order.
    let mut filenames = Vec::new();
    for dirent in fs::read_dir(&root).map_err(|_| storage())? {
        let entry = dirent.map_err(|_| storage())?;
        let name = entry.file_name().into_string().map_err(|_| unsafe_entry())?;
        filenames.push(name);
    }
    filenames.sort();
    for name in &filenames {
        let lower = name.to_ascii_lowercase();
        if !seen.insert(lower.clone()) {
            ambiguous.insert(lower);
        }
    }
    for name in filenames {
        let path = root.join(&name);
        let meta = fs::symlink_metadata(&path).map_err(|_| storage())?;
        let safe = meta.file_type().is_file() && !meta.file_type().is_symlink();
        let is_revision = name.ends_with(".txt")
            && valid_revision_id(&name[..name.len()-4]);
        if is_revision && committed.contains(&name[..name.len()-4]) && safe {
            // Existing committed files are inspected by the normal job integrity
            // checker, not exposed as ambiguous recovery artifacts.
            continue;
        }
        let (kind, can_read_text, explanation) =
            if ambiguous.contains(&name.to_ascii_lowercase()) {
                (RecoveryArtifactKind::AmbiguousRevision, false,
                    "Case-ambiguous file identity is preserved and cannot be reattached.")
            } else if !safe {
                (RecoveryArtifactKind::UnsafeRevisionEntry, false,
                    "Unsafe file or symlink is preserved; never follow or reattach.")
            } else if is_revision {
                (RecoveryArtifactKind::OrphanRevision, meta.len() > 0
                    && meta.len() <= MAX_IMPORT_BYTES as u64,
                    "Unreferenced by last verified checkpoint; source operation/ownership cannot be proven.")
            } else if is_tmp(&name) {
                (RecoveryArtifactKind::IncompleteRevisionTemporary, false,
                    "Incomplete temporary publication is preserved; text may be partial.")
            } else {
                (RecoveryArtifactKind::UnsafeRevisionEntry, false,
                    "Unexpected revision artifact is preserved without modification.")
            };
        let mut artifact = RecoveryArtifact {
            artifact_id: name,
            kind, byte_length: if safe { Some(meta.len()) } else { None },
            content_digest: None, can_read_text: false, attachment_proven: false,
            explanation: explanation.into(),
        };
        if can_read_text {
            // A hash proves what bytes are present, NOT where they originated.
            if let Ok(bytes) = read_bounded(&path, meta.len()) {
                if !bytes.contains(&0) && std::str::from_utf8(&bytes).is_ok() {
                    artifact.content_digest = Some(digest(&bytes));
                    artifact.can_read_text = true;
                }
            }
        }
        entries.push(artifact);
    }
    Ok(entries)
}

/// Explicit read-only inspection. No path accepted, no state mutation, and no
/// "recover" action is allowed without a verifiable durable pre-send intent.
pub fn read_orphan_text(
    folder: &Path, job: &ScriptJobRecord, artifact_id: &str,
) -> Result<RecoveryArtifactText, StoreError> {
    if !artifact_id.ends_with(".txt")
        || !valid_revision_id(&artifact_id[..artifact_id.len()-4])
        || job.revisions.iter().any(|r| format!("{}.txt",r.revision_id)==artifact_id) {
        return Err(unsafe_entry());
    }
    let artifacts = inspect_revision_artifacts(folder, job)?;
    let artifact = artifacts.iter().find(|entry| entry.artifact_id==artifact_id)
        .filter(|entry| entry.kind == RecoveryArtifactKind::OrphanRevision
            && entry.can_read_text && !entry.attachment_proven)
        .ok_or_else(unsafe_entry)?;
    let directory = folder.join("revisions");
    if !good_dir(&directory)? { return Err(unsafe_entry()); }
    let path = directory.join(artifact_id);
    let length = safe_file_info(&path)?.ok_or_else(unsafe_entry)?;
    let bytes = read_bounded(&path, length)?;
    let actual = digest(&bytes);
    if Some(actual.as_str()) != artifact.content_digest.as_deref() {
        return Err(unsafe_entry());
    }
    let text = String::from_utf8(bytes).map_err(|_| unsafe_entry())?;
    Ok(RecoveryArtifactText {
        artifact_id: artifact_id.into(), content_digest: actual,
        byte_length: length, text,
    })
}
