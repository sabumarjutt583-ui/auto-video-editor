//! Phase 03C regression tests. All provider flows remain offline.
use super::model::{digest, AppliedJobOperation, MasterPromptSnapshot, ProviderMode, ScriptGenerationRequest, ScriptJobRecord, ScriptJobState};
use super::state::{apply_transition, ScriptJobAction};
use super::store::{injected_state_write, JobMutation, PublicationFault, RecoveryKind, ScriptJobStore, StoreErrorCode};
use std::{fs, path::PathBuf, process::{Command, Stdio}, sync::Arc, thread, time::{Duration, Instant}};

struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("ave-state-{}-{:x}", std::process::id(), rand::random::<u128>()));
        fs::create_dir(&dir).unwrap(); Self(dir)
    }
    fn store(&self) -> ScriptJobStore { ScriptJobStore::new(self.0.clone()).unwrap() }
}
impl Drop for Sandbox { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

fn request(id: &str) -> ScriptGenerationRequest {
    let content = "Keep the original Korean and English narration.\n한국어".to_owned();
    let hash = digest(content.as_bytes());
    ScriptGenerationRequest {
        request_id: id.into(), channel_id: "_old-channel".into(), project_id: None,
        title: "Historic question".into(), topic: "Ancient food".into(), language: "ko".into(),
        requested_words: Some(1200), target_audience: "Adults".into(),
        narration_tone: "calm".into(), storytelling_style: "documentary".into(),
        provider_mode: ProviderMode::ClaudeBrowserAssisted,
        additional_instructions: "No headings.".into(),
        master_prompt: MasterPromptSnapshot {
            channel_id: "_old-channel".into(), content, version_id: hash.clone(),
            content_digest: hash, created_at: None,
        },
    }
}
fn action_prepare(job: &ScriptJobRecord) -> ScriptJobAction {
    ScriptJobAction::Prepare {
        prompt_text: "You are drafting spoken narration.\n한국어 🎬".into(),
        master_prompt_digest: job.request.master_prompt.content_digest.clone(),
    }
}
fn input(job: &ScriptJobRecord, id: &str, action: ScriptJobAction) -> JobMutation {
    JobMutation {
        job_id: job.job_id.clone(), channel_id: job.channel_id.clone(),
        request_id: job.request_id.clone(), expected_revision: job.state_revision,
        operation_id: id.into(), action,
    }
}
fn prepare(store: &ScriptJobStore, job: &ScriptJobRecord) -> ScriptJobRecord {
    store.transition(input(job,"prepare-001",action_prepare(job))).unwrap()
}
fn checkpoint(root: &std::path::Path, job: &ScriptJobRecord, version: u64) -> PathBuf {
    root.join("jobs").join(&job.job_id).join(format!("state-{version:020}.json"))
}

#[test]
fn sw_03c_01_old_phase_03b_fixture_remains_schema_v1_compatible() {
    let fixture = include_str!("../../../src/lib/script/jobs/fixtures/job-v1.json");
    let saved: ScriptJobRecord = serde_json::from_str(fixture).unwrap();
    assert!(saved.validate(&saved.job_id).is_ok());
    assert_eq!(saved.state_revision, 0);
    assert!(saved.applied_operations.is_empty());
    let original: serde_json::Value = serde_json::from_str(fixture).unwrap();
    assert_eq!(serde_json::to_value(&saved).unwrap(), original);
}
#[test]
fn sw_03c_02_created_to_prepared_is_durable_and_exact() {
    let tmp = Sandbox::new(); let store = tmp.store();
    let original = store.create(request("created_to_prepared")).unwrap();
    let next = prepare(&store,&original);
    assert_eq!(next.state, ScriptJobState::Prepared);
    assert_eq!(next.state_revision,1);
    assert_eq!(next.prepared_prompt.as_ref().unwrap().content, "You are drafting spoken narration.\n한국어 🎬");
    assert_eq!(next.prepared_prompt.as_ref().unwrap().master_prompt_digest,original.request.master_prompt.content_digest);
    assert!(checkpoint(&tmp.0,&original,1).exists());
}
#[test]
fn sw_03c_03_prompt_and_operation_history_survive_fresh_instance() {
    let tmp=Sandbox::new();
    let saved={let store=tmp.store();let job=store.create(request("restart_prompt")).unwrap();prepare(&store,&job)};
    let store=tmp.store();
    assert!(saved == store.get(&saved.job_id).unwrap());
    assert_eq!(store.recover().unwrap().jobs[0].state,ScriptJobState::Prepared);
}
#[test]
fn sw_03c_04_invalid_prepared_prompt_digest_is_rejected() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("wrong_master")).unwrap();
    let bad=ScriptJobAction::Prepare{prompt_text:"valid text".into(),master_prompt_digest:"sha256:wrong".into()};
    assert_eq!(store.transition(input(&job,"bad-master",bad)).err().unwrap().code,StoreErrorCode::InvalidOperation);
    assert_eq!(store.get(&job.job_id).unwrap().state_revision,0);
}
#[test]
fn sw_03c_05_unsafe_state_transition_is_rejected() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("unsafe")).unwrap();
    assert_eq!(store.transition(input(&job,"copy-too-early",ScriptJobAction::BeginCopy)).err().unwrap().code,StoreErrorCode::InvalidTransition);
    let prepared=prepare(&store,&job);
    assert_eq!(store.transition(input(&prepared,"copy-too-late",ScriptJobAction::ConfirmCopy)).err().unwrap().code,StoreErrorCode::InvalidTransition);
}
#[test]
fn sw_03c_06_stale_expected_revision_does_not_overwrite() {
    let tmp=Sandbox::new();let store=tmp.store();let first=store.create(request("stale")).unwrap();
    let latest=prepare(&store,&first);
    assert_eq!(store.transition(input(&first,"another-op",action_prepare(&first))).err().unwrap().code,StoreErrorCode::StaleRevision);
    assert!(store.get(&first.job_id).unwrap() == latest);
}
#[test]
fn sw_03c_07_each_committed_transition_increments_once() {
    let tmp=Sandbox::new();let store=tmp.store();let first=store.create(request("revisions")).unwrap();
    let second=prepare(&store,&first);
    let third=store.transition(input(&second,"begin-copy",ScriptJobAction::BeginCopy)).unwrap();
    let fourth=store.transition(input(&third,"confirm-copy",ScriptJobAction::ConfirmCopy)).unwrap();
    assert_eq!([first.state_revision,second.state_revision,third.state_revision,fourth.state_revision],[0,1,2,3]);
    assert_eq!(fourth.applied_operations.len(),3);
}
#[test]
fn sw_03c_08_repeated_operation_replays_original_outcome_after_more_updates() {
    let tmp=Sandbox::new();let store=tmp.store();let first=store.create(request("replay")).unwrap();
    let prepare_op=input(&first,"stable-prep",action_prepare(&first));
    let second=store.transition(prepare_op.clone()).unwrap();
    let third=store.transition(input(&second,"begin-copy",ScriptJobAction::BeginCopy)).unwrap();
    assert!(store.transition(prepare_op).unwrap() == second);
    assert!(store.get(&first.job_id).unwrap() == third);
    drop(store);
    let store=tmp.store();
    assert!(store.transition(input(&first,"stable-prep",action_prepare(&first))).unwrap() == second);
}
#[test]
fn sw_03c_09_reused_operation_id_with_conflicting_content_fails() {
    let tmp=Sandbox::new();let store=tmp.store();let first=store.create(request("conflict")).unwrap();
    prepare(&store,&first);
    assert_eq!(store.transition(input(&first,"prepare-001",ScriptJobAction::Cancel)).err().unwrap().code,StoreErrorCode::OperationConflict);
}
#[test]
fn sw_03c_10_concurrent_updates_have_only_one_winner() {
    let tmp=Sandbox::new();let store=Arc::new(tmp.store());let first=store.create(request("race")).unwrap();let second=prepare(&store,&first);
    let workers:Vec<_>=(0..12).map(|i|{
        let store=Arc::clone(&store);let original=second.clone();
        thread::spawn(move||store.transition(input(&original,&format!("race-{i}"),ScriptJobAction::BeginCopy)))
    }).collect();
    let mut wins=0;let mut stale=0;
    for task in workers {match task.join().unwrap(){Ok(_)=>wins+=1,Err(error) if error.code==StoreErrorCode::StaleRevision=>stale+=1,Err(_)=>panic!("unexpected error")}}
    assert_eq!((wins,stale),(1,11));
    assert_eq!(store.get(&first.job_id).unwrap().state_revision,2);
}
fn make_next(job:&ScriptJobRecord)->ScriptJobRecord {
    let action=action_prepare(job);
    let mut next=job.clone();
    let stamp="2026-11-15T00:00:00.000Z";
    apply_transition(&mut next,&action,stamp).map_err(|_|()).unwrap();
    next.state_revision=1;
    next.updated_at=stamp.into();
    let signature=digest(&serde_json::to_vec(&(0u64,&action)).unwrap());
    next.applied_operations.push(AppliedJobOperation {
        operation_id:"fault-injected".into(), action_digest:signature,
        expected_revision:0, result_revision:1, result_state:ScriptJobState::Prepared
    });
    assert!(next.validate(&next.job_id).is_ok());
    next
}
#[test]
fn sw_03c_11_windows_safe_write_once_update_never_replaces_job_json() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("append_only")).unwrap();
    let old=fs::read(tmp.0.join("jobs").join(&job.job_id).join("job.json")).unwrap();
    let next=prepare(&store,&job);
    assert_eq!(old,fs::read(tmp.0.join("jobs").join(&job.job_id).join("job.json")).unwrap());
    assert_eq!(serde_json::from_slice::<serde_json::Value>(&fs::read(checkpoint(&tmp.0,&job,1)).unwrap()).unwrap()["state"],"prepared");
    assert_eq!(next.state_revision,1);
}
#[test]
fn sw_03c_12_crash_before_publication_retains_previous_valid_state() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("before")).unwrap();
    let next=make_next(&job);let folder=tmp.0.join("jobs").join(&job.job_id);
    assert_eq!(injected_state_write(&folder,&next,PublicationFault::BeforeRename).err().unwrap().code,StoreErrorCode::StorageFailure);
    assert!(store.get(&job.job_id).unwrap() == job);
    assert!(!checkpoint(&tmp.0,&job,1).exists());
}
#[test]
fn sw_03c_13_after_publication_before_ack_retry_finds_committed_state() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("after")).unwrap();
    let next=make_next(&job);let folder=tmp.0.join("jobs").join(&job.job_id);
    assert_eq!(injected_state_write(&folder,&next,PublicationFault::AfterRename).err().unwrap().code,StoreErrorCode::StorageFailure);
    assert!(store.get(&job.job_id).unwrap() == next);
    assert!(store.transition(input(&job,"fault-injected",action_prepare(&job))).unwrap() == next);
}
#[test]
fn sw_03c_14_corrupted_latest_checkpoint_preserves_prior_state_with_diagnostic() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("corrupt_update")).unwrap();
    prepare(&store,&job);
    fs::write(checkpoint(&tmp.0,&job,1),b"{partial").unwrap();
    let recovered=store.recover().unwrap();
    assert_eq!(recovered.jobs.len(),1);
    assert_eq!(recovered.jobs[0].state,ScriptJobState::Created);
    assert!(recovered.issues.iter().any(|e|e.kind==RecoveryKind::CorruptRecord));
    assert_eq!(store.get(&job.job_id).err().unwrap().code,StoreErrorCode::RecoveryBlocked);
    assert_eq!(store.transition(input(&job,"new-op",action_prepare(&job))).err().unwrap().code,StoreErrorCode::RecoveryBlocked);
}
#[test]
fn sw_03c_15_future_version_checkpoint_is_left_untouched() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("future_state")).unwrap();
    prepare(&store,&job);
    let path=checkpoint(&tmp.0,&job,1);
    let mut data:serde_json::Value=serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    data["schemaVersion"]=serde_json::json!(999);
    let original=serde_json::to_vec(&data).unwrap();fs::write(&path,&original).unwrap();
    let report=store.recover().unwrap();
    assert_eq!(report.jobs[0].state,ScriptJobState::Created);
    assert_eq!(report.issues[0].kind,RecoveryKind::UnsupportedVersion);
    assert_eq!(fs::read(path).unwrap(),original);
}
#[test]
fn sw_03c_18_uncertain_submissions_never_allow_automatic_retry_or_cancel() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("uncertain")).unwrap();
    let prepared=prepare(&store,&job);
    let copy=store.transition(input(&prepared,"copy",ScriptJobAction::BeginCopy)).unwrap();
    let copied=store.transition(input(&copy,"copied",ScriptJobAction::ConfirmCopy)).unwrap();
    let intent=store.transition(input(&copied,"intent",ScriptJobAction::BeginManualSubmission)).unwrap();
    let uncertain=store.transition(input(&intent,"uncertain",ScriptJobAction::MarkSubmissionUncertain)).unwrap();
    assert_eq!(uncertain.state,ScriptJobState::SubmissionUncertain);
    assert_eq!(uncertain.recovery_action.as_deref(),Some("manual_reconciliation_required"));
    assert_eq!(store.transition(input(&uncertain,"no-resend",ScriptJobAction::BeginManualSubmission)).err().unwrap().code,StoreErrorCode::InvalidTransition);
    assert_eq!(store.transition(input(&uncertain,"no-cancel",ScriptJobAction::Cancel)).err().unwrap().code,StoreErrorCode::InvalidTransition);
    assert_eq!(store.get(&job.job_id).unwrap().state,ScriptJobState::SubmissionUncertain);
}
#[test]
fn sw_03c_19_cancel_preserves_approved_local_evidence_and_original_request() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("cancel_local")).unwrap();
    let prepared=prepare(&store,&job);
    let cancelled=store.transition(input(&prepared,"cancel",ScriptJobAction::Cancel)).unwrap();
    assert_eq!(cancelled.state,ScriptJobState::Cancelled);
    assert!(cancelled.request == job.request);
    assert!(cancelled.prepared_prompt == prepared.prepared_prompt);
    assert!(store.get(&job.job_id).unwrap() == cancelled);
}
#[test]
fn sw_03c_20_schema_v1_roundtrip_and_non_sending_contract() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("roundtrip")).unwrap();
    let prepared=prepare(&store,&job);
    let serialized=serde_json::to_value(&prepared).unwrap();
    assert_eq!(serialized["schemaVersion"],1);
    assert_eq!(serialized["state"],"prepared");
    assert!(serialized["preparedPrompt"]["contentDigest"].as_str().unwrap().starts_with("sha256:"));
    assert_eq!(serialized["appliedOperations"].as_array().unwrap().len(),1);
    assert!(serde_json::from_value::<ScriptJobRecord>(serialized).unwrap() == prepared);
}
// A real independent OS process (the same test binary running a filtered helper)
// holds or releases writer.lock. This is not a second store in one process.
#[test]
fn sw_03c_child_lock_process() {
    let Ok(root)=std::env::var("SCRIPT_JOBS_CHILD_ROOT") else {return;};
    let store=ScriptJobStore::new(PathBuf::from(&root)).unwrap();
    fs::write(PathBuf::from(&root).join("ready"),b"ready").unwrap();
    let deadline=Instant::now()+Duration::from_secs(20);
    while !PathBuf::from(&root).join("release").exists() && Instant::now()<deadline {
        thread::sleep(Duration::from_millis(25));
    }
    drop(store);
}
fn spawn_child(tmp:&Sandbox)->std::process::Child {
    let executable=std::env::current_exe().unwrap();
    let child=Command::new(executable)
        .args(["--exact","script_jobs::state_tests::sw_03c_child_lock_process","--nocapture"])
        .env("SCRIPT_JOBS_CHILD_ROOT",&tmp.0)
        .stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap();
    let started=Instant::now();
    while !tmp.0.join("ready").exists() {
        if started.elapsed()>Duration::from_secs(8){panic!("independent lock holder did not start");}
        thread::sleep(Duration::from_millis(30));
    }
    child
}
#[test]
fn sw_03c_16_separate_process_lock_is_exclusive_and_normal_exit_releases_it() {
    let tmp=Sandbox::new();
    let mut child=spawn_child(&tmp);
    assert_eq!(ScriptJobStore::new(tmp.0.clone()).err().unwrap().code,StoreErrorCode::WriterBusy);
    fs::write(tmp.0.join("release"),b"exit").unwrap();
    assert!(child.wait().unwrap().success());
    assert!(ScriptJobStore::new(tmp.0.clone()).is_ok());
}
#[test]
fn sw_03c_17_abrupt_independent_process_termination_releases_lock() {
    let tmp=Sandbox::new();
    let mut child=spawn_child(&tmp);
    assert_eq!(ScriptJobStore::new(tmp.0.clone()).err().unwrap().code,StoreErrorCode::WriterBusy);
    child.kill().unwrap();let _=child.wait().unwrap();
    let writer=ScriptJobStore::new(tmp.0.clone()).unwrap();
    assert!(writer.recover().unwrap().issues.is_empty());
}
