//! Phase 03K: offline, Rust-owned supervision. Never drives consumer AI sites.
use std::{fs::{self,File,OpenOptions},io::{Read,Write},path::{Path,PathBuf},sync::Mutex,collections::HashSet};
use serde::{Serialize,Deserialize};
use crate::script_jobs::{lock,model::{digest,valid_id}};
use crate::script_studio::{ScriptStudioPlanV1,validate_stored_plan};
use crate::script_execution::ExecutionState;
use crate::script_review::ReviewState;
const MAX_CHECKPOINTS:u64=320;
const MAX_STATE:u64=2*1024*1024;
#[derive(Debug)]
pub struct SupervisorError(pub &'static str);
impl std::fmt::Display for SupervisorError{fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result{f.write_str(self.0)}}
impl std::error::Error for SupervisorError{}
fn invalid()->SupervisorError{SupervisorError("Invalid or unauthorized supervisor operation; nothing changed.")}
fn blocked()->SupervisorError{SupervisorError("Supervisor file integrity or recovery blocked; inspect preserved files.")}
fn ioerr()->SupervisorError{SupervisorError("Supervisor storage operation failed; no prior checkpoint removed.")}
fn new_id()->String{use rand::RngCore;let mut b=[0u8;16];rand::rng().fill_bytes(&mut b);b.iter().map(|v|format!("{v:02x}")).collect()}
fn clean_dir(path:&Path,create:bool)->Result<bool,SupervisorError>{
 match fs::symlink_metadata(path){
  Ok(m) if m.is_dir()&&!m.file_type().is_symlink()=>Ok(true),
  Ok(_)=>Err(blocked()),
  Err(e) if e.kind()==std::io::ErrorKind::NotFound&&create=>{fs::create_dir(path).map_err(|_|ioerr())?;Ok(true)},
  Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(false),
  _=>Err(ioerr())
 }
}
fn read(path:&Path)->Result<Vec<u8>,SupervisorError>{
 let m=fs::symlink_metadata(path).map_err(|_|blocked())?;
 if !m.is_file()||m.file_type().is_symlink()||m.len()>MAX_STATE{return Err(blocked())}
 let mut bytes=Vec::new();File::open(path).map_err(|_|ioerr())?.take(MAX_STATE+1).read_to_end(&mut bytes).map_err(|_|ioerr())?;
 if bytes.len() as u64>MAX_STATE{return Err(blocked())}Ok(bytes)
}
fn publish(path:&Path,bytes:&[u8])->Result<(),SupervisorError>{
 if bytes.len() as u64>MAX_STATE||fs::symlink_metadata(path).is_ok(){return Err(blocked())}
 let dir=path.parent().ok_or_else(ioerr)?;
 let tmp=dir.join(format!(".supervisor-{}.tmp",new_id()));
 let mut f=OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(|_|ioerr())?;
 f.write_all(bytes).and_then(|_|f.sync_all()).map_err(|_|ioerr())?;
 fs::rename(&tmp,path).map_err(|_|ioerr())?;
 #[cfg(unix)] File::open(dir).and_then(|d|d.sync_all()).map_err(|_|ioerr())?;
 Ok(())
}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="snake_case")]
pub enum Transport{VisibleBrowser,LocalMock,AuthorizedApi}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="snake_case")]
pub enum Stage{
 Created,ResolvingConfiguration,AwaitingLogin,BrowserOpening,AwaitingUserAction,
 PromptPrepared,SubmissionUncertain,AwaitingResponse,ResponseImported,ResponseValidated,
 PartCommitted,ReviewPending,ReviewImported,ImprovementPending,AwaitingApproval,
 Completed,Paused,Cancelled,Failed
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct SupervisorSnapshot{
 pub plan:ScriptStudioPlanV1,pub plan_sha256:String,pub execution_id:String,
 pub writer_account_id:Option<String>,pub reviewer_account_id:Option<String>,
 pub reviewer_provider:String,pub selected_skill_id:Option<String>,pub selected_skill_name:Option<String>,
 pub skill_status:String,pub transport:Transport,pub capabilities:Vec<String>,
}
impl std::fmt::Debug for SupervisorSnapshot{
 fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result{
  f.debug_struct("SupervisorSnapshot")
   .field("plan_id",&self.plan.plan_id)
   .field("plan_sha256",&self.plan_sha256)
   .field("execution_id",&self.execution_id)
   .field("transport",&self.transport)
   .field("selected_skill_id",&self.selected_skill_id).finish()
 }
}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct TaskState{
 pub schema_version:u32,pub task_id:String,pub channel_id:String,pub revision:u64,
 pub previous_digest:Option<String>,pub operation_id:String,pub operation_digest:String,
 pub snapshot:SupervisorSnapshot,pub stage:Stage,pub resume_stage:Option<Stage>,
 pub last_execution_revision:u64,pub last_execution_digest:String,pub completed_parts:u32,pub total_parts:u32,
 pub last_review_id:Option<String>,pub last_review_revision:Option<u64>,
 pub reviewed_sections:u32,pub total_sections:u32,pub approval_digest:Option<String>,
 pub warnings:Vec<String>,pub events:Vec<String>,
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct TaskStart{
 pub channel_id:String,pub task_id:String,pub execution_id:String,
 pub operation_id:String,pub writer_account_id:Option<String>,pub reviewer_account_id:Option<String>,
 pub skill_status:String,pub transport:Transport,
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct TaskRequest{
 pub channel_id:String,pub task_id:String,pub expected_revision:u64,pub operation_id:String,
 pub action:TaskAction,
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(tag="kind",rename_all="snake_case",rename_all_fields="camelCase")]
pub enum TaskAction{
 PreparePrompt,MarkBrowserOpening,MarkBrowserOpened,MarkLoginRequired,MarkUserHandoff,
 MarkSubmissionUncertain,MarkAwaitingResponse,Pause,Resume,Cancel,
 SyncExecution,SyncReview{review_id:String},InspectApproval{review_id:String},
}
pub fn capabilities(transport:&Transport)->Vec<String>{
 match transport{
  Transport::VisibleBrowser=>vec!["open_visible_profile","copy_local_prompt","manual_response_import"],
  Transport::LocalMock=>vec!["deterministic_offline_text","simulated_failures","manual_review_fixture"],
  Transport::AuthorizedApi=>vec!["UNAVAILABLE_no_explicit_approved_adapter"],
 }.into_iter().map(str::to_string).collect()
}
pub fn resolve_account(selected:Option<&str>,actual:&[String],strict:bool,requested:Option<&str>,allow:&[String])
 ->Result<Option<String>,SupervisorError>{
 match(selected,requested){
  (None,None)=>Ok(None),
  (Some(id),None) if actual.iter().any(|a|a==id)=>Ok(Some(id.into())),
  (Some(_),None)=>Err(SupervisorError("Selected account missing; no silent fallback.")),
  (_,Some(choice)) if !actual.iter().any(|a|a==choice)=>Err(SupervisorError("Requested account missing from existing account manager.")),
  (Some(id),Some(choice)) if choice==id=>Ok(Some(choice.into())),
  (_,Some(choice)) if !strict&&allow.iter().any(|a|a==choice)=>Ok(Some(choice.into())),
  _=>Err(SupervisorError("Alternate account requires explicit permitted fallback; no silent rotation.")),
 }
}
pub fn verify_start(plan:&ScriptStudioPlanV1,execution:&ExecutionState,input:&TaskStart)->Result<SupervisorSnapshot,SupervisorError>{
 validate_stored_plan(plan).map_err(|_|invalid())?;
 let hash=digest(&serde_json::to_vec(plan).map_err(|_|ioerr())?);
 if !valid_id(&input.channel_id)||!input.task_id.starts_with("su_")||!valid_id(&input.task_id)
  ||!valid_id(&input.operation_id)||plan.channel_id!=input.channel_id
  ||execution.channel_id!=input.channel_id||execution.execution_id!=input.execution_id
  ||execution.plan_id!=plan.plan_id||execution.plan_digest!=hash{return Err(invalid())}
 if input.transport==Transport::AuthorizedApi{return Err(SupervisorError("No authorized API adapter is configured. No consumer-site automation is permitted."))}
 let a=&plan.config_snapshot.accounts;
 if plan.claude_account_id!=input.writer_account_id{
  if a.writer_policy!=crate::script_studio::AccountPolicy::AutomaticPermitted
   ||!input.writer_account_id.as_ref().is_some_and(|id|a.allowed_claude_account_ids.contains(id)){
   return Err(SupervisorError("Writer account differs from the immutable plan. An explicit permitted fallback is required."))
  }
 }
 if plan.reviewer_account_id!=input.reviewer_account_id{
  let allowed=if matches!(&plan.reviewer_provider,crate::script_studio::ReviewerProvider::Claude){
   &a.allowed_claude_account_ids
  }else{&a.allowed_chatgpt_account_ids};
  if a.reviewer_policy!=crate::script_studio::AccountPolicy::AutomaticPermitted
   ||!input.reviewer_account_id.as_ref().is_some_and(|id|allowed.contains(id)){
   return Err(SupervisorError("Reviewer account differs from the immutable plan. An explicit permitted fallback is required."))
  }
 }
 let skill=plan.selected_skill_id.as_ref().and_then(|id|
  plan.config_snapshot.skills.iter().find(|s|&s.skill_id==id));
 if plan.selected_skill_id.is_some()&&skill.is_none(){return Err(invalid())}
 if skill.is_some_and(|s|input.writer_account_id.as_deref()!=Some(s.claude_account_id.as_str())){
  return Err(SupervisorError("Configured Skill requires a different Claude account; no silent reassignment."))
 }
 let canonical_skill=skill.map(|x|match x.status{
  crate::script_studio::SkillInstallStatus::RegisteredLocally=>"registered_locally",
  crate::script_studio::SkillInstallStatus::UserConfirmedInstalled=>"user_confirmed_installed",
  crate::script_studio::SkillInstallStatus::NeedsAttention=>"needs_attention",
 }).unwrap_or("not_configured");
 if input.skill_status!=canonical_skill{return Err(SupervisorError("Skill status must match the immutable local registry; remote activation is never assumed."))}
 Ok(SupervisorSnapshot{plan:plan.clone(),plan_sha256:hash,execution_id:input.execution_id.clone(),
  writer_account_id:input.writer_account_id.clone(),reviewer_account_id:input.reviewer_account_id.clone(),
  reviewer_provider:match plan.reviewer_provider{
   crate::script_studio::ReviewerProvider::None=>"none",
   crate::script_studio::ReviewerProvider::Claude=>"claude",
   crate::script_studio::ReviewerProvider::Chatgpt=>"chatgpt"}.into(),
  selected_skill_id:plan.selected_skill_id.clone(),selected_skill_name:plan.selected_skill_name.clone(),
  skill_status:input.skill_status.clone(),transport:input.transport.clone(),capabilities:capabilities(&input.transport)})
}
fn state_path(dir:&Path,n:u64)->PathBuf{dir.join(format!("state-{n:06}.json"))}
fn history(dir:&Path)->Result<Vec<TaskState>,SupervisorError>{
 if !clean_dir(dir,false)?{return Err(blocked())}
 let mut ids=Vec::new();
 for e in fs::read_dir(dir).map_err(|_|ioerr())?{
  let name=e.map_err(|_|ioerr())?.file_name().into_string().map_err(|_|blocked())?;
  if !name.starts_with("state-")||!name.ends_with(".json")||name.len()!=17{return Err(blocked())}
  ids.push(name[6..12].parse::<u64>().map_err(|_|blocked())?);
 }
 ids.sort_unstable();if ids.is_empty()||ids.len()>MAX_CHECKPOINTS as usize{return Err(blocked())}
 let mut out:Vec<TaskState>=Vec::new();let mut ops=HashSet::new();
 for (i,n) in ids.into_iter().enumerate(){
  if n!=i as u64{return Err(blocked())}
  let s:TaskState=serde_json::from_slice(&read(&state_path(dir,n))?).map_err(|_|blocked())?;
  if s.schema_version!=1||s.revision!=n||!s.task_id.starts_with("su_")||!valid_id(&s.task_id)
   ||!valid_id(&s.channel_id)||s.snapshot.plan.channel_id!=s.channel_id
   ||s.snapshot.plan_sha256!=digest(&serde_json::to_vec(&s.snapshot.plan).map_err(|_|blocked())?)
   ||s.total_parts!=s.snapshot.plan.part_count
   ||s.completed_parts>s.total_parts||s.events.is_empty()
   ||!ops.insert(s.operation_id.clone()){return Err(blocked())}
  if let Some(prev)=out.last(){
   if s.previous_digest.as_deref()!=Some(digest(&serde_json::to_vec(prev).map_err(|_|blocked())?).as_str())
    ||s.channel_id!=prev.channel_id||s.task_id!=prev.task_id
    ||serde_json::to_vec(&s.snapshot).map_err(|_|blocked())?
       !=serde_json::to_vec(&prev.snapshot).map_err(|_|blocked())?
    ||s.events.len()!=prev.events.len()+1||s.events[..prev.events.len()]!=prev.events
    ||s.last_execution_revision<prev.last_execution_revision
    ||s.completed_parts<prev.completed_parts{return Err(blocked())}
  }else if s.previous_digest.is_some(){return Err(blocked())}
  out.push(s);
 }
 Ok(out)
}
pub struct SupervisorStore{root:PathBuf,lease:File,mutex:Mutex<()>}
impl Drop for SupervisorStore{fn drop(&mut self){lock::unlock(&self.lease)}}
impl SupervisorStore{
 pub fn new(root:PathBuf)->Result<Self,SupervisorError>{
  clean_dir(&root,true)?;clean_dir(&root.join("channels"),true)?;
  let path=root.join("writer.lock");
  if fs::symlink_metadata(&path).is_ok_and(|m|!m.is_file()||m.file_type().is_symlink()){return Err(blocked())}
  let lease=OpenOptions::new().create(true).read(true).write(true).open(path).map_err(|_|ioerr())?;
  lock::try_lock(&lease).map_err(|_|SupervisorError("Another supervisor process holds the writer lock."))?;
  Ok(Self{root,lease,mutex:Mutex::new(())})
 }
 fn folder(&self,channel:&str,task:&str)->Result<PathBuf,SupervisorError>{
  if !valid_id(channel)||!task.starts_with("su_")||!valid_id(task){return Err(invalid())}
  let ch=self.root.join("channels").join(channel);clean_dir(&ch,false)?;Ok(ch.join(task))
 }
 pub fn start(&self,plan:&ScriptStudioPlanV1,e:&ExecutionState,input:&TaskStart)->Result<TaskState,SupervisorError>{
  let snapshot=verify_start(plan,e,input)?;
  let _g=self.mutex.lock().unwrap_or_else(|p|p.into_inner());
  let channel=self.root.join("channels").join(&input.channel_id);
  let dir=self.folder(&input.channel_id,&input.task_id)?;
  let op=digest(&serde_json::to_vec(input).map_err(|_|ioerr())?);
  if clean_dir(&dir,false)?{
   let h=history(&dir)?;let first=&h[0];let last=h.last().ok_or_else(blocked)?;
   if first.operation_id==input.operation_id&&first.operation_digest==op{return Ok(last.clone())}
   return Err(invalid())
  }
  clean_dir(&channel,true)?;clean_dir(&dir,true)?;
  let state=TaskState{schema_version:1,task_id:input.task_id.clone(),channel_id:input.channel_id.clone(),
   revision:0,previous_digest:None,operation_id:input.operation_id.clone(),operation_digest:op,
   snapshot,stage:Stage::Created,resume_stage:None,last_execution_revision:e.revision,
   last_execution_digest:digest(&serde_json::to_vec(e).map_err(|_|ioerr())?),
   completed_parts:e.completed_parts,total_parts:e.total_parts,
   last_review_id:None,last_review_revision:None,reviewed_sections:0,total_sections:0,
   approval_digest:None,warnings:Vec::new(),events:vec!["created_from_immutable_plan_and_execution".into()]};
  publish(&state_path(&dir,0),&serde_json::to_vec(&state).map_err(|_|ioerr())?)?;
  Ok(state)
 }
 pub fn get(&self,channel:&str,task:&str)->Result<TaskState,SupervisorError>{
  let _g=self.mutex.lock().unwrap_or_else(|p|p.into_inner());
  history(&self.folder(channel,task)?)?.pop().ok_or_else(blocked)
 }
 pub fn list(&self,channel:&str)->Result<Vec<TaskState>,SupervisorError>{
  let _g=self.mutex.lock().unwrap_or_else(|p|p.into_inner());
  if !valid_id(channel){return Err(invalid())}
  let dir=self.root.join("channels").join(channel);
  if !clean_dir(&dir,false)?{return Ok(Vec::new())}
  let mut items=Vec::new();
  for entry in fs::read_dir(dir).map_err(|_|ioerr())?{
   let e=entry.map_err(|_|ioerr())?;let name=e.file_name().into_string().map_err(|_|blocked())?;
   if !name.starts_with("su_")||!valid_id(&name){return Err(blocked())}
   let latest=history(&e.path())?.pop().ok_or_else(blocked)?;
   if latest.channel_id!=channel||latest.task_id!=name{return Err(blocked())}
   items.push(latest);
  }
  Ok(items)
 }
 pub fn apply(&self,input:&TaskRequest,e:Option<&ExecutionState>,r:Option<&ReviewState>)
 ->Result<TaskState,SupervisorError>{
  let _g=self.mutex.lock().unwrap_or_else(|p|p.into_inner());
  if !valid_id(&input.operation_id){return Err(invalid())}
  let dir=self.folder(&input.channel_id,&input.task_id)?;let h=history(&dir)?;
  let current=h.last().ok_or_else(blocked)?;
  if current.channel_id!=input.channel_id||current.task_id!=input.task_id{return Err(blocked())}
  let op=digest(&serde_json::to_vec(input).map_err(|_|ioerr())?);
  if let Some(old)=h.iter().find(|s|s.operation_id==input.operation_id){
   if old.operation_digest==op&&old.revision==input.expected_revision+1{return Ok(current.clone())}
   return Err(invalid())
  }
  if current.revision!=input.expected_revision||current.revision>=MAX_CHECKPOINTS-1{return Err(SupervisorError("Stale revision or checkpoint cap; reload and inspect."))}
  if matches!(&current.stage,Stage::Cancelled|Stage::Completed)
   &&!matches!(&input.action,TaskAction::SyncReview{..}|TaskAction::InspectApproval{..}){
   return Err(SupervisorError("Terminal task cannot be restarted silently."))
  }
  if current.stage==Stage::Paused&&!matches!(&input.action,TaskAction::Resume|TaskAction::Cancel){
   return Err(SupervisorError("Task is paused. Resume explicitly before advancing source evidence."))
  }
  let mut next=current.clone();
  next.revision+=1;next.previous_digest=Some(digest(&serde_json::to_vec(current).map_err(|_|ioerr())?));
  next.operation_id=input.operation_id.clone();next.operation_digest=op;
  let event=match &input.action {
   TaskAction::Pause=>{if current.stage==Stage::Paused{return Err(invalid())}
    next.resume_stage=Some(current.stage.clone());next.stage=Stage::Paused;"user_paused"},
   TaskAction::Resume=>{if current.stage!=Stage::Paused{return Err(invalid())}
    next.stage=current.resume_stage.clone().ok_or_else(invalid)?;next.resume_stage=None;"user_resumed"},
   TaskAction::Cancel=>{next.stage=Stage::Cancelled;"cancelled_without_deleting_source_data"},
   TaskAction::PreparePrompt=>{
    let source=e.ok_or_else(||SupervisorError("A prompt cannot be marked prepared without a verified execution checkpoint."))?;
    if source.channel_id!=current.channel_id||source.execution_id!=current.snapshot.execution_id
      ||source.plan_digest!=current.snapshot.plan_sha256
      ||!source.parts.iter().any(|p|p.prepared.is_some()&&p.committed.is_none()){return Err(invalid())}
    next.stage=Stage::PromptPrepared;"verified_local_prompt_prepared_not_submitted"},
   TaskAction::MarkBrowserOpening=>{if current.snapshot.transport!=Transport::VisibleBrowser{return Err(invalid())}
    next.stage=Stage::BrowserOpening;"visible_browser_launch_requested"},
   TaskAction::MarkBrowserOpened=>{if current.stage!=Stage::BrowserOpening||current.snapshot.transport!=Transport::VisibleBrowser{return Err(invalid())}
    next.stage=Stage::AwaitingUserAction;"browser_window_opened_manual_interaction_required"},
   TaskAction::MarkLoginRequired=>{if current.snapshot.transport!=Transport::VisibleBrowser{return Err(invalid())}
    next.stage=Stage::AwaitingLogin;"user_managed_signin_needed"},
   TaskAction::MarkUserHandoff=>{if current.snapshot.transport!=Transport::VisibleBrowser{return Err(invalid())}
    next.stage=Stage::AwaitingUserAction;"manual_user_action_required_no_submission_claim"},
   TaskAction::MarkSubmissionUncertain=>{
    if !matches!(&current.stage,Stage::PromptPrepared|Stage::AwaitingUserAction|Stage::AwaitingResponse){
     return Err(SupervisorError("No prepared prompt or user handoff exists; submission cannot be marked uncertain."))
    }
    next.stage=Stage::SubmissionUncertain;"delivery_uncertain_no_auto_retry"},
   TaskAction::MarkAwaitingResponse=>{
    if !matches!(&current.stage,Stage::PromptPrepared|Stage::AwaitingUserAction|Stage::SubmissionUncertain){
     return Err(SupervisorError("Awaiting response requires prior saved prompt or manual browser handoff."))
    }
    next.stage=Stage::AwaitingResponse;"awaiting_manual_or_mock_response_not_received"},
   TaskAction::SyncExecution=>{
    let x=e.ok_or_else(invalid)?;
    let binding=&current.snapshot;
    if x.channel_id!=current.channel_id||x.execution_id!=binding.execution_id||
     x.plan_id!=binding.plan.plan_id||x.plan_digest!=binding.plan_sha256||
     x.revision<current.last_execution_revision||x.completed_parts<current.completed_parts{return Err(invalid())}
    let hash=digest(&serde_json::to_vec(x).map_err(|_|ioerr())?);
    if x.revision==current.last_execution_revision&&hash!=current.last_execution_digest{return Err(blocked())}
    next.last_execution_revision=x.revision;next.last_execution_digest=hash;next.completed_parts=x.completed_parts;
    next.stage=if x.assembled.is_some(){Stage::ReviewPending}
      else if x.completed_parts>current.completed_parts{Stage::PartCommitted}
      else if x.parts.iter().any(|part|!part.fragments.is_empty()&&part.committed.is_none()){Stage::ResponseImported}
      else if x.parts.iter().any(|part|part.prepared.is_some()&&part.committed.is_none()){Stage::PromptPrepared}
      else{Stage::Created};
    "verified_immutable_execution_checkpoint"
   },
   TaskAction::SyncReview{review_id}|TaskAction::InspectApproval{review_id}=>{
    let x=r.ok_or_else(invalid)?;
    if x.channel_id!=current.channel_id||x.execution_id!=current.snapshot.execution_id||
      x.plan_id!=current.snapshot.plan.plan_id||x.plan_digest!=current.snapshot.plan_sha256||
      x.review_id!=*review_id||x.part_index.is_some(){return Err(invalid())}
    if x.rounds.last().is_none(){return Err(invalid())}
    let round=x.rounds.last().ok_or_else(invalid)?;
    let version=x.versions.last().ok_or_else(invalid)?;
    next.last_review_id=Some(x.review_id.clone());next.last_review_revision=Some(x.revision);
    next.reviewed_sections=round.sections.iter().filter(|s|s.report.is_some()&&s.score.is_some()).count() as u32;
    next.total_sections=round.sections.len() as u32;
    next.approval_digest=x.approvals.iter().find(|a|a.version_index==version.index
      &&a.script_digest==version.text.sha256&&a.round_index==round.index).map(|a|a.script_digest.clone());
    next.stage=if next.approval_digest.is_some(){Stage::Completed}
      else if next.reviewed_sections==next.total_sections{Stage::AwaitingApproval}
      else{Stage::ReviewPending};
    "verified_immutable_review_checkpoint_manual_provenance"
   },
  };
  next.events.push(event.into());
  publish(&state_path(&dir,next.revision),&serde_json::to_vec(&next).map_err(|_|ioerr())?)?;
  Ok(next)
 }
}
#[cfg(test)]mod tests;
