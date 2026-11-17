use super::*;
use crate::script_execution::{ExecutionStore,StartExecution,ExecutionRequest,ExecutionAction};
use crate::script_studio::{build_plan,ChannelStudioConfigV1,PlanInput,ScriptMode};

fn fixture(parts:u32)->(PathBuf,ScriptStudioPlanV1,crate::script_execution::ExecutionState, String){
 let root=std::env::temp_dir().join(format!("sw03j-{}",new_id()));
 fs::create_dir(&root).unwrap();
 let cfg=ChannelStudioConfigV1::seed("channel_a".into(),"Testing".into(),"English".into(),"Write documentary.".into(),None);
 let plan=build_plan(&cfg,&PlanInput{
  plan_id:"sp_review".into(),channel_id:"channel_a".into(),expected_config_revision:0,
  title:"Test title".into(),topic:"A real subject".into(),language:Some("English".into()),
  mode:Some(if parts==1{ScriptMode::Single}else{ScriptMode::MultiPart}),
  total_words:Some(120*parts),part_count:Some(parts),
  outline_required:Some(false),continuity_required:Some(false),parts:Vec::new()
 },"2026-11-17T00:00:00.000Z").unwrap();
 let exec=ExecutionStore::new(root.join("executions")).unwrap();
 let mut s=exec.start(&plan,&StartExecution{
  channel_id:"channel_a".into(),plan_id:"sp_review".into(),execution_id:"ex_review".into(),operation_id:"op_start".into()
 }).unwrap();
 for i in 1..=parts{
  for (name,action) in [
   ("prepare",ExecutionAction::PreparePart{part_index:i,extra_instructions:String::new()}),
   ("fragment",ExecutionAction::ImportFragment{part_index:i,text:format!("  Part {i} – اردو 한국어 😀 works.\r\n")}),
   ("commit",ExecutionAction::CommitPart{part_index:i,accept_warnings:true})
  ]{
   s=exec.apply(&plan,&ExecutionRequest{
    channel_id:"channel_a".into(),execution_id:"ex_review".into(),expected_revision:s.revision,
    operation_id:format!("op_{name}_{i}"),action
   }).unwrap();
  }
 }
 s=exec.apply(&plan,&ExecutionRequest{
  channel_id:"channel_a".into(),execution_id:"ex_review".into(),expected_revision:s.revision,
  operation_id:"op_assemble".into(),action:ExecutionAction::Assemble
 }).unwrap();
 let text=exec.read("channel_a","ex_review","assembled",0,0).unwrap();
 drop(exec);(root,plan,s,text)
}
fn input(part:Option<u32>)->StartReview{StartReview{
 channel_id:"channel_a".into(),execution_id:"ex_review".into(),review_id:"rv_test".into(),
 part_index:part,operation_id:"op_start".into()
}}
fn request(s:&ReviewState,action:ReviewAction,key:&str)->ReviewRequest{ReviewRequest{
 channel_id:s.channel_id.clone(),review_id:s.review_id.clone(),expected_revision:s.revision,
 operation_id:format!("op_{key}_{}",s.revision),action
}}
fn report(p:&ReviewPolicy)->Report{
 Report{scores:p.rubric.iter().map(|r|CategoryScore{key:r.key.clone(),points:r.points-1}).collect(),
  findings:vec![Finding{severity:Severity::Warning,category:"hook".into(),
   summary:"Opening needs tension.".into(),recommendation:"Use a sharper question.".into()}],
  summary:"Human-reported offline reviewer feedback.".into()}
}
fn reviewed(store:&ReviewStore,s:&ReviewState)->ReviewState{
 let raw=serde_json::to_string(&report(&s.policy)).unwrap();
 store.apply(&request(s,ReviewAction::ImportResponse{section_index:0,raw},"import")).unwrap()
}
fn revised(s:&ReviewState)->String{
 let mut text=String::new();text.push_str("  Improved opening with meaningful context. ");
 text.push_str(&"Strong meaningful point. ".repeat(40));
 text.push_str("Clearly finished.");
 assert!(text.len()>0&&s.versions.len()>0);text
}
#[test]
fn sw_03j_eight_part_review_improve_rereview_approve_restart_channel_isolation(){
 let (root,plan,ex,text)=fixture(8);
 let store=ReviewStore::new(root.join("reviews")).unwrap();
 let mut s=store.start(&plan,&ex,&text,&input(None)).unwrap();
 assert_eq!(store.read("channel_a","rv_test","script",0).unwrap(),text);
 assert_eq!(s.rounds[0].sections.len(),1);
 let prompt=store.read("channel_a","rv_test","prompt",0).unwrap();
 assert!(prompt.contains("THIS SECTION ONLY"));
 assert!(prompt.contains("Part 8"));
 assert!(store.get("channel_b","rv_test").is_err());
 s=reviewed(&store,&s);
 assert_eq!(s.rounds[0].sections[0].score,Some(91)); // Nine categories, one point deducted each.
 assert!(s.approvals.is_empty());
 s=store.apply(&request(&s,ReviewAction::PrepareImprovement{goals:vec!["Improve hook".into()]},"improve")).unwrap();
 let improvement=store.read("channel_a","rv_test","improvement",0).unwrap();
 assert!(improvement.contains("Improve hook"));
 let updated=revised(&s);
 s=store.apply(&request(&s,ReviewAction::ImportRevision{text:updated.clone()},"revise")).unwrap();
 assert_eq!(s.versions.len(),2);
 assert_eq!(store.read("channel_a","rv_test","script",0).unwrap(),text);
 assert_eq!(store.read("channel_a","rv_test","script",1).unwrap(),updated);
 assert!(store.apply(&request(&s,ReviewAction::Approve{confirmation:"APPROVE FINAL SCRIPT".into()},"early")).is_err());
 s=store.apply(&request(&s,ReviewAction::PrepareReview{mode:"final".into()},"review_new")).unwrap();
 s=reviewed(&store,&s);
 s=store.apply(&request(&s,ReviewAction::Approve{confirmation:"APPROVE FINAL SCRIPT".into()},"approve")).unwrap();
 assert_eq!(s.approvals.len(),1);
 assert_eq!(s.approvals[0].script_digest,s.versions[1].text.sha256);
 assert_eq!(s.approvals[0].round_index,1);
 let last=s.revision;
 drop(store);
 let reopened=ReviewStore::new(root.join("reviews")).unwrap();
 assert_eq!(reopened.get("channel_a","rv_test").unwrap().revision,last);
 assert_eq!(reopened.get("channel_a","rv_test").unwrap().approvals.len(),1);
 assert!(reopened.read("channel_b","rv_test","script",1).is_err());
 drop(reopened);fs::remove_dir_all(root).unwrap();
}
#[test]
fn sw_03j_single_part_review_exact_unicode_crlf(){
 let (root,p,s,t)=fixture(1);let store=ReviewStore::new(root.join("reviews")).unwrap();
 let mut review=store.start(&p,&s,&t,&input(None)).unwrap();
 assert_eq!(store.read("channel_a","rv_test","script",0).unwrap(),t);
 review=reviewed(&store,&review);
 assert_eq!(review.rounds[0].sections[0].score,Some(91));
 assert_eq!(store.read("channel_a","rv_test","raw",0).unwrap(),serde_json::to_string(&report(&review.policy)).unwrap());
 drop(store);fs::remove_dir_all(root).unwrap();
}
#[test]
fn sw_03j_part_review_never_global_approval(){
 let (root,p,s,_)=fixture(8);
 let script=format!("  Part {} – اردو 한국어 😀 works.\r\n",1);
 let store=ReviewStore::new(root.join("reviews")).unwrap();
 let state=store.start(&p,&s,&script,&input(Some(1))).unwrap();
 let state=reviewed(&store,&state);
 assert!(state.part_index.is_some());
 assert!(store.apply(&request(&state,ReviewAction::Approve{confirmation:"APPROVE FINAL SCRIPT".into()},"no")).is_err());
 drop(store);fs::remove_dir_all(root).unwrap();
}
#[test]
fn sw_03j_raw_invalid_preserved_then_corrected_explicitly(){
 let (root,p,e,t)=fixture(1);let store=ReviewStore::new(root.join("reviews")).unwrap();
 let s=store.start(&p,&e,&t,&input(None)).unwrap();
 let invalid_json="  {";let req=request(&s,ReviewAction::ImportResponse{section_index:0,raw:invalid_json.into()},"bad");
 let s=store.apply(&req).unwrap();
 assert!(s.rounds[0].sections[0].report.is_none());
 assert!(!s.rounds[0].sections[0].validation_issues.is_empty());
 assert_eq!(store.read("channel_a","rv_test","raw",0).unwrap(),invalid_json);
 let s=store.apply(&request(&s,ReviewAction::CorrectResponse{section_index:0,report:report(&s.policy)},"correct")).unwrap();
 assert_eq!(s.rounds[0].sections[0].score,Some(91));
 assert_eq!(store.read("channel_a","rv_test","raw",0).unwrap(),invalid_json);
 drop(store);fs::remove_dir_all(root).unwrap();
}
#[test]
fn sw_03j_invalid_rubric_score_is_not_invented(){
 let rubric=crate::script_studio::default_rubric();
 let mut r=Report{scores:vec![],findings:vec![],summary:"Manual notes".into()};
 assert!(score(&r,&rubric).is_err());
 r.scores=rubric.iter().map(|x|CategoryScore{key:x.key.clone(),points:x.points}).collect();
 assert_eq!(score(&r,&rubric),Ok(100));
 r.scores[0].points+=1;assert!(score(&r,&rubric).is_err());
 r.scores[0].points=0;r.scores.push(r.scores[0].clone());assert!(score(&r,&rubric).is_err());
}
#[test]
fn sw_03j_immutable_source_binding_and_bad_digest_rejected(){
 let (root,p,mut e,t)=fixture(1);let store=ReviewStore::new(root.join("reviews")).unwrap();
 e.assembled.as_mut().unwrap().sha256="sha256:bad".into();
 assert!(store.start(&p,&e,&t,&input(None)).is_err());
 drop(store);fs::remove_dir_all(root).unwrap();
}
#[test]
fn sw_03j_duplicate_operation_stale_and_conflicting_replay(){
 let (root,p,e,t)=fixture(1);let store=ReviewStore::new(root.join("reviews")).unwrap();
 let s=store.start(&p,&e,&t,&input(None)).unwrap();
 let raw=serde_json::to_string(&report(&s.policy)).unwrap();
 let req=request(&s,ReviewAction::ImportResponse{section_index:0,raw},"score");
 let next=store.apply(&req).unwrap();
 assert_eq!(store.apply(&req).unwrap().revision,next.revision);
 assert!(matches!(store.apply(&request(&s,ReviewAction::Approve{confirmation:"APPROVE FINAL SCRIPT".into()},"stale")).unwrap_err().code,ReviewErrorCode::StaleRevision));
 let mut collision=req.clone();collision.action=ReviewAction::Approve{confirmation:"APPROVE FINAL SCRIPT".into()};
 assert!(matches!(store.apply(&collision).unwrap_err().code,ReviewErrorCode::Conflict));
 drop(store);fs::remove_dir_all(root).unwrap();
}
#[test]
fn sw_03j_writer_lease_is_exclusive(){
 let (root,p,e,t)=fixture(1);let store=ReviewStore::new(root.join("reviews")).unwrap();
 store.start(&p,&e,&t,&input(None)).unwrap();
 assert!(matches!(ReviewStore::new(root.join("reviews")).err().map(|x|x.code),Some(ReviewErrorCode::WriterBusy)));
 drop(store);fs::remove_dir_all(root).unwrap();
}
#[test]
fn sw_03j_tampered_report_or_orphan_blocks_recovery(){
 let (root,p,e,t)=fixture(1);let store=ReviewStore::new(root.join("reviews")).unwrap();
 let s=store.start(&p,&e,&t,&input(None)).unwrap();
 let s=reviewed(&store,&s);
 let dir=root.join("reviews/channels/channel_a/rv_test/objects");
 fs::write(dir.join(&s.rounds[0].sections[0].raw.as_ref().unwrap().filename),"tampered").unwrap();
 assert!(matches!(store.get("channel_a","rv_test").unwrap_err().code,ReviewErrorCode::CorruptRecord));
 drop(store);fs::remove_dir_all(&root).unwrap();
 let (root,p,e,t)=fixture(1);let store=ReviewStore::new(root.join("reviews")).unwrap();
 store.start(&p,&e,&t,&input(None)).unwrap();
 let d=root.join("reviews/channels/channel_a/rv_test/objects");
 fs::write(d.join("object-orphan.txt"),"orphan after interrupted checkpoint").unwrap();
 assert!(matches!(store.get("channel_a","rv_test").unwrap_err().code,ReviewErrorCode::RecoveryBlocked));
 drop(store);fs::remove_dir_all(root).unwrap();
}
#[test]
fn sw_03j_long_script_coverage_is_explicit_and_not_automatically_approved(){
 let (root,p,mut e,_)=fixture(1);
 let t="Narration words develop the subject. ".repeat(4500);
 let refmut=e.assembled.as_mut().unwrap();
 refmut.bytes=t.len() as u64;refmut.sha256=digest(t.as_bytes());
 let store=ReviewStore::new(root.join("reviews")).unwrap();
 let mut s=store.start(&p,&e,&t,&input(None)).unwrap();
 assert!(s.rounds[0].sections.len()>1);
 s=reviewed(&store,&s);
 assert!(s.rounds[0].sections.iter().skip(1).all(|v|v.report.is_none()));
 assert!(store.apply(&request(&s,ReviewAction::Approve{confirmation:"APPROVE FINAL SCRIPT".into()},"approval")).is_err());
 drop(store);fs::remove_dir_all(root).unwrap();
}
#[cfg(unix)]
#[test]
fn sw_03j_symlinked_object_blocked(){
 use std::os::unix::fs::symlink;
 let (root,p,e,t)=fixture(1);let store=ReviewStore::new(root.join("reviews")).unwrap();
 let state=store.start(&p,&e,&t,&input(None)).unwrap();
 let path=root.join("reviews/channels/channel_a/rv_test/objects").join(&state.versions[0].text.filename);
 let real=root.join("real-script.txt");fs::rename(&path,&real).unwrap();symlink(&real,&path).unwrap();
 assert!(matches!(store.get("channel_a","rv_test").unwrap_err().code,ReviewErrorCode::CorruptRecord));
 drop(store);fs::remove_dir_all(root).unwrap();
}

#[test]
fn sw_03j_history_reopens_prior_round_prompt_raw_and_improvement(){
 let (root,p,e,t)=fixture(1);let store=ReviewStore::new(root.join("reviews")).unwrap();
 let mut s=store.start(&p,&e,&t,&input(None)).unwrap();
 let before=store.read("channel_a","rv_test","prompt",0).unwrap();
 s=reviewed(&store,&s);
 let raw=store.read("channel_a","rv_test","raw",0).unwrap();
 s=store.apply(&request(&s,ReviewAction::PrepareImprovement{goals:vec!["Better clarity".into()]},"goal")).unwrap();
 let improvement=store.read("channel_a","rv_test","improvement",0).unwrap();
 s=store.apply(&request(&s,ReviewAction::ImportRevision{text:revised(&s)},"draft")).unwrap();
 s=store.apply(&request(&s,ReviewAction::PrepareReview{mode:"final".into()},"again")).unwrap();
 assert!(s.rounds.last().unwrap().sections[0].raw.is_none());
 assert_eq!(store.read_history("channel_a","rv_test","prompt",0,0).unwrap(),before);
 assert_eq!(store.read_history("channel_a","rv_test","raw",0,0).unwrap(),raw);
 assert_eq!(store.read_history("channel_a","rv_test","improvement",0,0).unwrap(),improvement);
 assert!(store.read_history("channel_b","rv_test","raw",0,0).is_err());
 drop(store);fs::remove_dir_all(root).unwrap();
}
#[test]
fn sw_03j_invalid_review_prompt_fails_before_publishing_orphans(){
 use crate::script_studio::{TextVersion,ReviewerProvider};
 let root=std::env::temp_dir().join(format!("sw03j-prompt-{}",new_id()));
 fs::create_dir(&root).unwrap();
 let mut cfg=ChannelStudioConfigV1::seed("channel_a".into(),"Testing".into(),"English".into(),"Master".into(),None);
 cfg.review.single_script_instructions="A".repeat(64_000);
 cfg.review.per_part_instructions="B".repeat(64_000);
 cfg.review.final_script_instructions="C".repeat(64_000);
 cfg.review.provider=ReviewerProvider::None;
 let reviewer="D".repeat(64_000);
 cfg.review_versions.push(TextVersion{version_id:"review_v1".into(),channel_id:"channel_a".into(),
  content_digest:digest(reviewer.as_bytes()),content:reviewer,created_at:"2026-11-17T00:00:00.000Z".into(),
  planning_override:None});
 cfg.selected_review_version_id=Some("review_v1".into());
 cfg.validate().unwrap();
 let plan=build_plan(&cfg,&PlanInput{
  plan_id:"sp_bigprompt".into(),channel_id:"channel_a".into(),expected_config_revision:0,
  title:"Prompt length".into(),topic:"Testing limit".into(),language:Some("English".into()),
  mode:Some(ScriptMode::Single),total_words:Some(120),part_count:Some(1),
  outline_required:Some(false),continuity_required:Some(false),parts:Vec::new()
 },"2026-11-17T00:00:00.000Z").unwrap();
 let exec=ExecutionStore::new(root.join("executions")).unwrap();
 let mut s=exec.start(&plan,&StartExecution{channel_id:"channel_a".into(),plan_id:plan.plan_id.clone(),
  execution_id:"ex_review".into(),operation_id:"op_begin".into()}).unwrap();
 for (i,action) in [
  ExecutionAction::PreparePart{part_index:1,extra_instructions:String::new()},
  ExecutionAction::ImportFragment{part_index:1,text:format!("{}.", "Detailed review sentence ".repeat(1000))},
  ExecutionAction::CommitPart{part_index:1,accept_warnings:true},ExecutionAction::Assemble
 ].into_iter().enumerate(){
  s=exec.apply(&plan,&ExecutionRequest{channel_id:"channel_a".into(),execution_id:"ex_review".into(),
   expected_revision:s.revision,operation_id:format!("op_{i}"),action}).unwrap();
 }
 let t=exec.read("channel_a","ex_review","assembled",0,0).unwrap();
 let store=ReviewStore::new(root.join("reviews")).unwrap();
 assert!(store.start(&plan,&s,&t,&StartReview{
  channel_id:"channel_a".into(),execution_id:"ex_review".into(),review_id:"rv_test".into(),
  part_index:None,operation_id:"op_start".into()
 }).is_err());
 assert!(!root.join("reviews/channels/channel_a/rv_test").exists());
 drop(store);drop(exec);fs::remove_dir_all(root).unwrap();
}
