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
