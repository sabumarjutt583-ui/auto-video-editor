use super::model::*;
use super::store::*;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;

struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("ave-script-jobs-{}", unique_id()));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
    fn store(&self) -> ScriptJobStore { ScriptJobStore::new(self.0.clone()).unwrap() }
}
impl Drop for Sandbox {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}
fn unique_id() -> String { format!("{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()) }
fn request(id: &str) -> ScriptGenerationRequest {
    let content = "Keep the exact narration style.\n한국어 🎬".to_string();
    let hash = digest(content.as_bytes());
    ScriptGenerationRequest {
        request_id: id.to_string(), channel_id: "_legacy-channel".to_string(), project_id: None,
        title: "An explorer".to_string(), topic: "Human survival".to_string(),
        language: "en".to_string(), requested_words: Some(1200),
        target_audience: "English adults".to_string(), narration_tone: "measured".to_string(),
        storytelling_style: "documentary".to_string(), additional_instructions: "No headings".to_string(),
        provider_mode: ProviderMode::ClaudeBrowserAssisted,
        master_prompt: MasterPromptSnapshot {
            channel_id: "_legacy-channel".to_string(), content, version_id: hash.clone(),
            content_digest: hash, created_at: None,
        },
    }
}
fn record_path(root: &Path, id: &str) -> PathBuf { root.join("jobs").join(id).join("job.json") }

#[test]
fn sw_03b_01_create_commits_versioned_json_and_no_future_steps() {
    let tmp = Sandbox::new();
    let store = tmp.store();
    let job = store.create(request("req-a")).unwrap();
    assert!(valid_job_id(&job.job_id));
    assert_eq!(job.schema_version, 1);
    assert_eq!(job.state, ScriptJobState::Created);
    assert_eq!(job.state_revision, 0);
    assert!(job.revisions.is_empty() && job.prepared_prompt.is_none());
    assert!(record_path(&tmp.0, &job.job_id).is_file());
    assert!(store.get(&job.job_id).unwrap() == job);
}
#[test]
fn sw_03b_02_fresh_instance_recovers_exact_record_after_restart() {
    let tmp = Sandbox::new();
    let job = { let store = tmp.store(); store.create(request("req-restart")).unwrap() };
    let reopened = tmp.store();
    let recovered = reopened.get(&job.job_id).unwrap();
    assert!(recovered == job);
    assert_eq!(reopened.list().unwrap().jobs.len(), 1);
}
#[test]
fn sw_03b_03_repeated_same_request_returns_same_job_and_does_not_rewrite() {
    let tmp = Sandbox::new();
    let store = tmp.store();
    let first = store.create(request("same-request")).unwrap();
    let previous = fs::read(record_path(&tmp.0, &first.job_id)).unwrap();
    let again = store.create(request("same-request")).unwrap();
    assert!(first == again);
    assert_eq!(previous, fs::read(record_path(&tmp.0, &first.job_id)).unwrap());
    assert_eq!(store.list().unwrap().jobs.len(), 1);
}
#[test]
fn sw_03b_04_conflicting_request_id_is_refused() {
    let tmp = Sandbox::new(); let store = tmp.store();
    store.create(request("reused")).unwrap();
    let mut altered = request("reused"); altered.title = "A different title".into();
    assert_eq!(store.create(altered).unwrap_err().code, StoreErrorCode::RequestConflict);
}
#[test]
fn sw_03b_05_concurrent_threads_do_not_create_duplicate_jobs() {
    let tmp = Sandbox::new(); let store = Arc::new(tmp.store());
    let handles: Vec<_> = (0..12).map(|_| {
        let store = Arc::clone(&store);
        thread::spawn(move || store.create(request("threaded")).unwrap().job_id)
    }).collect();
    let ids: Vec<_> = handles.into_iter().map(|thread| thread.join().unwrap()).collect();
    assert!(ids.iter().all(|id| *id == ids[0]));
    assert_eq!(store.list().unwrap().jobs.len(), 1);
}
#[test]
fn sw_03b_06_bad_ids_and_paths_are_rejected() {
    let tmp = Sandbox::new(); let store = tmp.store();
    assert_eq!(store.get("../secret").unwrap_err().code, StoreErrorCode::InvalidJobId);
    let mut bad = request("bad/id");
    assert_eq!(store.create(bad.clone()).unwrap_err().code, StoreErrorCode::InvalidRequest);
    bad.request_id = "valid".into(); bad.channel_id = "other/channel".into();
    assert_eq!(store.create(bad).unwrap_err().code, StoreErrorCode::InvalidRequest);
}
#[test]
fn sw_03b_07_changed_master_digest_and_channel_are_rejected() {
    let tmp = Sandbox::new(); let store = tmp.store();
    let mut bad = request("hash-invalid");
    bad.master_prompt.content.push('!');
    assert_eq!(store.create(bad).unwrap_err().code, StoreErrorCode::InvalidRequest);
    let mut changed = request("wrong-channel");
    changed.master_prompt.channel_id = "another-channel".into();
    assert_eq!(store.create(changed).unwrap_err().code, StoreErrorCode::InvalidRequest);
}
#[test]
fn sw_03b_08_corrupt_neighbor_does_not_hide_healthy_job() {
    let tmp = Sandbox::new(); let store = tmp.store();
    let job = store.create(request("valid-neighbor")).unwrap();
    let broken = tmp.0.join("jobs").join(format!("sj_{}", "b".repeat(32)));
    fs::create_dir(&broken).unwrap();
    fs::write(broken.join("job.json"), b"{truncated").unwrap();
    let report = store.recover().unwrap();
    assert_eq!(report.jobs.len(), 1);
    assert_eq!(report.jobs[0].job_id, job.job_id);
    assert_eq!(report.issues.len(), 1);
    assert_eq!(report.issues[0].kind, RecoveryKind::CorruptRecord);
    assert_eq!(store.create(request("new-after-damage")).unwrap_err().code, StoreErrorCode::RecoveryBlocked);
    assert!(broken.join("job.json").exists(), "do not destroy damaged evidence");
}
#[test]
fn sw_03b_09_future_schema_is_reported_without_rewriting() {
    let tmp = Sandbox::new(); let store = tmp.store();
    let job = store.create(request("future")).unwrap();
    let path = record_path(&tmp.0, &job.job_id);
    let mut data: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    data["schemaVersion"] = serde_json::json!(999);
    let bytes = serde_json::to_vec(&data).unwrap();
    fs::write(&path, &bytes).unwrap();
    assert_eq!(store.get(&job.job_id).unwrap_err().code, StoreErrorCode::UnsupportedVersion);
    assert_eq!(store.recover().unwrap().issues[0].kind, RecoveryKind::UnsupportedVersion);
    assert_eq!(fs::read(path).unwrap(), bytes);
}
#[test]
fn sw_03b_10_storage_failure_is_not_reported_as_success() {
    let tmp = Sandbox::new();
    fs::write(tmp.0.join("jobs"), b"blocking file").unwrap();
    assert_eq!(ScriptJobStore::new(tmp.0.clone()).err().unwrap().code, StoreErrorCode::StorageFailure);
}
#[test]
fn sw_03b_11_interrupted_temp_write_keeps_last_committed_json() {
    let tmp = Sandbox::new(); let store = tmp.store();
    let job = store.create(request("checkpoint")).unwrap();
    let folder = tmp.0.join("jobs").join(&job.job_id);
    let original = fs::read(folder.join("job.json")).unwrap();
    assert_eq!(super::store::injected_partial_write(&folder, &job).unwrap_err().code, StoreErrorCode::StorageFailure);
    assert_eq!(original, fs::read(folder.join("job.json")).unwrap());
    assert!(store.get(&job.job_id).is_ok());
}
#[test]
fn sw_03b_12_recovered_request_is_immutable_and_exact() {
    let tmp = Sandbox::new();
    let immutable = request("keep-original");
    let job = { tmp.store().create(immutable.clone()).unwrap() };
    let mut edited = immutable.clone();
    edited.master_prompt.content = "Later channel settings".into();
    let store = tmp.store();
    let saved = store.get(&job.job_id).unwrap();
    assert_eq!(saved.request.master_prompt.content, immutable.master_prompt.content);
    assert_ne!(saved.request.master_prompt.content, edited.master_prompt.content);
}
#[test]
fn sw_03b_13_fixture_decodes_and_roundtrips_with_same_camel_case_keys() {
    let fixture = include_str!("../../../src/lib/script/jobs/fixtures/job-v1.json");
    let job: ScriptJobRecord = serde_json::from_str(fixture).unwrap();
    assert_eq!(job.job_id, format!("sj_{}", "a".repeat(32)));
    assert_eq!(job.state_revision, 0);
    assert_eq!(job.request.requested_words, Some(1200));
    assert_eq!(job.request.provider_mode, ProviderMode::ClaudeBrowserAssisted);
    assert!(job.validate(&job.job_id).is_ok());
    let raw: serde_json::Value = serde_json::from_str(fixture).unwrap();
    let serialized: serde_json::Value = serde_json::to_value(&job).unwrap();
    assert_eq!(raw, serialized);
}
#[test]
fn sw_03b_14_request_channel_and_project_identifiers_cannot_be_mixed() {
    let tmp = Sandbox::new(); let store = tmp.store();
    let mut input = request("project-identity");
    input.project_id = Some("prj_abc".into());
    let job = store.create(input).unwrap();
    let path = record_path(&tmp.0, &job.job_id);
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["projectId"] = serde_json::Value::Null;
    fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
    assert_eq!(store.get(&job.job_id).unwrap_err().code, StoreErrorCode::CorruptRecord);
}
#[test]
fn sw_03b_15_random_ids_are_unique_under_many_creations() {
    let tmp = Sandbox::new(); let store = tmp.store();
    let mut ids = std::collections::HashSet::new();
    for i in 0..96 {
        let id = store.create(request(&format!("request_{i}"))).unwrap().job_id;
        assert!(valid_job_id(&id) && ids.insert(id));
    }
}
#[test]
fn sw_03b_16_offline_store_works_without_any_provider() {
    let tmp = Sandbox::new(); let store = tmp.store();
    let input = request("no-api");
    assert_eq!(input.provider_mode, ProviderMode::ClaudeBrowserAssisted);
    assert_eq!(store.create(input).unwrap().state, ScriptJobState::Created);
    assert!(store.list().unwrap().issues.is_empty());
}
#[test]
fn sw_03b_17_second_store_instance_fails_closed_while_writer_is_active() {
    let tmp = Sandbox::new(); let writer = tmp.store();
    let err = ScriptJobStore::new(tmp.0.clone()).err().unwrap();
    assert_eq!(err.code, StoreErrorCode::WriterBusy);
    drop(writer);
    assert!(ScriptJobStore::new(tmp.0.clone()).is_ok());
}
#[test]
fn sw_03b_18_uncommitted_folder_is_reported_and_preserved() {
    let tmp = Sandbox::new(); let store = tmp.store();
    let folder = tmp.0.join("jobs").join(format!("sj_{}", "d".repeat(32)));
    fs::create_dir(&folder).unwrap();
    fs::write(folder.join("job-before-crash.tmp"), b"partial").unwrap();
    let report = store.recover().unwrap();
    assert_eq!(report.jobs.len(), 0);
    assert_eq!(report.issues[0].kind, RecoveryKind::IncompleteRecord);
    assert!(folder.join("job-before-crash.tmp").exists());
}
