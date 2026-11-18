//! Phase 03M development-only automatic fixture executor Tauri boundary.
//! No Claude/ChatGPT consumer website request, no API key, no browser profile mutation.
use std::{collections::{HashMap,HashSet},fs::{self,File,OpenOptions},
 io::Write,path::PathBuf,sync::{Arc,Mutex}};
use rand::RngCore;
use serde::{Deserialize,Serialize};
use tauri::{AppHandle,Manager,State};
use crate::{
 commands::{script_studio::{actual_seed,StudioService},script_execution::ExecutionService,
  script_review::ReviewService,script_supervisor::SupervisorService,
  script::ScriptAccounts,chatgpt::ChatGptAccounts},
 script_studio::{LegacyChannelSeed,PlanInput,ScriptMode},
 script_supervisor::{SupervisorStore,TaskState,TaskStart,TaskRequest,TaskAction,Transport,Stage},
 script_execution::{ExecutionStore,ExecutionState,StartExecution},
 script_review::{ReviewStore,ReviewState},
 script_automation::{AutoMode,AutoOutcome,Coordinator,FixtureProvider,capability,AdapterCapability},
 script_jobs::model::{digest,valid_id},
};
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct AutoPolicy{
 pub schema_version:u32,pub channel_id:String,pub task_id:String,
 pub execution_id:String,pub plan_id:String,pub plan_digest:String,
 pub mode:AutoMode,pub review_target:u32,pub max_improvements:u32,
}
#[derive(Default)]
struct Inner {root:PathBuf,running:Mutex<HashSet<String>>,errors:Mutex<HashMap<String,String>>}
#[derive(Clone)]
pub struct AutoService{inner:Arc<Inner>}
impl AutoService{
 pub fn initialize(app:&AppHandle)->Self{
  let root=app.path().app_data_dir().unwrap_or_else(|_|std::env::temp_dir().join("unavailable-app-data"))
   .join("script-writer").join("automatic");
  Self{inner:Arc::new(Inner{root,..Inner::default()})}
 }
 fn path(&self,channel:&str,task:&str)->Result<PathBuf,AutoError>{
  if !valid_id(channel)||!valid_id(task)||!task.starts_with("su_auto_"){return Err(err("Invalid automatic task identity."))}
  Ok(self.inner.root.join("channels").join(channel).join(format!("{task}.json")))
 }
 fn save(&self,p:&AutoPolicy)->Result<(),AutoError>{
  let path=self.path(&p.channel_id,&p.task_id)?;
  let parent=path.parent().ok_or_else(||err("Automatic policy path missing."))?;
  fs::create_dir_all(parent).map_err(|_|err("Cannot create automatic policy directory."))?;
  for dir in [self.inner.root.as_path(),self.inner.root.join("channels").as_path(),parent]{
   let meta=fs::symlink_metadata(dir).map_err(|_|err("Cannot check policy storage directory."))?;
   if !meta.is_dir()||meta.file_type().is_symlink(){return Err(err("Unsafe policy storage directory; nothing overwritten."))}
  }
  if fs::symlink_metadata(&path).is_ok(){return Err(err("Automatic task policy already exists; no overwrite."))}
  let temp=parent.join(format!(".auto-{}.tmp",random()));
  let bytes=serde_json::to_vec_pretty(p).map_err(|_|err("Cannot serialize policy."))?;
  let mut f=OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|_|err("Cannot create temporary policy."))?;
  let result=(||{
   f.write_all(&bytes).and_then(|_|f.sync_all()).map_err(|_|err("Cannot durably write policy."))?;
   if fs::symlink_metadata(&path).is_ok(){return Err(err("Policy path appeared concurrently; no overwrite."))}
   fs::rename(&temp,&path).map_err(|_|err("Could not publish automatic policy."))?;
   Ok(())
  })();
  if result.is_err(){let _=fs::remove_file(&temp);}
  result
 }
 fn get(&self,channel:&str,task:&str)->Result<AutoPolicy,AutoError>{
  let path=self.path(channel,task)?;
  let parent=path.parent().ok_or_else(||err("Invalid policy folder."))?;
  for folder in [self.inner.root.as_path(),self.inner.root.join("channels").as_path(),parent]{
   let m=fs::symlink_metadata(folder).map_err(|_|err("Automatic policy folder unavailable."))?;
   if !m.is_dir()||m.file_type().is_symlink(){return Err(err("Unsafe automatic policy folder."))}
  }
  let meta=fs::symlink_metadata(&path).map_err(|_|err("Automatic task policy missing."))?;
  if !meta.is_file()||meta.file_type().is_symlink()||meta.len()>16*1024{
   return Err(err("Automatic policy file invalid or unsafe."))
  }
  let data=fs::read(path).map_err(|_|err("Cannot read automatic policy."))?;
  let p:AutoPolicy=serde_json::from_slice(&data).map_err(|_|err("Automatic policy corrupt."))?;
  if p.schema_version!=1||p.channel_id!=channel||p.task_id!=task
   ||!p.plan_id.starts_with("sp_")||!p.execution_id.starts_with("ex_")
   ||p.mode!=AutoMode::LocalFixture||p.review_target>100||p.max_improvements>3{
   return Err(err("Automatic policy identity or capability invalid."))
  }
  Ok(p)
 }
 fn launch(&self,p:AutoPolicy,plan:crate::script_studio::ScriptStudioPlanV1,
  ex:Arc<ExecutionStore>,review:Arc<ReviewStore>,sup:Arc<SupervisorStore>)->Result<(),AutoError>{
  if p.mode!=AutoMode::LocalFixture{return Err(err("Only deterministic fixture executor is authorized."))}
  if p.plan_digest!=digest(&serde_json::to_vec(&plan).map_err(|_|err("Cannot hash immutable plan."))?){
   return Err(err("Automatic policy plan digest changed; execution blocked."))
  }
  let task=sup.get(&p.channel_id,&p.task_id).map_err(|_|err("Automatic task missing."))?;
  if task.snapshot.transport!=Transport::LocalMock || task.snapshot.execution_id!=p.execution_id
   ||task.snapshot.plan_sha256!=p.plan_digest{return Err(err("Automatic task binding mismatch."))}
  if matches!(task.stage,Stage::Cancelled|Stage::Paused|Stage::Completed|Stage::Failed){
   return Err(err("Paused/terminal task cannot be dispatched."))}
  {
   let mut active=self.inner.running.lock().unwrap_or_else(|e|e.into_inner());
   if !active.insert(p.task_id.clone()){return Err(err("This task already has an automatic worker running."))}
  }
  let state=self.inner.clone();
  tauri::async_runtime::spawn_blocking(move||{
   let id=p.task_id.clone();
   let outcome=Coordinator{plan:&plan,execution:&ex,review:&review,supervisor:&sup,
     adapter:&FixtureProvider,review_target:p.review_target,max_improvements:p.max_improvements}
     .run(&id,None);
   if let Err(ref error)=outcome{
    state.errors.lock().unwrap_or_else(|e|e.into_inner()).insert(id.clone(),error.clone());
   }else{state.errors.lock().unwrap_or_else(|e|e.into_inner()).remove(&id);}
   state.running.lock().unwrap_or_else(|e|e.into_inner()).remove(&id);
  });
  Ok(())
 }
 fn running(&self,id:&str)->bool{
  self.inner.running.lock().unwrap_or_else(|e|e.into_inner()).contains(id)
 }
 fn error(&self,id:&str)->Option<String>{
  self.inner.errors.lock().unwrap_or_else(|e|e.into_inner()).get(id).cloned()
 }
}
#[derive(Clone,Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct AutoError{pub message:String}
fn err(s:impl Into<String>)->AutoError{AutoError{message:s.into()}}
type Cmd<T>=Result<T,AutoError>;
fn enabled()->Cmd<()>{
 if !cfg!(debug_assertions){return Err(err("Phase 03M automatic fixture engine is development-only."))}
 Ok(())
}
fn random()->String{
 let mut b=[0u8;16];rand::rng().fill_bytes(&mut b);b.iter().map(|x|format!("{x:02x}")).collect()
}
#[derive(Clone,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct AutoStart {
 pub title:String,pub topic:String,pub script_mode:ScriptMode,
 pub target_words:u32,pub part_count:u32,pub review_target:u32,
 pub max_improvements:u32,pub mode:AutoMode
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct AutoView {
 pub task:TaskState,pub execution:ExecutionState,pub review:Option<ReviewState>,
 pub policy:AutoPolicy,pub capability:AdapterCapability,
 pub worker_running:bool,pub worker_error:Option<String>,
 pub real_ai_result_verified:bool,
}
fn view(service:&AutoService,channel:&str,task_id:&str,
 ex:&ExecutionStore,review:&ReviewStore,sup:&SupervisorStore)->Cmd<AutoView>{
 let policy=service.get(channel,task_id)?;
 let task=sup.get(channel,task_id).map_err(|e|err(e.to_string()))?;
 let execution=ex.get(channel,&policy.execution_id).map_err(|e|err(e.to_string()))?;
 if task.snapshot.plan_sha256!=policy.plan_digest||task.snapshot.execution_id!=policy.execution_id
  ||execution.plan_digest!=policy.plan_digest{return Err(err("Automatic task/source snapshots differ."))}
 let review=task.last_review_id.as_ref().map(|id|review.get(channel,id)).transpose().map_err(|e|err(e.to_string()))?;
 Ok(AutoView{task,execution,review,capability:capability(&policy.mode),policy,
  worker_running:service.running(task_id),worker_error:service.error(task_id),
  real_ai_result_verified:false})
}
fn account_gate(plan:&crate::script_studio::ScriptStudioPlanV1,claude:&ScriptAccounts,chatgpt:&ChatGptAccounts)->Cmd<()>{
 let writer=plan.claude_account_id.as_ref().ok_or_else(||err("Selected Claude writer account missing in saved plan."))?;
 if !claude.list().iter().any(|x|x.id==*writer){return Err(err("Saved Claude writer account does not exist. No fallback."))}
 if let Some(id)=&plan.reviewer_account_id{
  let available=match plan.reviewer_provider{
   crate::script_studio::ReviewerProvider::Chatgpt=>chatgpt.list().iter().any(|x|x.id==*id),
   crate::script_studio::ReviewerProvider::Claude=>claude.list().iter().any(|x|x.id==*id),
   _=>false,
  };
  if !available{return Err(err("Selected reviewer provider/account unavailable. No fallback."))}
 }else{return Err(err("Reviewer account required for automatic review."))}
 if let Some(skill)=plan.selected_skill_id.as_ref().and_then(|id|
  plan.config_snapshot.skills.iter().find(|x|&x.skill_id==id)){
  if skill.claude_account_id!=*writer{return Err(err("Registered Skill belongs to a different Claude account."))}
 }
 Ok(())
}
#[tauri::command]
pub async fn auto_capability(mode:AutoMode)->Cmd<AdapterCapability>{
 enabled()?;Ok(capability(&mode))
}
#[tauri::command]
pub async fn auto_generate(app:AppHandle,seed:LegacyChannelSeed,request:AutoStart,
 service:State<'_,AutoService>,studio:State<'_,StudioService>,
 execution:State<'_,ExecutionService>,review:State<'_,ReviewService>,
 supervisor:State<'_,SupervisorService>,claude:State<'_,Arc<ScriptAccounts>>,
 chatgpt:State<'_,Arc<ChatGptAccounts>>)->Cmd<AutoView>{
 enabled()?;
 if request.mode!=AutoMode::LocalFixture{
  return Err(err("Unsupported browser consumer-site automation: explicit provider authorization missing. No task started."))
 }
 if request.review_target>100||request.max_improvements>3||request.title.trim().is_empty(){
  return Err(err("Review threshold, revision cap or title invalid."))}
 let saved=actual_seed(&app,&seed).map_err(|_|err("Channel identity could not be verified."))?;
 let plans=studio.store().map_err(|_|err("Saved Studio unavailable."))?;
 let ex=execution.store().map_err(|_|err("Execution store unavailable."))?;
 let rv=review.store().map_err(|_|err("Review store unavailable."))?;
 let sup=supervisor.store().map_err(|_|err("Supervisor store unavailable."))?;
 let cfg=plans.get(&saved).map_err(|e|err(e.to_string()))?;
 let id=random();
 let input=PlanInput{plan_id:format!("sp_auto_{id}"),channel_id:saved.channel_id.clone(),
  expected_config_revision:cfg.revision,title:request.title,topic:request.topic,
  language:None,mode:Some(request.script_mode),
  total_words:Some(request.target_words),part_count:Some(request.part_count),
  outline_required:None,continuity_required:None,parts:Vec::new()};
 let plan=plans.save_plan(&saved,&input).map_err(|e|err(e.to_string()))?;
 account_gate(&plan,&claude,&chatgpt)?;
 let execution_id=format!("ex_auto_{id}");
 let state=ex.start(&plan,&StartExecution{channel_id:saved.channel_id.clone(),
  plan_id:plan.plan_id.clone(),execution_id:execution_id.clone(),operation_id:format!("op_auto_ex_{id}")})
  .map_err(|e|err(e.to_string()))?;
 let task_id=format!("su_auto_{id}");
 let skill=plan.selected_skill_id.as_ref().and_then(|sid|plan.config_snapshot.skills.iter().find(|s|&s.skill_id==sid));
 let skill_status=match skill.map(|s|&s.status){
  Some(crate::script_studio::SkillInstallStatus::RegisteredLocally)=>"registered_locally",
  Some(crate::script_studio::SkillInstallStatus::UserConfirmedInstalled)=>"user_confirmed_installed",
  Some(crate::script_studio::SkillInstallStatus::NeedsAttention)=>"needs_attention",
  None=>"not_configured"
 };
 let task=sup.start(&plan,&state,&TaskStart{channel_id:saved.channel_id.clone(),
  task_id:task_id.clone(),execution_id:execution_id.clone(),
  operation_id:format!("op_auto_sup_{id}"),writer_account_id:plan.claude_account_id.clone(),
  reviewer_account_id:plan.reviewer_account_id.clone(),skill_status:skill_status.into(),
  transport:Transport::LocalMock}).map_err(|e|err(e.to_string()))?;
 let policy=AutoPolicy{schema_version:1,channel_id:saved.channel_id.clone(),
  task_id:task.task_id.clone(),execution_id:state.execution_id.clone(),plan_id:plan.plan_id.clone(),
  plan_digest:task.snapshot.plan_sha256.clone(),mode:request.mode,
  review_target:request.review_target,max_improvements:request.max_improvements};
 service.save(&policy)?;
 service.launch(policy,plan,ex.clone(),rv.clone(),sup.clone())?;
 view(&service,&saved.channel_id,&task_id,&ex,&rv,&sup)
}
#[tauri::command]
pub async fn auto_status(app:AppHandle,seed:LegacyChannelSeed,task_id:String,
 service:State<'_,AutoService>,execution:State<'_,ExecutionService>,
 review:State<'_,ReviewService>,supervisor:State<'_,SupervisorService>)->Cmd<AutoView>{
 enabled()?;
 let seed=actual_seed(&app,&seed).map_err(|_|err("Saved channel missing."))?;
 view(&service,&seed.channel_id,&task_id,
  &execution.store().map_err(|_|err("Execution store unavailable."))?,
  &review.store().map_err(|_|err("Review store unavailable."))?,
  &supervisor.store().map_err(|_|err("Supervisor store unavailable."))?)
}
#[tauri::command]
pub async fn auto_list(app:AppHandle,seed:LegacyChannelSeed,service:State<'_,AutoService>,
 supervisor:State<'_,SupervisorService>)->Cmd<Vec<TaskState>>{
 enabled()?;let seed=actual_seed(&app,&seed).map_err(|_|err("Saved channel missing."))?;
 let list=supervisor.store().map_err(|_|err("Supervisor unavailable."))?
  .list(&seed.channel_id).map_err(|e|err(e.to_string()))?;
 Ok(list.into_iter().filter(|t|t.task_id.starts_with("su_auto_")&&
  service.get(&seed.channel_id,&t.task_id).is_ok()).collect())
}
#[tauri::command]
pub async fn auto_control(app:AppHandle,seed:LegacyChannelSeed,task_id:String,action:String,
 service:State<'_,AutoService>,studio:State<'_,StudioService>,
 execution:State<'_,ExecutionService>,review:State<'_,ReviewService>,
 supervisor:State<'_,SupervisorService>,claude:State<'_,Arc<ScriptAccounts>>,
 chatgpt:State<'_,Arc<ChatGptAccounts>>)->Cmd<AutoView>{
 enabled()?;let saved=actual_seed(&app,&seed).map_err(|_|err("Saved channel missing."))?;
 let policy=service.get(&saved.channel_id,&task_id)?;
 let plans=studio.store().map_err(|_|err("Studio unavailable."))?;
 let plan=plans.get_plan(&saved.channel_id,&policy.plan_id).map_err(|e|err(e.to_string()))?;
 if digest(&serde_json::to_vec(&plan).map_err(|e|err(e.to_string()))?)!=policy.plan_digest {
  return Err(err("Immutable plan differs from automatic task policy."))}
 let ex=execution.store().map_err(|_|err("Execution unavailable."))?;
 let rv=review.store().map_err(|_|err("Review unavailable."))?;
 let sup=supervisor.store().map_err(|_|err("Supervisor unavailable."))?;
 let task=sup.get(&saved.channel_id,&task_id).map_err(|e|err(e.to_string()))?;
 let supervisor_action=match action.as_str(){
  "pause"=>TaskAction::Pause,"resume"=>TaskAction::Resume,"cancel"=>TaskAction::Cancel,
  _=>return Err(err("Unsupported automation control.")),
 };
 if action=="resume"{account_gate(&plan,&claude,&chatgpt)?}
 let next=sup.apply(&TaskRequest{channel_id:saved.channel_id.clone(),task_id:task_id.clone(),
  expected_revision:task.revision,operation_id:format!("op_auto_control_{}",random()),
  action:supervisor_action},None,None).map_err(|e|err(e.to_string()))?;
 if action=="resume"&&next.stage!=Stage::Completed{
  service.launch(policy,plan,ex.clone(),rv.clone(),sup.clone())?;
 }
 view(&service,&saved.channel_id,&task_id,&ex,&rv,&sup)
}
