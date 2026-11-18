//! Phase 03M: development-only autonomous coordinator.
//! Only deterministic LOCAL fixtures are implemented. Never dispatches to consumer websites.
//! The Phase 03I/03J/03K Rust stores own all persisted source and approvals.
use serde::{Deserialize,Serialize};
use crate::script_jobs::model::digest;
use crate::script_execution::{ExecutionStore,ExecutionState,ExecutionAction,ExecutionRequest};
use crate::script_review::{ReviewStore,ReviewState,ReviewAction,ReviewRequest,StartReview,ContextSource,Report,CategoryScore,Finding,Severity};
use crate::script_supervisor::{SupervisorStore,TaskState,TaskAction,TaskRequest,Stage,Transport};
use crate::script_studio::ScriptStudioPlanV1;

#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="snake_case")]
pub enum AutoMode { LocalFixture, AuthorizedBrowser }
#[derive(Clone,Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct AdapterCapability {pub automatic:bool,pub authorized:bool,pub real_ai:bool,
 pub provenance:&'static str,pub reason:&'static str}
pub fn capability(mode:&AutoMode)->AdapterCapability {
 match mode {
  AutoMode::LocalFixture=>AdapterCapability{automatic:true,authorized:true,real_ai:false,
   provenance:"deterministic_mock",reason:"Offline deterministic provider. MOCK content, not real AI."},
  AutoMode::AuthorizedBrowser=>AdapterCapability{automatic:false,authorized:false,real_ai:false,
   provenance:"blocked_no_provider_authorization",reason:"Consumer Claude/ChatGPT website CDP automation is not authorized or verified; no automatic request will be sent."}
 }
}
#[derive(Clone,Debug)]
pub struct AdapterRequest {
 pub provider:String,pub account_id:Option<String>,pub task_id:String,
 pub scope:String,pub prompt:String,pub prompt_sha256:String,
 pub original_words:u32,pub step:u32,
 /// Optional immutable source for a version-bound improvement, never credentials.
 pub source_text:Option<String>
}
#[derive(Clone,Debug)]
pub struct AdapterReply {pub content:String,pub content_sha256:String,pub provenance:&'static str}
pub trait ProviderAdapter:Send+Sync {
 fn check(&self)->AdapterCapability;
 fn execute(&self,request:&AdapterRequest)->Result<AdapterReply,String>;
 fn review(&self,_request:&AdapterRequest,_state:&ReviewState,_improved:bool)->Result<AdapterReply,String>{
  Err("This adapter does not support structured automatic review.".into())
 }
}
pub struct FixtureProvider;
impl ProviderAdapter for FixtureProvider {
 fn check(&self)->AdapterCapability{capability(&AutoMode::LocalFixture)}
 fn execute(&self,r:&AdapterRequest)->Result<AdapterReply,String>{
  if r.prompt.trim().is_empty()||digest(r.prompt.as_bytes())!=r.prompt_sha256 {
   return Err("Immutable prompt digest mismatch. No fixture output produced.".into())
  }
  let content=if r.scope=="write"||r.scope=="continue"{
   // A fixture is explicitly non-factual; its output never implies that AI was queried.
   let count=if r.scope=="write"&&r.step==0 {r.original_words.saturating_mul(2)/3}
      else {r.original_words.saturating_sub(r.original_words.saturating_mul(2)/3).saturating_add(3)};
   let mut terms=Vec::new();
   for n in 0..count.max(35){
    terms.push(match n%13 {
     0=>"[MOCK]",
     1=>"This",2=>"fictional",3=>"test",4=>"narration",5=>"preserves",6=>"the",
     7=>"chosen",8=>"scene",9=>"and",10=>"continues",11=>"without",_=>"external claims."
    });
   }
   // Distinct deterministic suffixes prevent synthetic recurring vocabulary from
   // creating a false 30-byte overlap at part boundaries (for example 117 words).
   // Complete sentence endings are maintained. This is MOCK text only.
   let mut output=terms.join(" ");
   if r.scope=="write"{output.push_str(" [MOCK-FIRST-FRAGMENT-END].")}
   else{output.push_str(" [MOCK-CONTINUATION-FRAGMENT-END].")}
   output
  }else if r.scope=="review"{
   return Err("Review fixtures must be built from the saved rubric, not generated free-form.".into())
  }else if r.scope=="improve"{
   let source=r.source_text.as_ref().ok_or("Missing verified source script for improvement.")?;
   if source.trim().is_empty()||source.len()>1_500_000{return Err("Invalid mock revision source.".into())}
   format!("Improved MOCK narration. {source}")
  }else{return Err("Unsupported deterministic fixture operation.".into())};
  Ok(AdapterReply{content_sha256:digest(content.as_bytes()),content,provenance:"deterministic_mock"})
 }
 fn review(&self,r:&AdapterRequest,state:&ReviewState,improved:bool)->Result<AdapterReply,String>{
  if r.provider!="fixture_reviewer"||r.scope!="review"||r.prompt.trim().is_empty()||
   digest(r.prompt.as_bytes())!=r.prompt_sha256{
   return Err("Invalid saved reviewer prompt or fixture identity.".into())
  }
  let content=make_review_fixture(state,improved)?;
  Ok(AdapterReply{content_sha256:digest(content.as_bytes()),content,provenance:"deterministic_mock"})
 }
}
fn op(prefix:&str,revision:u64)->String{format!("op_auto_{prefix}_{revision}")}
fn execute(store:&ExecutionStore,plan:&ScriptStudioPlanV1,state:&ExecutionState,action:ExecutionAction)
 ->Result<ExecutionState,String>{
 store.apply(plan,&ExecutionRequest{channel_id:plan.channel_id.clone(),
  execution_id:state.execution_id.clone(),expected_revision:state.revision,
  operation_id:op("ex",state.revision),action}).map_err(|e|e.to_string())
}
fn review_do(store:&ReviewStore,state:&ReviewState,action:ReviewAction)->Result<ReviewState,String>{
 store.apply(&ReviewRequest{channel_id:state.channel_id.clone(),review_id:state.review_id.clone(),
  expected_revision:state.revision,operation_id:op("rv",state.revision),action}).map_err(|e|e.to_string())
}
fn sync_execution(store:&SupervisorStore,task:&TaskState,source:&ExecutionState)->Result<TaskState,String>{
 store.apply(&TaskRequest{channel_id:task.channel_id.clone(),task_id:task.task_id.clone(),
  expected_revision:task.revision,operation_id:op("su",task.revision),
  action:TaskAction::SyncExecution},Some(source),None).map_err(|e|e.to_string())
}
fn sync_review(store:&SupervisorStore,task:&TaskState,source:&ReviewState)->Result<TaskState,String>{
 store.apply(&TaskRequest{channel_id:task.channel_id.clone(),task_id:task.task_id.clone(),
  expected_revision:task.revision,operation_id:op("su",task.revision),
  action:TaskAction::SyncReview{review_id:source.review_id.clone()}},None,Some(source)).map_err(|e|e.to_string())
}
pub fn make_review_fixture(state:&ReviewState,high:bool)->Result<String,String>{
 let rubric=&state.policy.rubric;
 if rubric.is_empty()||rubric.iter().map(|x|x.points).sum::<u32>()!=100 {
  return Err("Saved rubric weights are invalid.".into())
 }
 let target=if high{95}else{76};
 let scores=rubric.iter().map(|c|CategoryScore{key:c.key.clone(),
  points:if high{c.points}else{c.points.saturating_mul(target)/100}})
  .collect::<Vec<_>>();
 let report=Report{scores,findings:vec![Finding{severity:Severity::Info,
  category:rubric[0].key.clone(),summary:"Deterministic simulated critique; no provider used.".into(),
  recommendation:"Improve clarity and pacing in the simulated revision.".into()}],
  summary:format!("MOCK structured reviewer fixture. No AI model or remote reviewer used. Phase {}",if high{"improved"}else{"initial"})};
 serde_json::to_string(&report).map_err(|e|e.to_string())
}
fn completed_review(state:&ReviewState)->bool{
 state.rounds.last().is_some_and(|r|!r.sections.is_empty()&&r.sections.iter().all(|s|s.score.is_some()&&s.report.is_some()))
}
fn review_min(state:&ReviewState)->u32{
 state.rounds.last().map(|r|r.sections.iter().filter_map(|s|s.score).min().unwrap_or(0)).unwrap_or(0)
}
fn sources(ex:&ExecutionStore,state:&ExecutionState)->Result<Vec<ContextSource>,String>{
 let mut refs=Vec::new();
 for (kind,reference) in [("outline",state.outline_versions.last()),("bible",state.bible_versions.last())] {
  if let Some(reference)=reference{
   refs.push(ContextSource{kind:kind.into(),after_part:None,
    sha256:reference.sha256.clone(),bytes:reference.bytes,
    text:ex.read(&state.channel_id,&state.execution_id,kind,0,0).map_err(|e|e.to_string())?});
  }
 }
 let mut last=std::collections::BTreeMap::new();
 for n in &state.continuity_notes{last.insert(n.after_part,&n.document);}
 for (index,r) in last{
  refs.push(ContextSource{kind:"continuity".into(),after_part:Some(index),
   sha256:r.sha256.clone(),bytes:r.bytes,
   text:ex.read(&state.channel_id,&state.execution_id,"continuity",index,0).map_err(|e|e.to_string())?});
 }
 Ok(refs)
}
pub struct Coordinator<'a>{
 pub plan:&'a ScriptStudioPlanV1,pub execution:&'a ExecutionStore,
 pub review:&'a ReviewStore,pub supervisor:&'a SupervisorStore,
 pub adapter:&'a dyn ProviderAdapter,pub review_target:u32,pub max_improvements:u32
}
#[derive(Clone,Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct AutoOutcome{pub task_id:String,pub stage:Stage,pub completed_parts:u32,
 pub total_parts:u32,pub review_score:Option<u32>,pub revision_rounds:u32,
 pub provenance:&'static str,pub automatic:bool,pub waiting_for_approval:bool}
impl Coordinator<'_>{
 pub fn run(&self,task_id:&str,stop_after_parts:Option<u32>)->Result<AutoOutcome,String>{
  let c=self.adapter.check();
  if !c.automatic||!c.authorized||c.real_ai||c.provenance!="deterministic_mock"{
   return Err("No authorized automatic provider adapter is enabled. No consumer-site browser call made.".into())
  }
  if self.review_target>100||self.max_improvements>3{return Err("Unsupported review loop configuration.".into())}
  let channel=&self.plan.channel_id;
  let mut task=self.supervisor.get(channel,task_id).map_err(|e|e.to_string())?;
  if task.snapshot.transport!=Transport::LocalMock||task.snapshot.plan_sha256!=digest(&serde_json::to_vec(self.plan).map_err(|e|e.to_string())?){
   return Err("Wrong immutable task transport or plan snapshot; cannot run mock automation.".into())
  }
  if task.snapshot.reviewer_provider=="none"{return Err("A saved reviewer must be configured before one-click automatic review.".into())}
  if task.snapshot.writer_account_id!=self.plan.claude_account_id||
   task.snapshot.reviewer_account_id!=self.plan.reviewer_account_id{return Err("Task account bindings differ from saved plan.".into())}
  let mut steps=0;
  let mut last_score=None;
  loop {
   steps+=1;if steps>500{return Err("Automatic job stopped at the explicit transition limit; inspect history.".into())}
   task=self.supervisor.get(channel,task_id).map_err(|e|e.to_string())?;
   if matches!(task.stage,Stage::Paused|Stage::Cancelled|Stage::Failed|Stage::Completed){
    return Err("Job is paused or terminal; no new provider dispatch or source edits.".into())
   }
   let mut ex=self.execution.get(channel,&task.snapshot.execution_id).map_err(|e|e.to_string())?;
   if ex.completed_parts<ex.total_parts {
    if stop_after_parts.is_some_and(|n|ex.completed_parts>=n) {
     return Ok(self.outcome(&task,&ex,last_score,0,false))
    }
    if self.plan.outline_required&&ex.outline_versions.is_empty(){
     ex=execute(self.execution,self.plan,&ex,ExecutionAction::SaveOutline{text:
      format!("[MOCK] User-selected subject: {}. Part sequence: 1 through {}. Source facts not verified.",self.plan.topic,self.plan.part_count)})?;
     task=sync_execution(self.supervisor,&task,&ex)?;continue
    }
    if ex.bible_versions.is_empty() {
     ex=execute(self.execution,self.plan,&ex,ExecutionAction::SaveBible{text:
      format!("[MOCK] Script Bible: {}. Topic: {}. Language: {}. Use only hypothetical test material.",
       self.plan.title,self.plan.topic,self.plan.language)})?;
     task=sync_execution(self.supervisor,&task,&ex)?;continue
    }
    let index=ex.completed_parts+1;
    if self.plan.continuity_required&&index>1&&!ex.continuity_notes.iter().any(|n|n.after_part==index-1){
     let prior=self.execution.read(channel,&ex.execution_id,"part",index-1,0).map_err(|e|e.to_string())?;
     ex=execute(self.execution,self.plan,&ex,ExecutionAction::SaveContinuity{after_part:index-1,text:
      format!("[MOCK] Part {} summary (test only): text SHA-256 {}; no external facts inferred.",
       index-1,digest(prior.as_bytes()))})?;
     task=sync_execution(self.supervisor,&task,&ex)?;continue
    }
    let p=&ex.parts[(index-1) as usize];
    if p.prepared.is_none(){
     ex=execute(self.execution,self.plan,&ex,ExecutionAction::PreparePart{part_index:index,extra_instructions:"".into()})?;
     task=sync_execution(self.supervisor,&task,&ex)?;continue
    }
    let validation=if p.fragments.is_empty(){None}
     else{Some(self.execution.validate_candidate(channel,&ex.execution_id,index).map_err(|e|e.to_string())?)};
    let current_words=validation.as_ref().map(|x|x.actual_word_estimate).unwrap_or(0);
    // Deterministic truncation on a first fragment exercises real continuation storage.
    if p.fragments.len()<2&&current_words<p.target_words {
     let first=p.fragments.is_empty();
     if !first&&p.continuation_prompts.len()<p.fragments.len(){
      ex=execute(self.execution,self.plan,&ex,ExecutionAction::PrepareContinuation{part_index:index,extra_instructions:"".into()})?;
      task=sync_execution(self.supervisor,&task,&ex)?;continue
     }
     let kind=if first{"prompt"}else{"continuation"};
     let prompt=self.execution.read(channel,&ex.execution_id,kind,index,0).map_err(|e|e.to_string())?;
     let provider=if first{"write"}else{"continue"};
     let req=AdapterRequest{provider:"fixture_writer".into(),account_id:task.snapshot.writer_account_id.clone(),
      task_id:task_id.into(),scope:provider.into(),prompt_sha256:digest(prompt.as_bytes()),prompt,
      original_words:p.target_words,step:if first{0}else{1},source_text:None};
     let answer=self.adapter.execute(&req)?;
     if answer.provenance!="deterministic_mock"||answer.content_sha256!=digest(answer.content.as_bytes()){
      return Err("Provider returned unverified fixture provenance or corrupt digest.".into())
     }
     ex=execute(self.execution,self.plan,&ex,ExecutionAction::ImportFragment{part_index:index,text:answer.content})?;
     task=sync_execution(self.supervisor,&task,&ex)?;continue
    }
    let check=self.execution.validate_candidate(channel,&ex.execution_id,index).map_err(|e|e.to_string())?;
    if !check.findings.is_empty(){
     return Err(format!("Part {index} has unresolved technical warnings: {:?}. No automatic warning override.",check.findings))
    }
    ex=execute(self.execution,self.plan,&ex,ExecutionAction::CommitPart{part_index:index,accept_warnings:false})?;
    task=sync_execution(self.supervisor,&task,&ex)?;continue
   }
   if ex.assembled.is_none(){
    ex=execute(self.execution,self.plan,&ex,ExecutionAction::Assemble)?;
    task=sync_execution(self.supervisor,&task,&ex)?;continue
   }
   let existing=if let Some(id)=&task.last_review_id{Some(self.review.get(channel,id).map_err(|e|e.to_string())?)}else{None};
   let mut rv=if let Some(v)=existing{v}else{
    let script=self.execution.read(channel,&ex.execution_id,"assembled",0,0).map_err(|e|e.to_string())?;
    let input=StartReview{channel_id:channel.clone(),execution_id:ex.execution_id.clone(),
      review_id:format!("rv_{}",task.task_id.trim_start_matches("su_")),part_index:None,
      operation_id:format!("op_auto_review_start_{}",task.task_id)};
    let v=self.review.start_with_context_fixture(self.plan,&ex,&script,&input,&sources(self.execution,&ex)?)
     .map_err(|e|e.to_string())?;
    task=sync_review(self.supervisor,&task,&v)?;continue
   };
   let round=rv.rounds.last().ok_or("Review lacks a saved round.")?;
   let section=round.sections.iter().find(|s|s.raw.is_none());
   if let Some(section)=section{
    let prompt=self.review.read(channel,&rv.review_id,"prompt",section.index).map_err(|e|e.to_string())?;
    let req=AdapterRequest{provider:"fixture_reviewer".into(),account_id:task.snapshot.reviewer_account_id.clone(),
     task_id:task_id.into(),scope:"review".into(),prompt_sha256:digest(prompt.as_bytes()),prompt,
     original_words:0,step:round.index,source_text:None};
    let response=self.adapter.review(&req,&rv,rv.versions.len()>1)?;
    if response.provenance!="deterministic_mock"||response.content_sha256!=digest(response.content.as_bytes()){
     return Err("Review adapter response lacks verified deterministic fixture provenance.".into())
    }
    rv=review_do(self.review,&rv,ReviewAction::ImportFixtureResponse{section_index:section.index,raw:response.content})?;
    task=sync_review(self.supervisor,&task,&rv)?;continue
   }
   // A revised script has no current reviewer evidence until a NEW round exists.
   // This check MUST precede the threshold/max-round gate, or a crashed worker
   // could reuse the previous version's score and falsely finish after a revision.
   let v=rv.versions.last().ok_or("No review source version.")?;
   if rv.rounds.last().is_some_and(|r|r.version_index!=v.index){
    rv=review_do(self.review,&rv,ReviewAction::PrepareReview{mode:"improvement".into()})?;
    task=sync_review(self.supervisor,&task,&rv)?;continue
   }
   if !completed_review(&rv){return Err("Reviewer fixture invalid or incomplete; saved raw evidence preserved.".into())}
   last_score=Some(review_min(&rv));
   let improvements=(rv.versions.len()-1) as u32;
   if review_min(&rv)>=self.review_target||improvements>=self.max_improvements {
    task=sync_review(self.supervisor,&task,&rv)?;
    return Ok(self.outcome(&task,&ex,last_score,improvements,true))
   }
   if v.improvement_prompt.is_none(){
    rv=review_do(self.review,&rv,ReviewAction::PrepareImprovement{goals:vec![
     "Improve the opening and coherence using all review findings.".into()]})?;
    task=sync_review(self.supervisor,&task,&rv)?;continue
   }
   let review_round_version=rv.rounds.last().map(|x|x.version_index).unwrap_or(0);
   if review_round_version==v.index {
    let prompt=self.review.read(channel,&rv.review_id,"improvement",0).map_err(|e|e.to_string())?;
    let prior=self.review.read(channel,&rv.review_id,"script",v.index).map_err(|e|e.to_string())?;
    let req=AdapterRequest{provider:"fixture_writer".into(),account_id:task.snapshot.writer_account_id.clone(),
     task_id:task_id.into(),scope:"improve".into(),prompt_sha256:digest(prompt.as_bytes()),prompt,
     original_words:0,step:improvements,source_text:Some(prior)};
    let answer=self.adapter.execute(&req)?;
    if answer.provenance!="deterministic_mock"||answer.content_sha256!=digest(answer.content.as_bytes()){
     return Err("Revision adapter response lacks verified deterministic fixture provenance.".into())
    }
    rv=review_do(self.review,&rv,ReviewAction::ImportFixtureRevision{text:answer.content})?;
    task=sync_review(self.supervisor,&task,&rv)?;continue
   }
   return Err("Review improvement state is unexpected; immutable history preserved.".into())
  }
 }
 fn outcome(&self,task:&TaskState,ex:&ExecutionState,score:Option<u32>,rounds:u32,done:bool)->AutoOutcome{
  AutoOutcome{task_id:task.task_id.clone(),stage:task.stage.clone(),
   completed_parts:ex.completed_parts,total_parts:ex.total_parts,
   review_score:score,revision_rounds:rounds,provenance:"deterministic_mock",
   automatic:true,waiting_for_approval:done}
 }
}
#[cfg(test)]mod tests;
