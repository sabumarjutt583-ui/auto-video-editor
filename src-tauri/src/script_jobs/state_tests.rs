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


fn import_action(text: &str) -> ScriptJobAction {
    ScriptJobAction::ImportResponse { text: text.to_owned() }
}
fn imported_path(tmp: &Sandbox, job: &ScriptJobRecord, revision_id: &str) -> PathBuf {
    tmp.0.join("jobs").join(&job.job_id).join("revisions").join(format!("{revision_id}.txt"))
}
#[test]
fn sw_03d_01_old_jobs_and_prepared_checkpoints_still_load() {
    sw_03c_01_old_phase_03b_fixture_remains_schema_v1_compatible();
    let tmp = Sandbox::new();
    let before = { let store=tmp.store(); let job=store.create(request("legacy_prepared")).unwrap(); prepare(&store,&job) };
    let store = tmp.store();
    assert!(store.get(&before.job_id).unwrap() == before);
    assert!(store.get(&before.job_id).unwrap().revisions.is_empty());
}
#[test]
fn sw_03d_02_copy_intent_is_durable_before_clipboard_activity() {
    let tmp=Sandbox::new(); let store=tmp.store();
    let job=store.create(request("copy_intent")).unwrap(); let prepared=prepare(&store,&job);
    let copying=store.transition(input(&prepared,"begin-copy",ScriptJobAction::BeginCopy)).unwrap();
    assert_eq!(copying.state,ScriptJobState::CopyIntent);
    drop(store);
    assert_eq!(tmp.store().get(&job.job_id).unwrap().state, ScriptJobState::CopyIntent);
}
#[test]
fn sw_03d_03_successful_copy_confirmation_only_after_explicit_action() {
    let tmp=Sandbox::new(); let store=tmp.store();
    let job=store.create(request("copy_success")).unwrap(); let ready=prepare(&store,&job);
    let intent=store.transition(input(&ready,"copy-intent",ScriptJobAction::BeginCopy)).unwrap();
    assert_eq!(intent.state,ScriptJobState::CopyIntent);
    let copied=store.transition(input(&intent,"confirmed-copy",ScriptJobAction::ConfirmCopy)).unwrap();
    assert_eq!(copied.state,ScriptJobState::Copied);
}
#[test]
fn sw_03d_04_clipboard_failure_does_not_claim_copied() {
    let tmp=Sandbox::new(); let store=tmp.store();
    let job=store.create(request("clipboard_failure")).unwrap();let ready=prepare(&store,&job);
    let intent=store.transition(input(&ready,"clipboard-intent",ScriptJobAction::BeginCopy)).unwrap();
    assert_eq!(store.get(&job.job_id).unwrap().state,ScriptJobState::CopyIntent);
    let waiting=store.transition(input(&intent,"manual-copy",ScriptJobAction::AwaitUserAction {
        reason: super::state::WaitingReason::ManualAction
    })).unwrap();
    assert_eq!(waiting.state,ScriptJobState::AwaitingUserAction);
    assert_eq!(waiting.recovery_action.as_deref(),Some("manual_action"));
}
#[test]
fn sw_03d_05_explicit_manual_submission_user_confirmed() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("submit")).unwrap();
    let prepared=prepare(&store,&job);
    let copied_intent=store.transition(input(&prepared,"copy",ScriptJobAction::BeginCopy)).unwrap();
    let copied=store.transition(input(&copied_intent,"copied",ScriptJobAction::ConfirmCopy)).unwrap();
    let sent_intent=store.transition(input(&copied,"intent",ScriptJobAction::BeginManualSubmission)).unwrap();
    assert_eq!(sent_intent.state,ScriptJobState::SubmissionIntent);
    assert!(sent_intent.submission_evidence.is_none());
    let confirmed=store.transition(input(&sent_intent,"user-confirm",ScriptJobAction::ConfirmSubmitted)).unwrap();
    assert_eq!(confirmed.state,ScriptJobState::Submitted);
    assert_eq!(confirmed.submission_evidence,Some(super::model::ManualSubmissionEvidence::UserConfirmed));
    drop(store);
    assert_eq!(tmp.store().get(&job.job_id).unwrap().state,ScriptJobState::Submitted);
}
#[test]
fn sw_03d_06_uncertain_submission_remains_uncertain_until_explicit_user_choice() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("uncertain_manual")).unwrap();
    let prepared=prepare(&store,&job);
    let waiting=store.transition(input(&prepared,"wait",ScriptJobAction::AwaitUserAction {
        reason:super::state::WaitingReason::ManualAction })).unwrap();
    let intent=store.transition(input(&waiting,"intent",ScriptJobAction::BeginManualSubmission)).unwrap();
    let uncertain=store.transition(input(&intent,"uncertain",ScriptJobAction::MarkSubmissionUncertain)).unwrap();
    drop(store);
    let store=tmp.store();
    let reloaded=store.get(&job.job_id).unwrap();
    assert!(reloaded==uncertain);
    assert_eq!(store.transition(input(&reloaded,"no-retry",ScriptJobAction::BeginManualSubmission)).err().unwrap().code,
        StoreErrorCode::InvalidTransition);
    let confirmed=store.transition(input(&reloaded,"explicit-confirm",ScriptJobAction::ConfirmSubmitted)).unwrap();
    assert_eq!(confirmed.submission_evidence,Some(super::model::ManualSubmissionEvidence::UserConfirmed));
}
#[test]
fn sw_03d_07_user_can_explicitly_confirm_no_submission_took_place() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("no_submission")).unwrap();
    let prepared=prepare(&store,&job);
    let waiting=store.transition(input(&prepared,"wait",ScriptJobAction::AwaitUserAction{
        reason:super::state::WaitingReason::ManualAction })).unwrap();
    let intent=store.transition(input(&waiting,"intent",ScriptJobAction::BeginManualSubmission)).unwrap();
    let not_sent=store.transition(input(&intent,"not-sent",ScriptJobAction::ConfirmNotSubmitted)).unwrap();
    assert_eq!(not_sent.state,ScriptJobState::Copied);
    assert_eq!(not_sent.submission_evidence,Some(super::model::ManualSubmissionEvidence::UserConfirmedNotSubmitted));
}
#[test]
fn sw_03d_08_unicode_response_import_preserves_every_character_and_hash() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("unicode")).unwrap();
    let ready=prepare(&store,&job);
    let text="\n한글 🎬 Urdu: اردو\n“Quotes” — apostrophes ' \r\n final  \n";
    let saved=store.transition(input(&ready,"import-1",import_action(text))).unwrap();
    assert_eq!(saved.state,ScriptJobState::ResponseReceived);
    assert_eq!(saved.revisions.len(),1);
    assert_eq!(saved.revisions[0].content_digest,digest(text.as_bytes()));
    assert_eq!(saved.revisions[0].byte_length,text.len() as u64);
    assert_eq!(saved.revisions[0].source,super::model::ScriptRevisionSource::ManualImport);
    assert!(saved.approved_revision_id.is_none());
    let path=imported_path(&tmp,&job,&saved.revisions[0].revision_id);
    assert_eq!(fs::read(&path).unwrap(),text.as_bytes());
    let read=store.read_response(&job.job_id,&job.channel_id,&job.request_id,&saved.revisions[0].revision_id).unwrap();
    assert_eq!(read.text,text);
}
#[test]
fn sw_03d_09_empty_and_oversized_responses_rejected_without_files() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("badresponse")).unwrap();
    let ready=prepare(&store,&job);
    for text in ["", " \n \t", "contains\0nul"] {
        assert_eq!(store.transition(input(&ready,"invalid",import_action(text))).err().unwrap().code,StoreErrorCode::InvalidResponse);
    }
    let too_large="x".repeat(super::model::MAX_IMPORT_BYTES+1);
    assert_eq!(store.transition(input(&ready,"too-large",import_action(&too_large))).err().unwrap().code,StoreErrorCode::InvalidResponse);
    assert!(store.get(&job.job_id).unwrap()==ready);
}
#[test]
fn sw_03d_10_import_channel_and_request_isolation() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("isolation")).unwrap();
    let ready=prepare(&store,&job);
    let mut bad=input(&ready,"bad-channel",import_action("Valid response"));
    bad.channel_id="other-channel".into();
    assert_eq!(store.transition(bad).err().unwrap().code,StoreErrorCode::InvalidOperation);
    let mut bad=input(&ready,"bad-request",import_action("Valid response"));
    bad.request_id="other-request".into();
    assert_eq!(store.transition(bad).err().unwrap().code,StoreErrorCode::InvalidOperation);
    assert!(store.get(&job.job_id).unwrap()==ready);
}
#[test]
fn sw_03d_11_immutable_response_is_not_overwritten_by_second_import() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("immutable")).unwrap();
    let ready=prepare(&store,&job);
    let saved=store.transition(input(&ready,"first-import",import_action("Original response"))).unwrap();
    let path=imported_path(&tmp,&job,&saved.revisions[0].revision_id);
    let original=fs::read(&path).unwrap();
    assert_eq!(store.transition(input(&saved,"second-import",import_action("Different response"))).err().unwrap().code,StoreErrorCode::InvalidTransition);
    assert_eq!(fs::read(path).unwrap(),original);
}
#[test]
fn sw_03d_12_duplicate_import_idempotent_even_after_process_restart() {
    let tmp=Sandbox::new();
    let (job,ready,saved)={let store=tmp.store();let job=store.create(request("retry_import")).unwrap();
        let ready=prepare(&store,&job);
        let saved=store.transition(input(&ready,"repeat-import",import_action("First complete script"))).unwrap();
        (job,ready,saved)};
    let store=tmp.store();
    let repeated=store.transition(input(&ready,"repeat-import",import_action("First complete script"))).unwrap();
    assert!(repeated==saved);
    assert_eq!(store.get(&job.job_id).unwrap().revisions.len(),1);
}
#[test]
fn sw_03d_13_conflicting_operation_id_and_stale_revision_fail_closed() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("import_conflict")).unwrap();
    let ready=prepare(&store,&job);
    store.transition(input(&ready,"same-id",import_action("Text A"))).unwrap();
    assert_eq!(store.transition(input(&ready,"same-id",import_action("Text B"))).err().unwrap().code,StoreErrorCode::OperationConflict);
    assert_eq!(store.transition(input(&ready,"fresh-id",import_action("Text C"))).err().unwrap().code,StoreErrorCode::StaleRevision);
}
#[test]
fn sw_03d_14_crash_before_text_publication_keeps_last_checkpoint() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("before_revision")).unwrap();
    let ready=prepare(&store,&job);
    let result=store.inject_import_fault(input(&ready,"fault-import",import_action("Recoverable response")),
        super::store::ImportFault::BeforeRevision);
    assert_eq!(result.err().unwrap().code,StoreErrorCode::StorageFailure);
    let report=store.recover().unwrap();
    assert_eq!(report.jobs[0].state,ScriptJobState::Prepared);
    assert!(report.issues.iter().any(|issue|issue.kind==RecoveryKind::IncompleteRecord));
}
#[test]
fn sw_03d_15_crash_after_text_before_metadata_reports_orphan_without_deleting_it() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("orphan_revision")).unwrap();
    let ready=prepare(&store,&job);
    let result=store.inject_import_fault(input(&ready,"orphan-action",import_action("Unreferenced but saved response")),
        super::store::ImportFault::AfterRevision);
    assert_eq!(result.err().unwrap().code,StoreErrorCode::StorageFailure);
    let report=store.recover().unwrap();
    assert_eq!(report.jobs[0].state,ScriptJobState::Prepared);
    assert!(report.issues.iter().any(|issue|issue.kind==RecoveryKind::OrphanRevision));
    assert_eq!(store.get(&job.job_id).err().unwrap().code,StoreErrorCode::RecoveryBlocked);
    let directory=tmp.0.join("jobs").join(&job.job_id).join("revisions");
    assert_eq!(fs::read_dir(directory).unwrap().count(),1);
}
#[test]
fn sw_03d_16_crash_after_metadata_commit_retry_returns_exact_saved_response() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("after_checkpoint")).unwrap();
    let ready=prepare(&store,&job);
    let action=input(&ready,"crash-after",import_action("Response survives acknowledgement failure"));
    assert_eq!(store.inject_import_fault(action.clone(),super::store::ImportFault::AfterCheckpoint).err().unwrap().code,StoreErrorCode::StorageFailure);
    let saved=store.get(&job.job_id).unwrap();
    assert_eq!(saved.state,ScriptJobState::ResponseReceived);
    assert!(store.transition(action).unwrap()==saved);
}
#[test]
fn sw_03d_17_corruption_is_detected_and_previous_state_survives() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("corrupt_text")).unwrap();
    let ready=prepare(&store,&job);
    let saved=store.transition(input(&ready,"import",import_action("Original UTF-8"))).unwrap();
    let file=imported_path(&tmp,&job,&saved.revisions[0].revision_id);
    fs::write(&file,b"modified text").unwrap();
    let report=store.recover().unwrap();
    assert_eq!(report.jobs[0].state,ScriptJobState::Prepared);
    assert!(report.issues.iter().any(|issue|issue.kind==RecoveryKind::CorruptRecord));
    assert_eq!(store.get(&job.job_id).err().unwrap().code,StoreErrorCode::RecoveryBlocked);
    assert_eq!(fs::read(file).unwrap(),b"modified text");
}
#[test]
fn sw_03d_18_orphaned_response_after_restart_does_not_auto_submit_or_delete() {
    let tmp=Sandbox::new();
    let job={let store=tmp.store();let job=store.create(request("orphan_restart")).unwrap();
        let ready=prepare(&store,&job);
        store.inject_import_fault(input(&ready,"orphan",import_action("Retain me")),
            super::store::ImportFault::AfterRevision).err().unwrap();
        job};
    let store=tmp.store();
    let report=store.recover().unwrap();
    assert_eq!(report.jobs[0].state,ScriptJobState::Prepared);
    assert!(report.issues.iter().any(|issue|issue.kind==RecoveryKind::OrphanRevision));
    assert!(tmp.0.join("jobs").join(&job.job_id).join("revisions").is_dir());
}
#[test]
fn sw_03d_19_import_requires_manual_action_and_never_approves_or_runs_provider() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("no_provider")).unwrap();
    let ready=prepare(&store,&job);
    let imported=store.transition(input(&ready,"user_import",import_action("Only a manually pasted response"))).unwrap();
    assert_eq!(imported.state,ScriptJobState::ResponseReceived);
    assert!(imported.approved_revision_id.is_none());
    assert!(imported.request.provider_mode==ProviderMode::ClaudeBrowserAssisted);
}
#[test]
fn sw_03d_20_response_read_rejects_other_channel_and_id() {
    let tmp=Sandbox::new();let store=tmp.store();let job=store.create(request("read_privacy")).unwrap();
    let ready=prepare(&store,&job);
    let saved=store.transition(input(&ready,"import",import_action("Private response"))).unwrap();
    let revision=&saved.revisions[0].revision_id;
    assert_eq!(store.read_response(&job.job_id,"another-channel",&job.request_id,revision).err().unwrap().code,StoreErrorCode::InvalidOperation);
    assert_eq!(store.read_response(&job.job_id,&job.channel_id,&job.request_id,"../bad").err().unwrap().code,StoreErrorCode::InvalidOperation);
}

#[test]
fn sw_03d_21_shared_imported_v1_fixture_decodes_and_roundtrips_with_exact_fields() {
    let fixture=include_str!("../../../src/lib/script/jobs/fixtures/imported-job-v1.json");
    let record:ScriptJobRecord=serde_json::from_str(fixture).unwrap();
    assert!(record.validate(&record.job_id).is_ok());
    assert_eq!(record.state,ScriptJobState::ResponseReceived);
    assert_eq!(record.revisions.len(),1);
    assert_eq!(record.revisions[0].content_digest,
        digest("A complete imported response.\nاردو 🎬".as_bytes()));
    assert_eq!(record.revisions[0].source,super::model::ScriptRevisionSource::ManualImport);
    let parsed:serde_json::Value=serde_json::from_str(fixture).unwrap();
    assert_eq!(serde_json::to_value(record).unwrap(),parsed);
}


fn imported_for_review(store: &ScriptJobStore, id: &str, text: &str) -> ScriptJobRecord {
    let created=store.create(request(id)).unwrap();
    let prepared=prepare(store,&created);
    store.transition(input(&prepared,"import-review",import_action(text))).unwrap()
}
fn review_action(job: &ScriptJobRecord, kind: &str) -> ScriptJobAction {
    let reference=&job.revisions[0];
    let revision_id=reference.revision_id.clone();
    let content_digest=reference.content_digest.clone();
    match kind {
        "start" => ScriptJobAction::StartValidation { revision_id, content_digest },
        "finish" => ScriptJobAction::CompleteValidation { revision_id, content_digest },
        "review" => ScriptJobAction::BeginReview { revision_id, content_digest },
        "approve" => ScriptJobAction::ApproveRevision {
            revision_id, content_digest, validation_version: "script-rules-v1".into(),
        },
        _ => panic!("unknown review test action"),
    }
}
fn reviewed(store: &ScriptJobStore, id: &str, text: &str) -> ScriptJobRecord {
    let imported=imported_for_review(store,id,text);
    let validating=store.transition(input(&imported,"start-validation",review_action(&imported,"start"))).unwrap();
    let draft=store.transition(input(&validating,"finish-validation",review_action(&validating,"finish"))).unwrap();
    store.transition(input(&draft,"start-review",review_action(&draft,"review"))).unwrap()
}

#[test]
fn sw_03e_01_older_json_fixtures_still_roundtrip_without_migration() {
    sw_03c_01_old_phase_03b_fixture_remains_schema_v1_compatible();
    sw_03d_21_shared_imported_v1_fixture_decodes_and_roundtrips_with_exact_fields();
}
#[test]
fn sw_03e_02_deterministic_word_counts_and_language_preservation() {
    let temp=Sandbox::new();let store=temp.store();
    let imported=imported_for_review(&store,"count_unicode","One two three.\n한국어 اردو 🎬 end.");
    let text=store.read_response(&imported.job_id,&imported.channel_id,&imported.request_id,
        &imported.revisions[0].revision_id).unwrap().text;
    let report=super::validation::analyze(&text,&imported.revisions[0],imported.request.requested_words);
    assert_eq!(report.actual_word_count,7);
    assert_eq!(report.requested_word_count,Some(1200));
    assert_eq!(report.validation_version,"script-rules-v1");
    assert_eq!(report.content_digest,digest(text.as_bytes()));
    assert!(report.findings.iter().any(|x|x.code=="below_requested_length"));
    assert!(report==super::validation::analyze(&text,&imported.revisions[0],Some(1200)));
}
#[test]
fn sw_03e_03_rule_based_quality_warnings_are_not_technical_errors() {
    let temp=Sandbox::new();let store=temp.store();
    let imported=imported_for_review(&store,"warnings","## Introduction\n[INSERT content] to be continued...");
    let report=super::validation::analyze("## Introduction\n[INSERT content] to be continued...",
        &imported.revisions[0],None);
    assert!(report.findings.iter().any(|x|x.code=="placeholder_marker"));
    assert!(report.findings.iter().any(|x|x.code=="narration_formatting"));
    assert!(report.findings.iter().any(|x|x.code=="possible_incomplete_ending"));
    assert!(!super::validation::has_technical_errors(&report));
    let failed=super::validation::analyze("   ",&imported.revisions[0],None);
    assert!(super::validation::has_technical_errors(&failed));
    assert!(failed.findings.iter().any(|x|x.code=="empty_script"));
}
#[test]
fn sw_03e_04_validation_requires_exact_revision_and_imported_state() {
    let temp=Sandbox::new();let store=temp.store();let raw=store.create(request("validate_preconditions")).unwrap();
    assert_eq!(store.transition(input(&raw,"bad-start",
        ScriptJobAction::StartValidation{revision_id:"rev_".to_owned()+"a".repeat(64).as_str(),
        content_digest:"sha256:".to_owned()+"a".repeat(64).as_str()}))
        .err().unwrap().code,StoreErrorCode::InvalidTransition);
    let imported=imported_for_review(&store,"validate_identity","Verified response.");
    let mut action=review_action(&imported,"start");
    if let ScriptJobAction::StartValidation {ref mut content_digest,..}=action{
        *content_digest=digest(b"wrong");
    }
    assert_eq!(store.transition(input(&imported,"wrong-digest",action))
        .err().unwrap().code,StoreErrorCode::InvalidTransition);
    assert_eq!(store.get(&imported.job_id).unwrap().state,ScriptJobState::ResponseReceived);
}
#[test]
fn sw_03e_05_all_review_steps_are_durable_and_keep_exact_imported_text() {
    let temp=Sandbox::new();let store=temp.store();
    let imported=imported_for_review(&store,"durable_review","Intro.\nOriginal 🎬 narrative.");
    let original=store.read_response(&imported.job_id,&imported.channel_id,&imported.request_id,
        &imported.revisions[0].revision_id).unwrap().text;
    let validating=store.transition(input(&imported,"start",review_action(&imported,"start"))).unwrap();
    assert_eq!(validating.state,ScriptJobState::Validating);
    assert!(validating.review_report.is_none());
    let draft=store.transition(input(&validating,"finish",review_action(&validating,"finish"))).unwrap();
    assert_eq!(draft.state,ScriptJobState::DraftSaved);
    assert_eq!(draft.review_report.as_ref().unwrap().actual_word_count,4);
    assert_eq!(draft.review_report.as_ref().unwrap().revision_id,imported.revisions[0].revision_id);
    let pending=store.transition(input(&draft,"review",review_action(&draft,"review"))).unwrap();
    assert_eq!(pending.state,ScriptJobState::ReviewPending);
    assert!(pending.approval_record.is_none());
    drop(store);
    let recovered=temp.store();
    assert!(recovered.get(&pending.job_id).unwrap()==pending);
    let text=recovered.read_response(&pending.job_id,&pending.channel_id,&pending.request_id,
        &pending.revisions[0].revision_id).unwrap().text;
    assert_eq!(text,original);
}
#[test]
fn sw_03e_06_approval_is_an_explicit_verified_user_action() {
    let temp=Sandbox::new();let store=temp.store();
    let pending=reviewed(&store,"user_approved","One two three. Complete narration.");
    assert!(pending.approved_revision_id.is_none());
    let approved=store.transition(input(&pending,"manual-approve",review_action(&pending,"approve"))).unwrap();
    assert_eq!(approved.state,ScriptJobState::Approved);
    assert_eq!(approved.approved_revision_id.as_deref(),Some(approved.revisions[0].revision_id.as_str()));
    let proof=approved.approval_record.as_ref().unwrap();
    assert_eq!(proof.source,"user_confirmed");
    assert_eq!(proof.content_digest,approved.revisions[0].content_digest);
    assert_eq!(proof.validation_version,"script-rules-v1");
    assert!(approved==store.get(&pending.job_id).unwrap());
}
#[test]
fn sw_03e_07_wrong_revision_or_rule_version_cannot_be_approved() {
    let temp=Sandbox::new();let store=temp.store();
    let pending=reviewed(&store,"wrong_approval","A complete example.");
    let mut wrong=review_action(&pending,"approve");
    if let ScriptJobAction::ApproveRevision{ref mut revision_id,..}=wrong {
        *revision_id="rev_".to_owned()+&"a".repeat(64);
    }
    assert_eq!(store.transition(input(&pending,"wrong-revision",wrong)).err().unwrap().code,
        StoreErrorCode::InvalidTransition);
    let mut version=review_action(&pending,"approve");
    if let ScriptJobAction::ApproveRevision{ref mut validation_version,..}=version {
        *validation_version="outdated-rules-v0".into();
    }
    assert_eq!(store.transition(input(&pending,"wrong-version",version)).err().unwrap().code,
        StoreErrorCode::InvalidTransition);
    assert_eq!(store.get(&pending.job_id).unwrap().state,ScriptJobState::ReviewPending);
}
#[test]
fn sw_03e_08_cross_channel_approval_and_stale_revisions_are_rejected() {
    let temp=Sandbox::new();let store=temp.store();
    let pending=reviewed(&store,"approval_isolation","A complete story.");
    let mut input_bad=input(&pending,"other-owner",review_action(&pending,"approve"));
    input_bad.channel_id="another-channel".into();
    assert_eq!(store.transition(input_bad).err().unwrap().code,StoreErrorCode::InvalidOperation);
    let approved=store.transition(input(&pending,"approval-once",review_action(&pending,"approve"))).unwrap();
    assert_eq!(store.transition(input(&pending,"stale-approval",review_action(&pending,"approve")))
        .err().unwrap().code,StoreErrorCode::StaleRevision);
    assert_eq!(store.get(&pending.job_id).unwrap().state_revision,approved.state_revision);
}
#[test]
fn sw_03e_09_idempotent_approval_replay_survives_restart_and_rejects_conflicts() {
    let temp=Sandbox::new();
    let (before,after)={let store=temp.store();let job=reviewed(&store,"approval_replay","A complete example.");
        let after=store.transition(input(&job,"approval-key",review_action(&job,"approve"))).unwrap();
        (job,after)};
    let store=temp.store();
    assert!(store.transition(input(&before,"approval-key",review_action(&before,"approve"))).unwrap()==after);
    assert_eq!(store.transition(input(&before,"approval-key",review_action(&before,"review")))
        .err().unwrap().code,StoreErrorCode::OperationConflict);
}
#[test]
fn sw_03e_10_corrupt_import_blocks_validation_without_discarding_history() {
    let temp=Sandbox::new();let store=temp.store();let imported=imported_for_review(&store,
        "corrupt_before_validate","Safely imported text.");
    let file=imported_path(&temp,&imported,&imported.revisions[0].revision_id);
    fs::write(&file,b"tampered text").unwrap();
    let report=store.recover().unwrap();
    assert_eq!(report.jobs[0].state,ScriptJobState::Prepared);
    assert!(report.issues.iter().any(|i|i.kind==RecoveryKind::CorruptRecord));
    assert_eq!(store.transition(input(&imported,"start",review_action(&imported,"start")))
        .err().unwrap().code,StoreErrorCode::RecoveryBlocked);
    assert_eq!(fs::read(&file).unwrap(),b"tampered text");
}
#[test]
fn sw_03e_11_altered_committed_validation_report_is_detected_on_restart() {
    let temp=Sandbox::new();let store=temp.store();let pending=reviewed(&store,
        "tampered_report","A trustworthy original story.");
    let file=checkpoint(&temp.0,&pending,pending.state_revision);
    let mut json:serde_json::Value=serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    json["reviewReport"]["actualWordCount"]=serde_json::json!(9000);
    fs::write(&file,serde_json::to_vec_pretty(&json).unwrap()).unwrap();
    let report=store.recover().unwrap();
    assert!(report.issues.iter().any(|i|i.kind==RecoveryKind::CorruptRecord));
    assert_eq!(store.get(&pending.job_id).err().unwrap().code,StoreErrorCode::RecoveryBlocked);
}
#[test]
fn sw_03e_12_review_failure_before_publication_keeps_old_snapshot() {
    let temp=Sandbox::new();let store=temp.store();
    let pending=reviewed(&store,"before_approval","An original response.");
    let call=input(&pending,"crash-before",review_action(&pending,"approve"));
    assert_eq!(store.inject_import_fault(call,super::store::ImportFault::BeforeCheckpoint)
        .err().unwrap().code,StoreErrorCode::StorageFailure);
    assert_eq!(store.get(&pending.job_id).unwrap().state,ScriptJobState::ReviewPending);
}
#[test]
fn sw_03e_13_approval_post_publication_retry_returns_committed_result() {
    let temp=Sandbox::new();let store=temp.store();
    let pending=reviewed(&store,"after_approval","A complete original story.");
    let call=input(&pending,"crash-after",review_action(&pending,"approve"));
    assert_eq!(store.inject_import_fault(call.clone(),super::store::ImportFault::AfterCheckpoint)
        .err().unwrap().code,StoreErrorCode::StorageFailure);
    let approved=store.get(&pending.job_id).unwrap();
    assert_eq!(approved.state,ScriptJobState::Approved);
    assert!(store.transition(call).unwrap()==approved);
}
#[test]
fn sw_03e_14_concurrent_approval_operations_cannot_both_commit() {
    let temp=Sandbox::new();let store=Arc::new(temp.store());
    let pending=reviewed(&store,"parallel_approve","Safe approved text.");
    let tasks:Vec<_>=(0..8).map(|i| {
        let store=Arc::clone(&store); let pending=pending.clone();
        thread::spawn(move||store.transition(input(&pending,&format!("approval-{i}"),review_action(&pending,"approve"))))
    }).collect();
    let mut success=0;let mut stale=0;
    for t in tasks { match t.join().unwrap() {
        Ok(_)=>success+=1,
        Err(e) if e.code==StoreErrorCode::StaleRevision => stale+=1,
        Err(_)=>panic!("unexpected error"),
    } }
    assert_eq!((success,stale),(1,7));
}
#[test]
fn sw_03e_15_approval_never_mutates_imported_text_or_project() {
    let temp=Sandbox::new();let store=temp.store();let original=" \nFull response in اردو. \r\n";
    let pending=reviewed(&store,"preserve_approval",original);
    let file=imported_path(&temp,&pending,&pending.revisions[0].revision_id);
    let before=fs::read(&file).unwrap();
    let approved=store.transition(input(&pending,"authorize",review_action(&pending,"approve"))).unwrap();
    assert_eq!(fs::read(&file).unwrap(),before);
    assert!(approved.project_id.is_none());
    assert_eq!(approved.approval_record.as_ref().unwrap().source,"user_confirmed");
    assert_eq!(approved.request.master_prompt.content,pending.request.master_prompt.content);
}
#[test]
fn sw_03e_16_approval_never_follows_validation_or_review_automatically() {
    let temp=Sandbox::new();let store=temp.store();
    let imported=imported_for_review(&store,"never_autoapprove","Human review required.");
    let validating=store.transition(input(&imported,"start",review_action(&imported,"start"))).unwrap();
    let draft=store.transition(input(&validating,"finish",review_action(&validating,"finish"))).unwrap();
    assert!(draft.approved_revision_id.is_none());
    let pending=store.transition(input(&draft,"review",review_action(&draft,"review"))).unwrap();
    assert!(pending.approved_revision_id.is_none());
    drop(store);
    assert_eq!(temp.store().get(&pending.job_id).unwrap().state,ScriptJobState::ReviewPending);
}


#[test]
fn sw_03e_17_approved_schema_v1_fixture_roundtrips_without_changing_old_jobs() {
    let raw=include_str!("../../../src/lib/script/jobs/fixtures/approved-job-v1.json");
    let saved:ScriptJobRecord=serde_json::from_str(raw).unwrap();
    assert!(saved.validate(&saved.job_id).is_ok());
    assert_eq!(saved.state,ScriptJobState::Approved);
    assert_eq!(saved.review_report.as_ref().unwrap().actual_word_count,6);
    assert_eq!(saved.approval_record.as_ref().unwrap().source,"user_confirmed");
    let expected:serde_json::Value=serde_json::from_str(raw).unwrap();
    assert_eq!(serde_json::to_value(saved).unwrap(),expected);
    sw_03c_01_old_phase_03b_fixture_remains_schema_v1_compatible();
    sw_03d_21_shared_imported_v1_fixture_decodes_and_roundtrips_with_exact_fields();
}


fn revision_action(job: &ScriptJobRecord, action: &str) -> ScriptJobAction {
    let reference=job.selected_revision().unwrap();
    let id=reference.revision_id.clone();
    let hash=reference.content_digest.clone();
    match action {
        "start" => ScriptJobAction::StartValidation { revision_id: id, content_digest: hash },
        "finish" => ScriptJobAction::CompleteValidation { revision_id: id, content_digest: hash },
        "review" => ScriptJobAction::BeginReview { revision_id: id, content_digest: hash },
        "approve" => ScriptJobAction::ApproveRevision {
            revision_id: id, content_digest: hash, validation_version: "script-rules-v1".into(),
        },
        _ => panic!("unexpected review action"),
    }
}
fn edit_version(store: &ScriptJobStore, original: &ScriptJobRecord,
    operation: &str, parent: &str, text: &str) -> ScriptJobRecord {
    store.transition(input(original,operation,ScriptJobAction::CreateRevision {
        origin_revision_id: parent.into(),text:text.into(),
    })).unwrap()
}
fn review_selected(store: &ScriptJobStore, original: &ScriptJobRecord, id: &str) -> ScriptJobRecord {
    let running=store.transition(input(original,&format!("{id}-start"),revision_action(original,"start"))).unwrap();
    let draft=store.transition(input(&running,&format!("{id}-finish"),revision_action(&running,"finish"))).unwrap();
    store.transition(input(&draft,&format!("{id}-review"),revision_action(&draft,"review"))).unwrap()
}

#[test]
fn sw_03f_01_all_older_schema_one_fixtures_remain_unchanged() {
    sw_03c_01_old_phase_03b_fixture_remains_schema_v1_compatible();
    sw_03d_21_shared_imported_v1_fixture_decodes_and_roundtrips_with_exact_fields();
    sw_03e_17_approved_schema_v1_fixture_roundtrips_without_changing_old_jobs();
}
#[test]
fn sw_03f_02_two_immutable_versions_preserve_exact_unicode_and_origin() {
    let temp=Sandbox::new();let store=temp.store();
    let original=imported_for_review(&store,"two_versions"," Original 🎬\r\nবাংলা اردو \n");
    let parent=original.revisions[0].revision_id.clone();
    let newer=edit_version(&store,&original,"rev-2",&parent," Updated 🎬\r\nবাংলا اردو  \n");
    assert_eq!(newer.state,ScriptJobState::ResponseReceived);
    assert_eq!(newer.revisions.len(),2);
    assert!(newer.revisions[0] == original.revisions[0]);
    assert_eq!(newer.revisions[1].origin_revision_id.as_deref(),Some(parent.as_str()));
    assert_ne!(newer.revisions[0].revision_id,newer.revisions[1].revision_id);
    assert_eq!(newer.selected_revision_id.as_deref(),Some(newer.revisions[1].revision_id.as_str()));
    assert_eq!(store.read_response(&newer.job_id,&newer.channel_id,&newer.request_id,&parent).unwrap().text,
        " Original 🎬\r\nবাংলা اردو \n");
    assert_eq!(store.read_response(&newer.job_id,&newer.channel_id,&newer.request_id,
        &newer.revisions[1].revision_id).unwrap().text," Updated 🎬\r\nবাংলا اردو  \n");
}
#[test]
fn sw_03f_03_third_version_can_reference_original_and_preserve_order() {
    let temp=Sandbox::new();let store=temp.store();
    let first=imported_for_review(&store,"third_version","Base text");
    let root=first.revisions[0].revision_id.clone();
    let second=edit_version(&store,&first,"edit-two",&root,"Second version");
    let third=edit_version(&store,&second,"edit-three",&root,"Third version based on original");
    assert_eq!(third.revisions.len(),3);
    assert_eq!(third.revisions[2].origin_revision_id.as_deref(),Some(root.as_str()));
    assert!(third.revisions[0] == first.revisions[0]);
    assert!(third.revisions[1] == second.revisions[1]);
    assert!(store.list_revisions(&third.job_id,&third.channel_id,&third.request_id).unwrap() == third.revisions);
}
#[test]
fn sw_03f_04_approval_is_archived_and_not_inherited_by_edit() {
    let temp=Sandbox::new();let store=temp.store();
    let old=reviewed(&store,"archive_first","Original text is complete.");
    let approved=store.transition(input(&old,"approve-one",review_action(&old,"approve"))).unwrap();
    let old_id=approved.revisions[0].revision_id.clone();
    let newer=edit_version(&store,&approved,"edit-after-approval",&old_id,"New draft with no approval");
    assert_eq!(newer.state,ScriptJobState::ResponseReceived);
    assert!(newer.approved_revision_id.is_none());
    assert!(newer.approval_record.is_none());
    assert!(newer.review_report.is_none());
    assert_eq!(newer.approval_history.len(),1);
    assert!(newer.approval_history[0] == approved.approval_record.clone().unwrap());
    assert!(newer.validation_history.iter().any(|report|report.revision_id==old_id));
}
#[test]
fn sw_03f_05_new_revision_requires_new_validation_and_explicit_reapproval() {
    let temp=Sandbox::new();let store=temp.store();
    let old=reviewed(&store,"reapprove_new","Old approved text");
    let first_approved=store.transition(input(&old,"approve-one",review_action(&old,"approve"))).unwrap();
    let origin=first_approved.revisions[0].revision_id.clone();
    let created=edit_version(&store,&first_approved,"new-manual-edit",&origin,"New script must be reviewed.");
    assert_eq!(store.transition(input(&created,"approve-without-review",
        revision_action(&created,"approve"))).err().unwrap().code,StoreErrorCode::InvalidTransition);
    let pending=review_selected(&store,&created,"new");
    assert_eq!(pending.state,ScriptJobState::ReviewPending);
    assert!(pending.approved_revision_id.is_none());
    assert_eq!(pending.review_report.as_ref().unwrap().revision_id,pending.revisions[1].revision_id);
    let approved=store.transition(input(&pending,"approve-two",revision_action(&pending,"approve"))).unwrap();
    assert_eq!(approved.approved_revision_id.as_deref(),Some(approved.revisions[1].revision_id.as_str()));
    assert_eq!(approved.approval_history.len(),1);
    assert_eq!(approved.approval_history[0].revision_id,origin);
}
#[test]
fn sw_03f_06_selecting_historically_approved_version_does_not_reapprove_it() {
    let temp=Sandbox::new();let store=temp.store();
    let old=reviewed(&store,"old_selection","Original reviewed");
    let approved=store.transition(input(&old,"approve-first",review_action(&old,"approve"))).unwrap();
    let original_id=approved.revisions[0].revision_id.clone();
    let second=edit_version(&store,&approved,"edit-second",&original_id,"New version");
    let selected=store.transition(input(&second,"select-first",
        ScriptJobAction::SelectRevision { revision_id: original_id.clone() })).unwrap();
    assert_eq!(selected.state,ScriptJobState::ResponseReceived);
    assert_eq!(selected.selected_revision_id.as_deref(),Some(original_id.as_str()));
    assert!(selected.approved_revision_id.is_none());
    assert!(selected.approval_record.is_none());
    assert_eq!(selected.approval_history.len(),1);
    assert!(selected.review_report.is_none());
    assert!(store.transition(input(&selected,"premature-approve",revision_action(&selected,"approve"))).is_err());
}
#[test]
fn sw_03f_07_selection_and_reapproval_survive_restart_without_mutating_text() {
    let temp=Sandbox::new();
    let saved={let store=temp.store();
        let old=reviewed(&store,"restart_versions","Old complete manuscript");
        let first=store.transition(input(&old,"old-approval",review_action(&old,"approve"))).unwrap();
        let parent=first.revisions[0].revision_id.clone();
        let newer=edit_version(&store,&first,"edit-v2",&parent,"New complete manuscript");
        let pending=review_selected(&store,&newer,"second");
        store.transition(input(&pending,"approve-v2",revision_action(&pending,"approve"))).unwrap()};
    let store=temp.store();
    let got=store.get(&saved.job_id).unwrap();
    assert!(got == saved);
    assert_eq!(got.approval_history.len(),1);
    assert_eq!(got.revisions.len(),2);
    for reference in &got.revisions {
        let original=store.read_response(&got.job_id,&got.channel_id,&got.request_id,&reference.revision_id).unwrap();
        assert_eq!(digest(original.text.as_bytes()),reference.content_digest);
    }
}
#[test]
fn sw_03f_08_cross_channel_and_invalid_origin_are_blocked() {
    let temp=Sandbox::new();let store=temp.store();
    let first=imported_for_review(&store,"cross_channel_rev","One version");
    let parent=first.revisions[0].revision_id.clone();
    let mut wrong=input(&first,"foreign",ScriptJobAction::CreateRevision{
        origin_revision_id:parent.clone(),text:"No entry".into()});
    wrong.channel_id="another_channel".into();
    assert_eq!(store.transition(wrong).err().unwrap().code,StoreErrorCode::InvalidOperation);
    assert_eq!(store.transition(input(&first,"invalid-parent",ScriptJobAction::CreateRevision{
        origin_revision_id:"rev_".to_string()+&"f".repeat(64),text:"No entry".into()
    })).err().unwrap().code,StoreErrorCode::InvalidTransition);
    assert_eq!(store.list_revisions(&first.job_id,"other_channel",&first.request_id).err().unwrap().code,
        StoreErrorCode::InvalidOperation);
    assert!(store.get(&first.job_id).unwrap() == first);
}
#[test]
fn sw_03f_09_duplicate_revision_creation_is_idempotent_after_restart() {
    let temp=Sandbox::new();
    let (first,second)={let store=temp.store();
        let first=imported_for_review(&store,"idempotent_edit","Base text");
        let second=edit_version(&store,&first,"stable-version-op",&first.revisions[0].revision_id,"Manual edit");
        (first,second)};
    let store=temp.store();
    let input=input(&first,"stable-version-op",ScriptJobAction::CreateRevision{
        origin_revision_id:first.revisions[0].revision_id.clone(),text:"Manual edit".into()});
    assert!(store.transition(input).unwrap() == second);
    assert_eq!(store.list_revisions(&second.job_id,&second.channel_id,&second.request_id).unwrap().len(),2);
}
#[test]
fn sw_03f_10_conflicting_operation_id_and_stale_revision_rejected() {
    let temp=Sandbox::new();let store=temp.store();
    let first=imported_for_review(&store,"stale_edit","Original");
    let second=edit_version(&store,&first,"same-op",&first.revisions[0].revision_id,"Second");
    let conflicted=input(&first,"same-op",ScriptJobAction::CreateRevision{
        origin_revision_id:first.revisions[0].revision_id.clone(),text:"Changed text".into()});
    assert_eq!(store.transition(conflicted).err().unwrap().code,StoreErrorCode::OperationConflict);
    let stale=input(&first,"different-id",ScriptJobAction::CreateRevision{
        origin_revision_id:first.revisions[0].revision_id.clone(),text:"Third".into()});
    assert_eq!(store.transition(stale).err().unwrap().code,StoreErrorCode::StaleRevision);
    assert!(store.get(&first.job_id).unwrap() == second);
}
#[test]
fn sw_03f_11_parallel_versions_at_same_expected_revision_never_both_commit() {
    let temp=Sandbox::new();let store=Arc::new(temp.store());
    let first=imported_for_review(&store,"race_edits","Original");
    let work:Vec<_>=(0..6).map(|i|{
        let store=Arc::clone(&store);let first=first.clone();
        thread::spawn(move||store.transition(input(&first,&format!("race-{i}"),
            ScriptJobAction::CreateRevision{origin_revision_id:first.revisions[0].revision_id.clone(),
                text:format!("Version {i}")})))
    }).collect();
    let mut success=0;let mut stale=0;
    for handle in work {match handle.join().unwrap(){
        Ok(_) => success+=1,
        Err(e) if e.code==StoreErrorCode::StaleRevision => stale+=1,
        Err(_) => panic!("unexpected concurrent result"),
    }}
    assert_eq!(success,1); assert_eq!(stale,5);
    assert_eq!(store.get(&first.job_id).unwrap().revisions.len(),2);
}
#[test]
fn sw_03f_12_comparison_reports_changed_lines_and_correct_word_counts() {
    let temp=Sandbox::new();let store=temp.store();
    let first=imported_for_review(&store,"compare_lines","Intro\nOld ending\n");
    let id_a=first.revisions[0].revision_id.clone();
    let second=edit_version(&store,&first,"new-ending",&id_a,"Intro\nNew ending\n");
    let id_b=second.revisions[1].revision_id.clone();
    let result=store.compare_revisions(&first.job_id,&first.channel_id,&first.request_id,
        &id_a,&id_b).unwrap();
    assert_eq!((result.word_count_a,result.word_count_b),(3,3));
    let value=serde_json::to_value(&result).unwrap();
    let kinds:Vec<&str>=value["lines"].as_array().unwrap().iter()
        .map(|line|line["kind"].as_str().unwrap()).collect();
    assert!(kinds.contains(&"unchanged"));
    assert!(kinds.contains(&"added"));
    assert!(kinds.contains(&"removed"));
    assert!(store.get(&first.job_id).unwrap() == second);
}
#[test]
fn sw_03f_13_comparison_is_bounded_and_identity_checked() {
    let temp=Sandbox::new();let store=temp.store();
    let first=imported_for_review(&store,"compare_bound","First text");
    let second=edit_version(&store,&first,"large-version",&first.revisions[0].revision_id,
        &"x".repeat(131_073));
    assert_eq!(store.compare_revisions(&second.job_id,&second.channel_id,&second.request_id,
        &second.revisions[0].revision_id,&second.revisions[1].revision_id).err().unwrap().code,
        StoreErrorCode::ComparisonTooLarge);
    assert_eq!(store.compare_revisions(&second.job_id,"other",&second.request_id,
        &second.revisions[0].revision_id,&second.revisions[1].revision_id).err().unwrap().code,
        StoreErrorCode::InvalidOperation);
    assert_eq!(store.compare_revisions(&second.job_id,&second.channel_id,&second.request_id,
        &second.revisions[0].revision_id,&second.revisions[0].revision_id).err().unwrap().code,
        StoreErrorCode::InvalidOperation);
}
#[test]
fn sw_03f_14_corrupted_older_revision_blocks_job_without_deletion() {
    let temp=Sandbox::new();let store=temp.store();
    let first=imported_for_review(&store,"tampered_old","Original text");
    let second=edit_version(&store,&first,"edited-second",&first.revisions[0].revision_id,"New text");
    let old_path=imported_path(&temp,&first,&first.revisions[0].revision_id);
    fs::write(&old_path,b"tampered old").unwrap();
    let issues=store.recover().unwrap();
    assert!(issues.issues.iter().any(|i|i.kind==RecoveryKind::CorruptRecord));
    assert_eq!(store.get(&second.job_id).err().unwrap().code,StoreErrorCode::RecoveryBlocked);
    assert_eq!(fs::read(old_path).unwrap(),b"tampered old");
}
#[test]
fn sw_03f_15_crash_after_file_before_checkpoint_preserves_orphan() {
    let temp=Sandbox::new();let store=temp.store();
    let first=imported_for_review(&store,"orphan_new","Stable original");
    let call=input(&first,"orphan-edit",ScriptJobAction::CreateRevision{
        origin_revision_id:first.revisions[0].revision_id.clone(),text:"Recoverable new text".into()});
    assert_eq!(store.inject_import_fault(call,super::store::ImportFault::AfterRevision)
        .err().unwrap().code,StoreErrorCode::StorageFailure);
    let recovery=store.recover().unwrap();
    assert!(recovery.issues.iter().any(|issue|issue.kind==RecoveryKind::OrphanRevision));
    assert_eq!(recovery.jobs[0].revisions.len(),1);
    assert_eq!(store.get(&first.job_id).err().unwrap().code,StoreErrorCode::RecoveryBlocked);
}
#[test]
fn sw_03f_16_crash_before_revision_publish_retains_temporary_text() {
    let temp=Sandbox::new();let store=temp.store();
    let first=imported_for_review(&store,"temp_new","Stable original");
    let call=input(&first,"temp-edit",ScriptJobAction::CreateRevision{
        origin_revision_id:first.revisions[0].revision_id.clone(),text:"Temporary new text".into()});
    assert_eq!(store.inject_import_fault(call,super::store::ImportFault::BeforeRevision)
        .err().unwrap().code,StoreErrorCode::StorageFailure);
    let recovery=store.recover().unwrap();
    assert!(recovery.issues.iter().any(|issue|issue.kind==RecoveryKind::IncompleteRecord));
    assert_eq!(recovery.jobs[0].revisions.len(),1);
}
#[test]
fn sw_03f_17_post_checkpoint_ack_failure_replays_identical_revision() {
    let temp=Sandbox::new();let store=temp.store();
    let first=imported_for_review(&store,"after_publish","Stable text");
    let call=input(&first,"same-edit",ScriptJobAction::CreateRevision{
        origin_revision_id:first.revisions[0].revision_id.clone(),text:"Committed new content".into()});
    assert_eq!(store.inject_import_fault(call.clone(),super::store::ImportFault::AfterCheckpoint)
        .err().unwrap().code,StoreErrorCode::StorageFailure);
    let committed=store.get(&first.job_id).unwrap();
    assert_eq!(committed.revisions.len(),2);
    assert!(store.transition(call).unwrap() == committed);
}
#[test]
fn sw_03f_18_revision_selection_crash_keeps_prior_selection_and_blocks_when_uncertain() {
    let temp=Sandbox::new();let store=temp.store();
    let first=imported_for_review(&store,"select_crash","Stable text");
    let second=edit_version(&store,&first,"add-second",&first.revisions[0].revision_id,"New text");
    let call=input(&second,"select-crash",ScriptJobAction::SelectRevision{
        revision_id:first.revisions[0].revision_id.clone()});
    assert_eq!(store.inject_import_fault(call,super::store::ImportFault::BeforeCheckpoint)
        .err().unwrap().code,StoreErrorCode::StorageFailure);
    let recovery=store.recover().unwrap();
    assert_eq!(recovery.jobs[0].selected_revision_id,second.selected_revision_id);
    // The ordinary injected pre-rename error cleans up its uncommitted temp;
    // no interrupted checkpoint is published or falsely reported as committed.
    assert!(recovery.issues.is_empty());
    let intact=store.get(&second.job_id).unwrap();
    assert!(intact == second);
}
#[test]
fn sw_03f_19_history_checkpoint_tampering_detected() {
    let temp=Sandbox::new();let store=temp.store();
    let approved_old=reviewed(&store,"history_tamper","Previously approved manuscript");
    let approved=store.transition(input(&approved_old,"approval-1",review_action(&approved_old,"approve"))).unwrap();
    let second=edit_version(&store,&approved,"revised-history",&approved.revisions[0].revision_id,"New version");
    let path=checkpoint(&temp.0,&second,second.state_revision);
    let mut payload:serde_json::Value=serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    payload["approvalHistory"]=serde_json::json!([]);
    fs::write(&path,serde_json::to_vec_pretty(&payload).unwrap()).unwrap();
    let recovery=store.recover().unwrap();
    assert!(recovery.issues.iter().any(|issue|issue.kind==RecoveryKind::CorruptRecord));
    assert_eq!(store.get(&second.job_id).err().unwrap().code,StoreErrorCode::RecoveryBlocked);
}
#[test]
fn sw_03f_20_no_provider_or_pipeline_operations_in_manual_revision_flow() {
    let temp=Sandbox::new();let store=temp.store();
    let first=imported_for_review(&store,"no_ai_for_revisions","Manual text only");
    let second=edit_version(&store,&first,"manual-second",&first.revisions[0].revision_id,"Edited locally");
    assert_eq!(second.request.provider_mode,ProviderMode::ClaudeBrowserAssisted);
    assert!(second.project_id.is_none());
    assert!(second.approved_revision_id.is_none());
    assert_eq!(second.revisions[1].source,super::model::ScriptRevisionSource::ManualImport);
}


#[test]
fn sw_03f_21_shared_multi_revision_v1_fixture_preserves_old_approval_history() {
    let raw=include_str!("../../../src/lib/script/jobs/fixtures/revised-job-v1.json");
    let saved:ScriptJobRecord=serde_json::from_str(raw).unwrap();
    assert!(saved.validate(&saved.job_id).is_ok());
    assert_eq!(saved.schema_version,1);
    assert_eq!(saved.state,ScriptJobState::ResponseReceived);
    assert_eq!(saved.revisions.len(),2);
    assert_eq!(saved.selected_revision_id.as_deref(),Some(saved.revisions[1].revision_id.as_str()));
    assert_eq!(saved.revisions[1].origin_revision_id.as_deref(),
        Some(saved.revisions[0].revision_id.as_str()));
    assert!(saved.approval_record.is_none());
    assert!(saved.approved_revision_id.is_none());
    assert_eq!(saved.approval_history.len(),1);
    assert_eq!(saved.approval_history[0].revision_id,saved.revisions[0].revision_id);
    let parsed:serde_json::Value=serde_json::from_str(raw).unwrap();
    assert_eq!(serde_json::to_value(saved).unwrap(),parsed);
}
#[test]
fn sw_03f_22_maximum_revision_limit_is_validated_without_unbounded_storage() {
    let temp=Sandbox::new();let store=temp.store();
    let imported=imported_for_review(&store,"maximum_versions","Original text");
    let mut tampered=imported.clone();
    for index in 1..=super::model::MAX_SCRIPT_REVISIONS {
        let mut reference=imported.revisions[0].clone();
        reference.revision_id=format!("rev_{index:064x}");
        reference.origin_revision_id=Some(imported.revisions[0].revision_id.clone());
        tampered.revisions.push(reference);
    }
    tampered.selected_revision_id=Some(tampered.revisions.last().unwrap().revision_id.clone());
    assert_eq!(tampered.validate(&tampered.job_id),Err("revision_history_limit"));
    assert!(store.get(&imported.job_id).unwrap()==imported);
}
