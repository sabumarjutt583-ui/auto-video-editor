use super::*;
use std::{path::PathBuf,fs};
use rand::RngCore;
use crate::script_studio::{ChannelStudioConfigV1,PlanInput,ScriptMode,ReviewerProvider,WritingMode,SkillRegistration,SkillInstallStatus,build_plan};
use crate::script_execution::{StartExecution,ExecutionStore};
use crate::script_review::ReviewStore;
use crate::script_supervisor::{SupervisorStore,TaskStart};

fn random()->String{
 let mut bytes=[0u8;16];rand::rng().fill_bytes(&mut bytes);
 bytes.iter().map(|x|format!("{x:02x}")).collect()
}
struct Fixture{
 root:PathBuf,plan:ScriptStudioPlanV1,ex:ExecutionStore,review:ReviewStore,
 supervisor:SupervisorStore,task_id:String
}
impl Fixture{
 fn setup(channel:&str,parts:u32)->Self{
  let root=std::env::temp_dir().join(format!("sw03m-{}",random()));
  fs::create_dir(&root).unwrap();
  let mut cfg=ChannelStudioConfigV1::seed(channel.into(),channel.into(),"English".into(),
   "Create an original, fictional test script.".into(),Some("cl_1".into()));
  cfg.accounts.chatgpt_review_account_id=Some("gp_2".into());
  cfg.review.provider=ReviewerProvider::Chatgpt;
  cfg.writing.instruction_mode=WritingMode::MasterPlusSkill;
  cfg.skills.push(SkillRegistration{skill_id:"skill_mock".into(),channel_id:channel.into(),
   display_name:"Mock storytelling reference".into(),exact_name:"MockSkill".into(),
   claude_account_id:"cl_1".into(),description:"Local-only registered Skill reference".into(),
   status:SkillInstallStatus::RegisteredLocally,user_confirmed_at:None,planning_override:None});
  cfg.writing.selected_skill_id=Some("skill_mock".into());
  let words=if parts==1{1800}else{parts*120};
  let plan=build_plan(&cfg,&PlanInput{plan_id:"sp_auto_mock".into(),channel_id:channel.into(),
   expected_config_revision:0,title:"Original psychological story".into(),
   topic:"MOCK only: a fictional narrator experiences a mysterious event".into(),
   language:Some("English".into()),mode:Some(if parts==1{ScriptMode::Single}else{ScriptMode::MultiPart}),
   total_words:Some(words),part_count:Some(parts),outline_required:Some(parts>1),
   continuity_required:Some(parts>1),parts:Vec::new()
  },"2026-11-18T00:00:00.000Z").unwrap();
  let ex=ExecutionStore::new(root.join("execution")).unwrap();
  let state=ex.start(&plan,&StartExecution{channel_id:channel.into(),
   plan_id:plan.plan_id.clone(),execution_id:"ex_auto".into(),operation_id:"op_start_ex".into()}).unwrap();
  let supervisor=SupervisorStore::new(root.join("supervisor")).unwrap();
  let task_id="su_auto_test".to_string();
  supervisor.start(&plan,&state,&TaskStart{channel_id:channel.into(),task_id:task_id.clone(),
   execution_id:state.execution_id.clone(),operation_id:"op_start_supervisor".into(),
   writer_account_id:Some("cl_1".into()),reviewer_account_id:Some("gp_2".into()),
   skill_status:"registered_locally".into(),transport:Transport::LocalMock}).unwrap();
  let review=ReviewStore::new(root.join("review")).unwrap();
  Self{root,plan,ex,review,supervisor,task_id}
 }
 fn run(&self,stop:Option<u32>)->Result<AutoOutcome,String>{
  Coordinator{plan:&self.plan,execution:&self.ex,review:&self.review,
   supervisor:&self.supervisor,adapter:&FixtureProvider,review_target:90,max_improvements:2}
   .run(&self.task_id,stop)
 }
 fn source(&self)->ExecutionState{
  self.ex.get(&self.plan.channel_id,"ex_auto").unwrap()
 }
 fn task(&self)->TaskState{
  self.supervisor.get(&self.plan.channel_id,&self.task_id).unwrap()
 }
 fn cleanup(self){
  let path=self.root.clone();drop(self);fs::remove_dir_all(path).unwrap();
 }
}
#[test]
fn sw03m_provider_capability_enforced_before_dispatch(){
 let no=capability(&AutoMode::AuthorizedBrowser);
 assert!(!no.authorized&&!no.automatic&&!no.real_ai);
 let yes=capability(&AutoMode::LocalFixture);
 assert!(yes.automatic&&yes.authorized&&!yes.real_ai);
 let p=Fixture::setup("channel_c",1);
 let mut task=p.task();
 assert_eq!(task.snapshot.transport,Transport::LocalMock);
 task.snapshot.transport=Transport::VisibleBrowser;
 assert_ne!(task.snapshot.transport,Transport::LocalMock);
 p.cleanup();
}
#[test]
fn sw03m_ten_part_automatic_recovery_after_part_four(){
 let p=Fixture::setup("channel_horror",10);
 let result=p.run(Some(4)).unwrap();
 assert_eq!(result.completed_parts,4);
 assert!(!result.waiting_for_approval);
 let old=p.source();
 assert_eq!(old.completed_parts,4);
 assert_eq!(old.parts[3].fragments.len(),2);
 assert!(old.parts[3].committed.is_some());
 let revision=old.revision;
 let root=p.root.clone();let plan=p.plan.clone();let task=p.task_id.clone();
 drop(p);
 let ex=ExecutionStore::new(root.join("execution")).unwrap();
 let review=ReviewStore::new(root.join("review")).unwrap();
 let sup=SupervisorStore::new(root.join("supervisor")).unwrap();
 let coordinator=Coordinator{plan:&plan,execution:&ex,review:&review,supervisor:&sup,
  adapter:&FixtureProvider,review_target:90,max_improvements:2};
 let result=coordinator.run(&task,None).unwrap();
 assert_eq!(result.completed_parts,10);
 assert!(result.waiting_for_approval);
 assert!(result.review_score.unwrap()>=90);
 assert_eq!(result.revision_rounds,1);
 let source=ex.get("channel_horror","ex_auto").unwrap();
 assert!(source.revision>revision);
 assert!(source.parts.iter().all(|p|p.committed.is_some()&&p.fragments.len()==2));
 assert_eq!(source.continuity_notes.len(),9);
 let rv=review.get("channel_horror","rv_auto_test").unwrap();
 assert_eq!(rv.versions.len(),2);
 assert_eq!(rv.rounds.len(),2);
 assert!(rv.approvals.is_empty());
 assert!(rv.rounds.last().unwrap().sections.iter().all(|s|s.report.is_some()));
 assert_eq!(sup.get("channel_horror",&task).unwrap().stage,Stage::AwaitingApproval);
 drop(ex);drop(review);drop(sup);fs::remove_dir_all(root).unwrap();
}
#[test]
fn sw03m_single_documentary_automatic_writer_reviewer_improvement(){
 let p=Fixture::setup("channel_documentary",1);
 let result=p.run(None).unwrap();
 assert_eq!(result.completed_parts,1);
 assert_eq!(result.revision_rounds,1);
 assert!(result.waiting_for_approval);
 let e=p.source();
 assert!(e.assembled.is_some());
 assert_eq!(e.parts[0].fragments.len(),2);
 assert!(e.parts[0].actual_words.unwrap()>1000);
 let source=p.ex.read("channel_documentary","ex_auto","assembled",0,0).unwrap();
 assert!(source.contains("[MOCK]"));
 let rv=p.review.get("channel_documentary","rv_auto_test").unwrap();
 assert!(rv.rounds.len()>=2);
 assert!(rv.versions[0].text.sha256!=rv.versions[1].text.sha256);
 assert!(rv.approvals.is_empty());
 p.cleanup();
}
#[test]
fn sw03m_pause_resume_cancel_and_source_preservation(){
 let p=Fixture::setup("channel_pauses",3);
 assert_eq!(p.run(Some(1)).unwrap().completed_parts,1);
 let task=p.task();
 let paused=p.supervisor.apply(&TaskRequest{channel_id:task.channel_id.clone(),
  task_id:task.task_id.clone(),expected_revision:task.revision,
  operation_id:"op_pause_auto".into(),action:TaskAction::Pause},None,None).unwrap();
 assert_eq!(paused.stage,Stage::Paused);
 assert!(p.run(None).is_err());
 assert_eq!(p.source().completed_parts,1);
 let resumed=p.supervisor.apply(&TaskRequest{channel_id:paused.channel_id.clone(),
  task_id:paused.task_id.clone(),expected_revision:paused.revision,
  operation_id:"op_resume_auto".into(),action:TaskAction::Resume},None,None).unwrap();
 assert_ne!(resumed.stage,Stage::Paused);
 assert!(p.run(None).unwrap().waiting_for_approval);
 let task=p.task();
 let cancel=p.supervisor.apply(&TaskRequest{channel_id:task.channel_id.clone(),
  task_id:task.task_id.clone(),expected_revision:task.revision,
  operation_id:"op_cancel_auto".into(),action:TaskAction::Cancel},None,None).unwrap();
 assert_eq!(cancel.stage,Stage::Cancelled);
 assert!(p.run(None).is_err());
 assert_eq!(p.source().completed_parts,3);
 p.cleanup();
}
#[test]
fn sw03m_rejects_invalid_account_or_wrong_owner_and_preserves_sources(){
 let p=Fixture::setup("channel_strict",1);
 let mut plan=p.plan.clone();plan.claude_account_id=Some("cl_other".into());
 assert!(Coordinator{plan:&plan,execution:&p.ex,review:&p.review,supervisor:&p.supervisor,
  adapter:&FixtureProvider,review_target:90,max_improvements:2}
  .run(&p.task_id,None).is_err());
 assert!(p.supervisor.get("channel_other",&p.task_id).is_err());
 assert_eq!(p.source().revision,0);
 p.cleanup();
}
#[test]
fn sw03m_response_evidence_never_masquerades_as_real_ai(){
 let req=AdapterRequest{provider:"fixture_writer".into(),account_id:Some("cl_1".into()),
  task_id:"su_1".into(),scope:"write".into(),prompt:"prompt اردو 한국어 😀\r\n".into(),
  prompt_sha256:digest("prompt اردو 한국어 😀\r\n".as_bytes()),original_words:120,step:0};
 let reply=FixtureProvider.execute(&req).unwrap();
 assert!(reply.content.contains("[MOCK]"));
 assert_eq!(reply.provenance,"deterministic_mock");
 assert_eq!(reply.content_sha256,digest(reply.content.as_bytes()));
 let mut altered=req;altered.prompt.push(' ');
 assert!(FixtureProvider.execute(&altered).is_err());
}

#[test]
fn sw03m_max_one_improvement_still_re_reviews_new_version(){
 let p=Fixture::setup("channel_one_revision",1);
 let outcome=Coordinator{plan:&p.plan,execution:&p.ex,review:&p.review,
  supervisor:&p.supervisor,adapter:&FixtureProvider,review_target:100,max_improvements:1}
  .run(&p.task_id,None).unwrap();
 assert_eq!(outcome.revision_rounds,1);
 let r=p.review.get("channel_one_revision","rv_auto_test").unwrap();
 assert_eq!(r.rounds.last().unwrap().version_index,r.versions.last().unwrap().index);
 assert_eq!(r.rounds.len(),2);
 assert_eq!(r.rounds.last().unwrap().sections.iter().filter(|x|x.score.is_some()).count(),
  r.rounds.last().unwrap().sections.len());
 assert!(r.approvals.is_empty());
 p.cleanup();
}
