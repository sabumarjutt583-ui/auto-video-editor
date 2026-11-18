use super::*;
use crate::script_execution::{ExecutionStore,StartExecution,ExecutionRequest,ExecutionAction};
use crate::script_studio::{build_plan,ChannelStudioConfigV1,PlanInput,ScriptMode,WritingMode,
 SkillRegistration,SkillInstallStatus,ReviewerProvider};
use crate::script_review::{ReviewStore,StartReview,ReviewRequest,ReviewAction,ContextSource,
 CategoryScore,Report,Finding,Severity};

fn test_setup(parts:u32)->(PathBuf,ScriptStudioPlanV1,ExecutionStore,ExecutionState,SupervisorStore,TaskState){
 let root=std::env::temp_dir().join(format!("sw03k-{}",new_id()));fs::create_dir(&root).unwrap();
 let mut cfg=ChannelStudioConfigV1::seed("channel_a".into(),"Channel A".into(),"English".into(),"Write stories".into(),Some("cl_1".into()));
 cfg.accounts.chatgpt_review_account_id=Some("gp_1".into());
 cfg.review.provider=ReviewerProvider::Chatgpt;
 cfg.writing.instruction_mode=WritingMode::MasterPlusSkill;
 cfg.skills.push(SkillRegistration{skill_id:"skill_a".into(),channel_id:"channel_a".into(),
  display_name:"Documentary Skill".into(),exact_name:"DocWriting".into(),claude_account_id:"cl_1".into(),
  description:"User-managed Skill reference".into(),status:SkillInstallStatus::UserConfirmedInstalled,
  user_confirmed_at:Some("2026-11-17T00:00:00.000Z".into()),planning_override:None});
 cfg.writing.selected_skill_id=Some("skill_a".into());
 let plan=build_plan(&cfg,&PlanInput{plan_id:"sp_mock".into(),channel_id:"channel_a".into(),
  expected_config_revision:0,title:"Mock Documentary".into(),topic:"Amir journey".into(),
  language:Some("English".into()),mode:Some(if parts==1{ScriptMode::Single}else{ScriptMode::MultiPart}),
  total_words:Some(parts*120),part_count:Some(parts),outline_required:Some(parts>1),
  continuity_required:Some(parts>1),parts:Vec::new()
 },"2026-11-17T00:00:00.000Z").unwrap();
 let ex=ExecutionStore::new(root.join("executions")).unwrap();
 let e=ex.start(&plan,&StartExecution{channel_id:"channel_a".into(),plan_id:plan.plan_id.clone(),
  execution_id:"ex_mock".into(),operation_id:"op_start_exec".into()}).unwrap();
 let st=SupervisorStore::new(root.join("supervisor")).unwrap();
 let input=TaskStart{channel_id:"channel_a".into(),task_id:"su_mock".into(),execution_id:"ex_mock".into(),
  operation_id:"op_start_supervisor".into(),writer_account_id:Some("cl_1".into()),
  reviewer_account_id:Some("gp_1".into()),skill_status:"user_confirmed_installed".into(),
  transport:Transport::LocalMock};
 let task=st.start(&plan,&e,&input).unwrap();
 (root,plan,ex,e,st,task)
}
fn do_action(ex:&ExecutionStore,p:&ScriptStudioPlanV1,s:&ExecutionState,action:ExecutionAction,key:&str)->ExecutionState{
 ex.apply(p,&ExecutionRequest{channel_id:"channel_a".into(),execution_id:"ex_mock".into(),
  expected_revision:s.revision,operation_id:format!("op_exec_{key}_{}",s.revision),action}).unwrap()
}
fn supervisor_action(st:&SupervisorStore,s:&TaskState,action:TaskAction,e:Option<&ExecutionState>,review:Option<&ReviewState>)->TaskState{
 st.apply(&TaskRequest{channel_id:"channel_a".into(),task_id:"su_mock".into(),
  expected_revision:s.revision,operation_id:format!("op_task_{}",s.revision),action},e,review).unwrap()
}
#[test]
fn sw03k_01_account_binding_and_capability_gates(){
 let accounts=vec!["cl_1".into(),"cl_2".into()];
 assert_eq!(resolve_account(Some("cl_1"),&accounts,true,Some("cl_1"),&[]).unwrap(),Some("cl_1".into()));
 assert!(resolve_account(Some("cl_1"),&accounts,true,Some("cl_2"),&accounts).is_err());
 assert_eq!(resolve_account(Some("cl_1"),&accounts,false,Some("cl_2"),&vec!["cl_2".into()]).unwrap(),Some("cl_2".into()));
 assert!(resolve_account(Some("missing"),&accounts,true,None,&[]).is_err());
 assert!(!capabilities(&Transport::VisibleBrowser).iter().any(|x|x=="automated_submit"));
 assert!(!capabilities(&Transport::LocalMock).iter().any(|x|x.contains("provider_network")));
 let (root,p,ex,e,s,_)=test_setup(1);
 let mut bad=TaskStart{channel_id:"channel_a".into(),task_id:"su_api".into(),execution_id:"ex_mock".into(),
  operation_id:"op_api".into(),writer_account_id:Some("cl_1".into()),reviewer_account_id:Some("gp_1".into()),
  skill_status:"user_confirmed_installed".into(),transport:Transport::AuthorizedApi};
 assert!(s.start(&p,&e,&bad).is_err());
 bad.transport=Transport::VisibleBrowser;bad.writer_account_id=Some("cl_2".into());
 assert!(s.start(&p,&e,&bad).is_err());
 drop(ex);drop(s);fs::remove_dir_all(root).unwrap();
}
#[test]
fn sw03k_02_pause_resume_uncertainty_cancel_and_idempotency(){
 let (root,p,ex,e,store,mut task)=test_setup(1);
 let e=do_action(&ex,&p,&e,ExecutionAction::PreparePart{part_index:1,extra_instructions:String::new()},"prep_first");
 task=supervisor_action(&store,&task,TaskAction::PreparePrompt,Some(&e),None);
 assert_eq!(task.stage,Stage::PromptPrepared);
 task=supervisor_action(&store,&task,TaskAction::MarkSubmissionUncertain,None,None);
 let req=TaskRequest{channel_id:"channel_a".into(),task_id:"su_mock".into(),expected_revision:task.revision,
  operation_id:"op_pause_retry".into(),action:TaskAction::Pause};
 let next=store.apply(&req,None,None).unwrap();
 assert_eq!(store.apply(&req,None,None).unwrap().revision,next.revision);
 let mut collision=req.clone();collision.action=TaskAction::Cancel;
 assert!(store.apply(&collision,None,None).is_err());
 task=supervisor_action(&store,&next,TaskAction::Resume,None,None);
 assert_eq!(task.stage,Stage::SubmissionUncertain);
 task=supervisor_action(&store,&task,TaskAction::Cancel,None,None);
 assert!(store.apply(&TaskRequest{channel_id:"channel_a".into(),task_id:"su_mock".into(),
  expected_revision:task.revision,operation_id:"op_no_reopen".into(),
  action:TaskAction::PreparePrompt},None,None).is_err());
 assert_eq!(store.get("channel_a","su_mock").unwrap().stage,Stage::Cancelled);
 assert!(store.get("channel_b","su_mock").is_err());
 drop(ex);drop(store);fs::remove_dir_all(root).unwrap();
}
#[test]
fn sw03k_03_visible_browser_never_claims_submission(){
 let (root,p,ex,e,store,_)=test_setup(1);
 let input=TaskStart{channel_id:"channel_a".into(),task_id:"su_browser".into(),execution_id:"ex_mock".into(),
  operation_id:"op_browser".into(),writer_account_id:Some("cl_1".into()),reviewer_account_id:Some("gp_1".into()),
  skill_status:"user_confirmed_installed".into(),transport:Transport::VisibleBrowser};
 let browser=store.start(&p,&e,&input).unwrap();
 let req=|s:&TaskState,key:&str,action|TaskRequest{channel_id:"channel_a".into(),task_id:"su_browser".into(),
  expected_revision:s.revision,operation_id:format!("op_{key}"),action};
 let opened=store.apply(&req(&browser,"request",TaskAction::MarkBrowserOpening),None,None).unwrap();
 let ready=store.apply(&req(&opened,"opened",TaskAction::MarkBrowserOpened),None,None).unwrap();
 assert_eq!(ready.stage,Stage::AwaitingUserAction);
 assert!(ready.events.iter().all(|event|!event.contains("response_completed")&&!event.contains("provider_verified")));
 assert_eq!(ready.completed_parts,0);
 assert!(store.apply(&req(&ready,"bad",TaskAction::MarkBrowserOpened),None,None).is_err());
 drop(ex);drop(store);fs::remove_dir_all(root).unwrap();
}
#[test]
fn sw03k_04_eight_part_mock_execution_restart_review_improve_rereview_approve(){
 let (root,plan,mut exec,mut e,mut store,mut task)=test_setup(8);
 assert_eq!(task.snapshot.writer_account_id.as_deref(),Some("cl_1"));
 assert_eq!(task.snapshot.reviewer_account_id.as_deref(),Some("gp_1"));
 assert_eq!(task.snapshot.selected_skill_name.as_deref(),Some("DocWriting"));
 e=do_action(&exec,&plan,&e,ExecutionAction::SaveOutline{text:"Amir departure at sunrise, return at night.".into()},"outline");
 e=do_action(&exec,&plan,&e,ExecutionAction::SaveBible{text:"Amir remains the narrator. اردو 😀".into()},"bible");
 task=supervisor_action(&store,&task,TaskAction::SyncExecution,Some(&e),None);
 for i in 1..=8 {
  e=do_action(&exec,&plan,&e,ExecutionAction::PreparePart{part_index:i,extra_instructions:String::new()},&format!("prep_{i}"));
  task=supervisor_action(&store,&task,TaskAction::SyncExecution,Some(&e),None);
  assert_eq!(task.stage,Stage::PromptPrepared);
  let prompt=exec.read("channel_a","ex_mock","prompt",i,0).unwrap();
  assert!(prompt.contains("Amir"));
  task=supervisor_action(&store,&task,TaskAction::MarkAwaitingResponse,None,None);
  let text=format!("Part {i}: Amir reaches the next place. {} 😀 اردو. Completed.",
   "This is deterministic local mock output, never a Claude response. ".repeat(170));
  e=do_action(&exec,&plan,&e,ExecutionAction::ImportFragment{part_index:i,text},"fragment");
  task=supervisor_action(&store,&task,TaskAction::SyncExecution,Some(&e),None);
  assert_eq!(task.stage,Stage::ResponseImported);
  e=do_action(&exec,&plan,&e,ExecutionAction::CommitPart{part_index:i,accept_warnings:true},"commit");
  task=supervisor_action(&store,&task,TaskAction::SyncExecution,Some(&e),None);
  assert_eq!(task.completed_parts,i);
  if i<8{
   e=do_action(&exec,&plan,&e,ExecutionAction::SaveContinuity{after_part:i,
    text:format!("After part {i}, Amir is alive. The time is {}:00.",i+8)},"note");
   task=supervisor_action(&store,&task,TaskAction::SyncExecution,Some(&e),None);
  }
  if i==4 {
   let revision=task.revision;
   drop(exec);drop(store);
   exec=ExecutionStore::new(root.join("executions")).unwrap();
   store=SupervisorStore::new(root.join("supervisor")).unwrap();
   let restored=store.get("channel_a","su_mock").unwrap();
   assert_eq!(restored.revision,revision);
   assert_eq!(restored.completed_parts,4);
   assert_eq!(exec.get("channel_a","ex_mock").unwrap().completed_parts,4);
   task=restored;
  }
 }
 e=do_action(&exec,&plan,&e,ExecutionAction::Assemble,"assemble");
 task=supervisor_action(&store,&task,TaskAction::SyncExecution,Some(&e),None);
 assert_eq!(task.stage,Stage::ReviewPending);
 let script=exec.read("channel_a","ex_mock","assembled",0,0).unwrap();
 assert!(script.contains("Part 1:")&&script.contains("Part 8:"));
 let mut notes=Vec::new();
 for (kind,reference) in [("outline",e.outline_versions.last()),("bible",e.bible_versions.last())]{
  let o=reference.unwrap();
  notes.push(ContextSource{kind:kind.into(),after_part:None,sha256:o.sha256.clone(),bytes:o.bytes,
   text:exec.read("channel_a","ex_mock",kind,0,0).unwrap()});
 }
 for n in &e.continuity_notes{
  notes.push(ContextSource{kind:"continuity".into(),after_part:Some(n.after_part),
   sha256:n.document.sha256.clone(),bytes:n.document.bytes,
   text:exec.read("channel_a","ex_mock","continuity",n.after_part,0).unwrap()});
 }
 let reviews=ReviewStore::new(root.join("reviews")).unwrap();
 let start=StartReview{channel_id:"channel_a".into(),execution_id:"ex_mock".into(),
  review_id:"rv_mock".into(),part_index:None,operation_id:"op_start_review".into()};
 let mut v=reviews.start_with_context(&plan,&e,&script,&start,&notes).unwrap();
 assert_eq!(v.policy.continuity.as_ref().unwrap().source_count,9);
 assert!(v.rounds[0].sections.len()>1,"Multi-section mock review coverage required");
 assert!(reviews.read("channel_a","rv_mock","prompt",0).unwrap().contains("Amir"));
 let report=|s:&ReviewState|Report{scores:s.policy.rubric.iter().map(|c|CategoryScore{key:c.key.clone(),points:c.points}).collect(),
  findings:vec![Finding{severity:Severity::Info,category:"hook".into(),summary:"Manual fixture.".into(),
   recommendation:"Keep the introduction concise.".into()}],summary:"Synthetic 100-point manual report, not an AI provider response.".into()};
 let action=|s:&ReviewState,kind:ReviewAction,key:&str|ReviewRequest{channel_id:"channel_a".into(),
  review_id:"rv_mock".into(),expected_revision:s.revision,operation_id:format!("op_review_{key}_{}",s.revision),action:kind};
 let invalid=reviews.apply(&action(&v,ReviewAction::ImportResponse{section_index:0,raw:"{invalid".into()},"invalid")).unwrap();
 assert!(invalid.rounds[0].sections[0].score.is_none());
 v=reviews.apply(&action(&invalid,ReviewAction::CorrectResponse{section_index:0,report:report(&invalid)},"correct")).unwrap();
 task=supervisor_action(&store,&task,TaskAction::SyncReview{review_id:"rv_mock".into()},None,Some(&v));
 assert_eq!(task.stage,Stage::ReviewPending,"One corrected section cannot imply full review");
 assert!(task.approval_digest.is_none());
 for index in 1..v.rounds[0].sections.len(){
  let raw=serde_json::to_string(&report(&v)).unwrap();
  v=reviews.apply(&action(&v,ReviewAction::ImportResponse{section_index:index as u32,raw},"rest")).unwrap();
 }
 task=supervisor_action(&store,&task,TaskAction::SyncReview{review_id:"rv_mock".into()},None,Some(&v));
 assert_eq!(task.stage,Stage::AwaitingApproval);
 v=reviews.apply(&action(&v,ReviewAction::PrepareImprovement{goals:vec!["Sharper hook".into()]},"improvement")).unwrap();
 v=reviews.apply(&action(&v,ReviewAction::ImportRevision{text:format!("Improved opening. {}",script)},"revised")).unwrap();
 assert!(v.approvals.is_empty());
 task=supervisor_action(&store,&task,TaskAction::SyncReview{review_id:"rv_mock".into()},None,Some(&v));
 assert_eq!(task.stage,Stage::ReviewPending,"Stale prior-round scores must not approve a new version");
 assert_eq!(task.reviewed_sections,0);
 v=reviews.apply(&action(&v,ReviewAction::PrepareReview{mode:"final".into()},"rereview")).unwrap();
 assert!(v.rounds.last().unwrap().sections[0].score.is_none());
 for n in 0..v.rounds.last().unwrap().sections.len(){
  let raw=serde_json::to_string(&report(&v)).unwrap();
  v=reviews.apply(&action(&v,ReviewAction::ImportResponse{section_index:n as u32,raw},"report")).unwrap();
 }
 assert!(reviews.apply(&action(&v,ReviewAction::Approve{confirmation:"wrong".into()},"bad_approval")).is_err());
 v=reviews.apply(&action(&v,ReviewAction::Approve{confirmation:"APPROVE FINAL SCRIPT".into()},"approve")).unwrap();
 task=supervisor_action(&store,&task,TaskAction::SyncReview{review_id:"rv_mock".into()},None,Some(&v));
 assert_eq!(task.stage,Stage::Completed);
 assert_eq!(task.approval_digest.as_deref(),Some(v.versions.last().unwrap().text.sha256.as_str()));
 assert!(store.get("channel_b","su_mock").is_err());
 drop(reviews);drop(exec);drop(store);
 let reopened=SupervisorStore::new(root.join("supervisor")).unwrap();
 assert_eq!(reopened.get("channel_a","su_mock").unwrap().stage,Stage::Completed);
 drop(reopened);fs::remove_dir_all(root).unwrap();
}
#[test]
fn sw03k_05_orphan_file_blocks_restart_without_cleanup(){
 let (root,_p,exec,_e,store,_task)=test_setup(1);
 let dir=root.join("supervisor/channels/channel_a/su_mock");
 let path=dir.join("state-000999.json");
 fs::write(&path,"partial").unwrap();
 assert!(store.get("channel_a","su_mock").is_err());
 assert!(path.exists());drop(store);drop(exec);fs::remove_dir_all(root).unwrap();
}

#[test]
fn sw03k_06_stale_revisions_and_wrong_evidence_fail_closed(){
 let (root,_plan,execution,e,store,task)=test_setup(1);
 let wrong=TaskRequest{channel_id:"channel_b".into(),task_id:task.task_id.clone(),
  expected_revision:task.revision,operation_id:"op_wrong".into(),action:TaskAction::SyncExecution};
 assert!(store.apply(&wrong,Some(&e),None).is_err());
 let mut altered=e.clone();altered.channel_id="channel_b".into();
 let req=TaskRequest{channel_id:"channel_a".into(),task_id:task.task_id.clone(),
  expected_revision:task.revision,operation_id:"op_sync_wrong".into(),action:TaskAction::SyncExecution};
 assert!(store.apply(&req,Some(&altered),None).is_err());
 let next=store.apply(&req,Some(&e),None).unwrap();
 assert_eq!(next.revision,1);
 let stale=TaskRequest{channel_id:"channel_a".into(),task_id:task.task_id.clone(),
  expected_revision:0,operation_id:"op_stale".into(),action:TaskAction::Pause};
 assert!(store.apply(&stale,None,None).is_err());
 let mut conflicting=req.clone();conflicting.action=TaskAction::Cancel;
 assert!(store.apply(&conflicting,None,None).is_err());
 drop(execution);drop(store);fs::remove_dir_all(root).unwrap();
}
#[test]
fn sw03k_07_concurrent_operations_have_one_winner(){
 let (root,_plan,ex,_e,store,task)=test_setup(1);
 let shared=std::sync::Arc::new(store);
 let a=TaskRequest{channel_id:task.channel_id.clone(),task_id:task.task_id.clone(),
  expected_revision:0,operation_id:"op_race_a".into(),action:TaskAction::Pause};
 let b=TaskRequest{channel_id:task.channel_id.clone(),task_id:task.task_id.clone(),
  expected_revision:0,operation_id:"op_race_b".into(),action:TaskAction::Cancel};
 let (one,two)=std::thread::scope(|scope|{
  let t1=scope.spawn(||shared.apply(&a,None,None));
  let t2=scope.spawn(||shared.apply(&b,None,None));
  (t1.join().unwrap(),t2.join().unwrap())
 });
 assert_ne!(one.is_ok(),two.is_ok());
 assert_eq!(shared.get("channel_a","su_mock").unwrap().revision,1);
 drop(shared);drop(ex);fs::remove_dir_all(root).unwrap();
}
#[test]
fn sw03k_08_tampered_checkpoint_and_symlink_data_block_recovery(){
 let (root,_plan,ex,_e,store,task)=test_setup(1);
 let next=supervisor_action(&store,&task,TaskAction::Pause,None,None);
 let path=root.join(format!("supervisor/channels/channel_a/su_mock/state-{:06}.json",next.revision));
 let mut state:TaskState=serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
 state.snapshot.writer_account_id=Some("cl_2".into());
 fs::write(&path,serde_json::to_vec(&state).unwrap()).unwrap();
 assert!(store.get("channel_a","su_mock").is_err());
 drop(store);drop(ex);fs::remove_dir_all(root).unwrap();
}
#[test]
fn sw03k_09_explicit_fallback_does_not_change_channel_identity(){
 let (root,p,ex,e,store,_)=test_setup(1);
 let accounts=vec!["cl_1".into(),"cl_2".into()];
 assert_eq!(resolve_account(Some("cl_1"),&accounts,false,Some("cl_2"),
  &vec!["cl_2".into()]).unwrap(),Some("cl_2".into()));
 // An unchanged strict immutable plan must still reject that alternate.
 let alt=TaskStart{channel_id:"channel_a".into(),task_id:"su_alt".into(),execution_id:"ex_mock".into(),
  operation_id:"op_alt".into(),writer_account_id:Some("cl_2".into()),reviewer_account_id:Some("gp_1".into()),
  skill_status:"user_confirmed_installed".into(),transport:Transport::LocalMock};
 assert!(store.start(&p,&e,&alt).is_err());
 assert_eq!(e.channel_id,"channel_a");
 drop(ex);drop(store);fs::remove_dir_all(root).unwrap();
}
#[test]
fn sw03k_10_paused_task_rejects_mutations_without_resume(){
 let (root,_p,ex,_e,store,task)=test_setup(1);
 let paused=supervisor_action(&store,&task,TaskAction::Pause,None,None);
 let bad=TaskRequest{channel_id:"channel_a".into(),task_id:"su_mock".into(),
  expected_revision:paused.revision,operation_id:"op_no_advance".into(),
  action:TaskAction::MarkAwaitingResponse};
 assert!(store.apply(&bad,None,None).is_err());
 assert_eq!(store.get("channel_a","su_mock").unwrap().stage,Stage::Paused);
 drop(ex);drop(store);fs::remove_dir_all(root).unwrap();
}

#[test]
fn sw03k_11_single_part_mock_verifies_assembly_and_restart(){
 let (root,plan,exec,mut e,store,mut t)=test_setup(1);
 e=do_action(&exec,&plan,&e,ExecutionAction::PreparePart{part_index:1,extra_instructions:String::new()},"one_prepared");
 t=supervisor_action(&store,&t,TaskAction::SyncExecution,Some(&e),None);
 assert_eq!(t.stage,Stage::PromptPrepared);
 e=do_action(&exec,&plan,&e,ExecutionAction::ImportFragment{part_index:1,
  text:"Single-part offline mock narration. Verified exact text. اردو 😀. End.".into()},"one_import");
 t=supervisor_action(&store,&t,TaskAction::SyncExecution,Some(&e),None);
 assert_eq!(t.stage,Stage::ResponseImported);
 e=do_action(&exec,&plan,&e,ExecutionAction::CommitPart{part_index:1,accept_warnings:true},"one_commit");
 t=supervisor_action(&store,&t,TaskAction::SyncExecution,Some(&e),None);
 assert_eq!(t.stage,Stage::PartCommitted);
 e=do_action(&exec,&plan,&e,ExecutionAction::Assemble,"one_assemble");
 t=supervisor_action(&store,&t,TaskAction::SyncExecution,Some(&e),None);
 assert_eq!(t.stage,Stage::ReviewPending);
 assert!(exec.read("channel_a","ex_mock","assembled",0,0).unwrap().contains("Single-part"));
 drop(exec);drop(store);
 let reopened=SupervisorStore::new(root.join("supervisor")).unwrap();
 assert_eq!(reopened.get("channel_a","su_mock").unwrap().stage,Stage::ReviewPending);
 drop(reopened);fs::remove_dir_all(root).unwrap();
}
