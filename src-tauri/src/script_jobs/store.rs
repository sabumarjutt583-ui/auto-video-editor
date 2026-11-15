//! Rust-owned durable Script Writer job storage. No provider calls or Tauri commands.
//! All instances MUST hold the OS writer lock. Failed/corrupt records fail closed
//! for new creation, but never hide healthy neighbors from recovery.
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rand::RngCore;
use serde::{Deserialize, Serialize};

use super::lock;
use super::model::{
    request_digest, valid_id, valid_job_id, AppliedJobOperation, ScriptGenerationRequest,
    ScriptJobRecord, ScriptJobState, MAX_OPERATIONS, SCHEMA_VERSION,
};
use super::state::{apply_transition, ScriptJobAction, TransitionError};

const MAX_RECORD_BYTES: u64 = 1_048_576;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StoreErrorCode {
    InvalidRequest, InvalidJobId, RequestConflict, WriterBusy, StorageFailure,
    RecoveryBlocked, JobNotFound, CorruptRecord, UnsupportedVersion,
    StaleRevision, InvalidTransition, InvalidOperation, OperationConflict, OperationHistoryFull,
}
#[derive(Debug)]
pub struct StoreError {
    pub code: StoreErrorCode,
    pub details: &'static str,
}
impl StoreError {
    fn new(code: StoreErrorCode, details: &'static str) -> Self { Self { code, details } }
}
impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str(self.details) }
}
impl std::error::Error for StoreError {}
fn storage() -> StoreError { StoreError::new(StoreErrorCode::StorageFailure, "Script job storage operation failed.") }
fn bad_record() -> StoreError { StoreError::new(StoreErrorCode::CorruptRecord, "Script job record is unreadable or inconsistent.") }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryKind {
    CorruptRecord, UnsupportedVersion, IncompleteRecord, UnsafeEntry, IoError, DuplicateRequest,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryIssue {
    pub job_id: String,
    pub kind: RecoveryKind,
    /// Fixed diagnostic, never a copied prompt or private OS error path.
    pub message: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryReport {
    pub jobs: Vec<ScriptJobRecord>,
    pub issues: Vec<RecoveryIssue>,
}

fn make_issue(id: String, kind: RecoveryKind, message: &'static str) -> RecoveryIssue {
    RecoveryIssue { job_id: id, kind, message: message.to_string() }
}
fn now_iso() -> String {
    let millis = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    let seconds = millis / 1000;
    let day = (seconds / 86_400) as i64;
    let sec = seconds % 86_400;
    format!("{}T{:02}:{:02}:{:02}.{:03}Z",
        crate::clock::civil_date(day), sec / 3600, sec % 3600 / 60, sec % 60, millis % 1000)
}
fn random_suffix() -> String {
    let mut bytes = [0u8; 16];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn check_directory(path: &Path) -> Result<(), StoreError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => Ok(()),
        Ok(_) => Err(storage()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(path).map_err(|_| storage())
        }
        Err(_) => Err(storage()),
    }
}
fn load_record(folder: &Path, id: &str) -> Result<ScriptJobRecord, StoreError> {
    load_committed_file(&folder.join("job.json"), id)
}
fn load_committed_file(file: &Path, id: &str) -> Result<ScriptJobRecord, StoreError> {
    let meta = fs::symlink_metadata(&file).map_err(|e| if e.kind() == std::io::ErrorKind::NotFound {
        StoreError::new(StoreErrorCode::JobNotFound, "Script job record is missing.")
    } else { storage() })?;
    if meta.file_type().is_symlink() || !meta.is_file() || meta.len() > MAX_RECORD_BYTES { return Err(bad_record()); }
    let mut data = Vec::new();
    File::open(&file).map_err(|_| storage())?
        .take(MAX_RECORD_BYTES + 1).read_to_end(&mut data).map_err(|_| storage())?;
    if data.len() as u64 > MAX_RECORD_BYTES { return Err(bad_record()); }
    let version: serde_json::Value = serde_json::from_slice(&data).map_err(|_| bad_record())?;
    match version.get("schemaVersion").and_then(serde_json::Value::as_u64) {
        Some(v) if v > u64::from(SCHEMA_VERSION) => {
            return Err(StoreError::new(StoreErrorCode::UnsupportedVersion, "Script job was written by a newer version."));
        }
        Some(v) if v == u64::from(SCHEMA_VERSION) => {}
        _ => return Err(bad_record()),
    }
    let record: ScriptJobRecord = serde_json::from_value(version).map_err(|_| bad_record())?;
    record.validate(id).map_err(|_| bad_record())?;
    Ok(record)
}
fn issue_from_load(id: String, err: &StoreError) -> RecoveryIssue {
    match err.code {
        StoreErrorCode::UnsupportedVersion => make_issue(id, RecoveryKind::UnsupportedVersion, "Record belongs to a future app version; preserved."),
        StoreErrorCode::JobNotFound => make_issue(id, RecoveryKind::IncompleteRecord, "No committed job record; preserved for recovery."),
        StoreErrorCode::CorruptRecord => make_issue(id, RecoveryKind::CorruptRecord, "Invalid or inconsistent job JSON; preserved."),
        _ => make_issue(id, RecoveryKind::IoError, "The job record could not be read; no changes were made."),
    }
}

/// One owning process holds the lock for the store's lifetime. A second
/// process or second instance fails immediately. OS releases lock on crash.
pub struct ScriptJobStore {
    root: PathBuf,
    lock_file: File,
    operation: Mutex<()>,
}
impl ScriptJobStore {
    pub fn new(root: PathBuf) -> Result<Self, StoreError> {
        check_directory(&root)?;
        check_directory(&root.join("jobs"))?;
        // The lock file itself is persistent, but kernel file locks disappear
        // when a process exits. Never infer ownership from file existence.
        let path = root.join("writer.lock");
        if let Ok(meta) = fs::symlink_metadata(&path) {
            if !meta.is_file() || meta.file_type().is_symlink() { return Err(storage()); }
        }
        let file = OpenOptions::new().read(true).write(true).create(true)
            .open(&path).map_err(|_| storage())?;
        lock::try_lock(&file).map_err(|_| StoreError::new(StoreErrorCode::WriterBusy, "Another Script Writer store owns this directory."))?;
        Ok(Self { root, lock_file: file, operation: Mutex::new(()) })
    }
    /// Future Tauri setup will pass app_data_dir()/script-writer. No app paths hardcoded.
    pub fn root(&self) -> &Path { &self.root }
    pub fn get(&self, job_id: &str) -> Result<ScriptJobRecord, StoreError> {
        if !valid_job_id(job_id) { return Err(StoreError::new(StoreErrorCode::InvalidJobId, "Invalid script job ID.")); }
        let folder = self.root.join("jobs").join(job_id);
        let meta = fs::symlink_metadata(&folder).map_err(|e| if e.kind() == std::io::ErrorKind::NotFound {
            StoreError::new(StoreErrorCode::JobNotFound, "Script job not found.")
        } else { storage() })?;
        if meta.file_type().is_symlink() || !meta.is_dir() { return Err(bad_record()); }
        let (job, issues) = load_latest(&folder, job_id)?;
        if !issues.is_empty() {
            return Err(StoreError::new(StoreErrorCode::RecoveryBlocked, "Unverified state updates exist; inspect recovery findings."));
        }
        Ok(job)
    }
    /// Preserve every damaged/unknown-version entry. Never quarantine automatically
    /// without a separate user-approved recovery transaction.
    pub fn recover(&self) -> Result<RecoveryReport, StoreError> {
        let mut report = RecoveryReport { jobs: Vec::new(), issues: Vec::new() };
        let entries = fs::read_dir(self.root.join("jobs")).map_err(|_| storage())?;
        for entry in entries {
            let entry = entry.map_err(|_| storage())?;
            let id = entry.file_name().to_string_lossy().into_owned();
            let file_type = match entry.file_type() {
                Ok(kind) => kind,
                Err(_) => {
                    report.issues.push(make_issue(id, RecoveryKind::IoError, "Cannot inspect job directory entry."));
                    continue;
                }
            };
            if !valid_job_id(&id) || !file_type.is_dir() || file_type.is_symlink() {
                report.issues.push(make_issue(id, RecoveryKind::UnsafeEntry, "Unexpected entry in jobs directory; preserved."));
                continue;
            }
            match load_latest(&entry.path(), &id) {
                Ok((job, issues)) => {
                    report.jobs.push(job);
                    report.issues.extend(issues);
                }
                Err(err) => report.issues.push(issue_from_load(id, &err)),
            }
        }
        report.jobs.sort_by(|a,b| a.job_id.cmp(&b.job_id));
        report.issues.sort_by(|a,b| a.job_id.cmp(&b.job_id));
        // Duplicate durable request IDs make lookup ambiguous. Surface the
        // issue and block any further create until manually reconciled.
        for i in 1..report.jobs.len() {
            if report.jobs[..i].iter().any(|prev| prev.request_id == report.jobs[i].request_id) {
                report.issues.push(make_issue(report.jobs[i].job_id.clone(), RecoveryKind::DuplicateRequest, "Multiple jobs claim the same request ID."));
            }
        }
        Ok(report)
    }
    pub fn list(&self) -> Result<RecoveryReport, StoreError> { self.recover() }

    pub fn create(&self, request: ScriptGenerationRequest) -> Result<ScriptJobRecord, StoreError> {
        request.validate().map_err(|_| StoreError::new(StoreErrorCode::InvalidRequest, "Invalid immutable Script Writer request."))?;
        let fingerprint = request_digest(&request).map_err(|_| storage())?;
        let _exclusive = self.operation.lock().unwrap_or_else(|p| p.into_inner());
        let report = self.recover()?;
        if !report.issues.is_empty() {
            return Err(StoreError::new(StoreErrorCode::RecoveryBlocked, "Unverified job files exist; inspect recovery findings before creating jobs."));
        }
        if let Some(existing) = report.jobs.into_iter().find(|job| job.request_id == request.request_id) {
            if existing.request_digest == fingerprint && existing.request == request { return Ok(existing); }
            return Err(StoreError::new(StoreErrorCode::RequestConflict, "Request ID already belongs to different immutable content."));
        }

        let now = now_iso();
        for _ in 0..32 {
            let job_id = format!("sj_{}", random_suffix());
            let folder = self.root.join("jobs").join(&job_id);
            match fs::create_dir(&folder) {
                Ok(()) => {
                    let record = ScriptJobRecord {
                        schema_version: SCHEMA_VERSION, job_id, request_id: request.request_id.clone(),
                        channel_id: request.channel_id.clone(), project_id: request.project_id.clone(),
                        request, request_digest: fingerprint, state: ScriptJobState::Created,
                        state_revision: 0, created_at: now.clone(), updated_at: now,
                        prepared_prompt: None, revisions: Vec::new(),
                        approved_revision_id: None, error_code: None, recovery_action: None,
                        applied_operations: Vec::new(),
                    };
                    persist_initial(&folder, &record, false)?;
                    return Ok(record);
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => return Err(storage()),
            }
        }
        Err(StoreError::new(StoreErrorCode::StorageFailure, "Could not allocate unique Script Writer job ID."))
    }

    /// A stale retry of a committed operation returns its *original* revision,
    /// even if other valid operations were committed later.
    pub fn transition(&self, input: JobMutation) -> Result<ScriptJobRecord, StoreError> {
        if !valid_job_id(&input.job_id) || !valid_id(&input.channel_id)
            || !valid_id(&input.request_id) || !valid_id(&input.operation_id) {
            return Err(StoreError::new(StoreErrorCode::InvalidOperation, "Invalid job transition identifiers."));
        }
        // Serialize a typed action plus its expected revision. This digest is
        // private metadata, never a way to authorize otherwise invalid steps.
        let signature = serde_json::to_vec(&(input.expected_revision, &input.action))
            .map_err(|_| storage())?;
        let signature = super::model::digest(&signature);
        let _exclusive = self.operation.lock().unwrap_or_else(|p| p.into_inner());
        let folder = self.root.join("jobs").join(&input.job_id);
        let meta = fs::symlink_metadata(&folder).map_err(|_| storage())?;
        if !meta.is_dir() || meta.file_type().is_symlink() { return Err(bad_record()); }
        let (current, issues) = load_latest(&folder, &input.job_id)?;
        if !issues.is_empty() {
            return Err(StoreError::new(StoreErrorCode::RecoveryBlocked, "Unverified state revisions block mutation."));
        }
        if current.channel_id != input.channel_id || current.request_id != input.request_id {
            return Err(StoreError::new(StoreErrorCode::InvalidOperation, "The job does not belong to this request and channel."));
        }
        if let Some(applied) = current.applied_operations.iter().find(|entry| entry.operation_id == input.operation_id) {
            if applied.action_digest != signature || applied.expected_revision != input.expected_revision {
                return Err(StoreError::new(StoreErrorCode::OperationConflict, "Operation ID already represents different content."));
            }
            let old = if applied.result_revision == 0 {
                load_record(&folder, &input.job_id)?
            } else {
                load_committed_file(&state_path(&folder, applied.result_revision), &input.job_id)?
            };
            return Ok(old);
        }
        if current.state_revision != input.expected_revision {
            return Err(StoreError::new(StoreErrorCode::StaleRevision, "Job state revision is stale."));
        }
        if current.applied_operations.len() == MAX_OPERATIONS {
            return Err(StoreError::new(StoreErrorCode::OperationHistoryFull, "Durable operation history is full; an explicit migration is required."));
        }
        let mut next = current.clone();
        let stamp = now_iso();
        apply_transition(&mut next, &input.action, &stamp).map_err(|e| match e {
            TransitionError::InvalidTransition => StoreError::new(StoreErrorCode::InvalidTransition, "Action is not allowed in the current job state."),
            TransitionError::InvalidPreparedPrompt => StoreError::new(StoreErrorCode::InvalidOperation, "Prepared prompt is empty, oversized or belongs to another master prompt."),
        })?;
        next.state_revision = current.state_revision.checked_add(1).ok_or_else(storage)?;
        next.updated_at = stamp;
        next.applied_operations.push(AppliedJobOperation {
            operation_id: input.operation_id,
            action_digest: signature,
            expected_revision: input.expected_revision,
            result_revision: next.state_revision,
            result_state: next.state.clone(),
        });
        next.validate(&next.job_id).map_err(|_| bad_record())?;
        publish_state(&folder, &next, PublicationFault::None)?;
        Ok(next)
    }
}
impl Drop for ScriptJobStore {
    fn drop(&mut self) { lock::unlock(&self.lock_file); }
}

/// Only initial create is writable in Phase 03B. Do not expose arbitrary
/// update/state transition methods before Phase 03C's CAS state machine.
fn persist_initial(folder: &Path, record: &ScriptJobRecord, interrupt_before_publish: bool) -> Result<(), StoreError> {
    record.validate(&record.job_id).map_err(|_| bad_record())?;
    let json = serde_json::to_vec_pretty(record).map_err(|_| storage())?;
    if json.len() as u64 > MAX_RECORD_BYTES { return Err(storage()); }
    let temp = folder.join(format!("job-{}.tmp", random_suffix()));
    let mut file = OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|_| storage())?;
    let operation = (|| {
        file.write_all(&json).map_err(|_| storage())?;
        file.flush().map_err(|_| storage())?;
        file.sync_all().map_err(|_| storage())?;
        if interrupt_before_publish { return Err(storage()); }
        // Only publish into a never-before-committed directory. This is a
        // same-directory rename with no prior valid target to overwrite.
        if folder.join("job.json").exists() { return Err(storage()); }
        fs::rename(&temp, folder.join("job.json")).map_err(|_| storage())?;
        #[cfg(unix)]
        {
            // Directory sync is not uniformly supported by Windows handles.
            File::open(folder).and_then(|dir| dir.sync_all()).map_err(|_| storage())?;
        }
        Ok(())
    })();
    if operation.is_err() {
        let _ = fs::remove_file(&temp); // never delete job.json or existing records
    }
    operation
}

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobMutation {
    pub job_id: String,
    pub channel_id: String,
    pub request_id: String,
    pub expected_revision: u64,
    pub operation_id: String,
    pub action: ScriptJobAction,
}

fn state_path(folder: &Path, revision: u64) -> PathBuf {
    folder.join(format!("state-{revision:020}.json"))
}

/// Read the entire contiguous generation chain. A damaged future checkpoint
/// never overwrites or silently hides the last known-good record. Every problem
/// becomes a recovery issue and makes future mutations fail closed.
fn load_latest(folder: &Path, id: &str) -> Result<(ScriptJobRecord, Vec<RecoveryIssue>), StoreError> {
    let mut latest = load_record(folder, id)?;
    let mut snapshots = Vec::<(u64, PathBuf)>::new();
    let mut issues = Vec::new();
    let entries = fs::read_dir(folder).map_err(|_| storage())?;
    for e in entries {
        let e = e.map_err(|_| storage())?;
        let file_name = e.file_name().to_string_lossy().into_owned();
        if file_name == "job.json" { continue; }
        if file_name.starts_with("job-") && file_name.ends_with(".tmp")
            || file_name.starts_with("state-") && file_name.ends_with(".tmp") {
            issues.push(make_issue(id.to_string(), RecoveryKind::IncompleteRecord, "Uncommitted temporary file preserved for inspection."));
            continue;
        }
        if file_name.starts_with("state-") && file_name.ends_with(".json") {
            let digits = &file_name[6..file_name.len() - 5];
            if digits.len() != 20 || !digits.bytes().all(|b| b.is_ascii_digit()) {
                issues.push(make_issue(id.to_string(), RecoveryKind::UnsafeEntry, "Invalid state snapshot name."));
                continue;
            }
            let Some(revision) = digits.parse::<u64>().ok().filter(|r| *r > 0) else {
                issues.push(make_issue(id.to_string(), RecoveryKind::UnsafeEntry, "Invalid state snapshot revision."));
                continue;
            };
            snapshots.push((revision, e.path()));
        } else {
            issues.push(make_issue(id.to_string(), RecoveryKind::UnsafeEntry, "Unexpected job folder entry preserved."));
        }
    }
    snapshots.sort_by_key(|x| x.0);
    for (revision, path) in snapshots {
        if revision != latest.state_revision + 1 {
            issues.push(make_issue(id.to_string(), RecoveryKind::IncompleteRecord, "State revision chain is incomplete or ambiguous."));
            break;
        }
        match load_committed_file(&path, id) {
            Ok(snapshot) => {
                if snapshot.state_revision != revision
                    || snapshot.request != latest.request || snapshot.request_digest != latest.request_digest
                    || snapshot.created_at != latest.created_at
                    || snapshot.applied_operations[..snapshot.applied_operations.len()-1] != latest.applied_operations[..] {
                    issues.push(make_issue(id.to_string(), RecoveryKind::CorruptRecord, "State checkpoint violates immutable job history."));
                    break;
                }
                latest = snapshot;
            }
            Err(error) => {
                issues.push(issue_from_load(id.to_string(), &error));
                break;
            }
        }
    }
    Ok((latest, issues))
}

#[derive(Clone, Copy)]
pub(super) enum PublicationFault {
    None,
    BeforeRename,
    AfterRename,
}

/// Write-once generation snapshots avoid replacing an existing Windows file.
fn publish_state(folder: &Path, record: &ScriptJobRecord, fault: PublicationFault) -> Result<(), StoreError> {
    record.validate(&record.job_id).map_err(|_| bad_record())?;
    let json = serde_json::to_vec_pretty(record).map_err(|_| storage())?;
    if json.len() as u64 > MAX_RECORD_BYTES { return Err(storage()); }
    let dest = state_path(folder, record.state_revision);
    if dest.exists() { return Err(StoreError::new(StoreErrorCode::StorageFailure, "Committed revision already exists.")); }
    let temp = folder.join(format!("state-{}.tmp", random_suffix()));
    let mut file = OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|_| storage())?;
    let outcome = (|| {
        file.write_all(&json).map_err(|_| storage())?;
        file.flush().map_err(|_| storage())?;
        file.sync_all().map_err(|_| storage())?;
        if matches!(fault, PublicationFault::BeforeRename) { return Err(storage()); }
        // The store-wide OS lease + process mutex enforce single-writer ownership.
        // The committed destination is *new*, so Windows does not need
        // ReplaceFileW/MoveFileEx replacement of an existing job.json.
        fs::rename(&temp, &dest).map_err(|_| storage())?;
        if matches!(fault, PublicationFault::AfterRename) { return Err(storage()); }
        #[cfg(unix)]
        File::open(folder).and_then(|dir| dir.sync_all()).map_err(|_| storage())?;
        Ok(())
    })();
    if outcome.is_err() {
        // Removing an uncommitted temporary file is safe. Never remove dest.
        let _ = fs::remove_file(&temp);
    }
    outcome
}
#[cfg(test)]
pub(super) fn injected_state_write(folder: &Path, next: &ScriptJobRecord, fault: PublicationFault) -> Result<(), StoreError> {
    publish_state(folder, next, fault)
}

#[cfg(test)]
pub(super) fn injected_partial_write(folder: &Path, job: &ScriptJobRecord) -> Result<(), StoreError> {
    persist_initial(folder, job, true)
}
