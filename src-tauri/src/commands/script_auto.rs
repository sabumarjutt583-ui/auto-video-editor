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
 script_review::{ReviewStore,ReviewState,ReviewAction,ReviewRequest},
 script_automation::{AutoMode,AutoOutcome,Coordinator,FixtureProvider,capability,AdapterCapability},
 script_jobs::model::{digest,valid_id},
};
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct AutoPolicy{
 pub schema_version:u32,pub channel_id:String,pub task_id:String,
 pub execution_id:String,pub plan_id:String,pub plan_digest:String,
 pub mode:AutoMode,pub review_target:u32,pub max_improvements:u32,
 #[serde(default)]pub integrity_sha256:String,
}
impl AutoPolicy{
 fn hash(&self)->Cmd<String>{
  let mut unsigned=self.clone();unsigned.integrity_sha256.clear();
  serde_json::to_vec(&unsigned).map(|bytes|digest(&bytes)).map_err(|_|err("Automatic policy could not be hashed."))
 }
 fn seal(&mut self)->Cmd<()>{self.integrity_sha256=self.hash()?;Ok(())}
 fn verify(&self)->Cmd<()>{
  if self.integrity_sha256.is_empty()||self.integrity_sha256!=self.hash()?{
   return Err(err("Automatic policy integrity mismatch or unsigned legacy record; nothing changed."))
  }
  Ok(())
 }
}
/// Policy storage must never follow account/channel redirects, including Windows junctions.
fn safe_policy_dir(path:&std::path::Path,create:bool)->Cmd<()>{
 match fs::symlink_metadata(path){
  Ok(meta)=>{
   if !meta.is_dir()||meta.file_type().is_symlink(){
    return Err(err("Unsafe automatic policy folder; no policy was modified."))
   }
   #[cfg(windows)]{
    use std::os::windows::fs::MetadataExt;
    if meta.file_attributes()&0x400!=0{
     return Err(err("Automatic policy directory is a Windows reparse point; refusing redirected storage."))
    }
   }
   Ok(())
  }
  Err(e) if create&&e.kind()==std::io::ErrorKind::NotFound=>{
   fs::create_dir(path).map_err(|_|err("Cannot safely create automatic policy directory."))?;
   safe_policy_dir(path,false)
  },
  Err(_)=>Err(err("Automatic policy directory is missing or cannot be inspected.")),
 }
}
#[derive(Default)]
struct Inner {root:Option<PathBuf>,running:Mutex<HashSet<String>>,
 accounts:Mutex<HashSet<String>>,errors:Mutex<HashMap<String,String>>}
/// A worker's per-account reservation is released even when its closure panics.
struct WorkerLease {inner:Arc<Inner>,task_id:String,accounts:Vec<String>}
impl Drop for WorkerLease {
 fn drop(&mut self){
  let mut running=self.inner.running.lock().unwrap_or_else(|e|e.into_inner());
  let mut accounts=self.inner.accounts.lock().unwrap_or_else(|e|e.into_inner());
  running.remove(&self.task_id);
  for account in &self.accounts{accounts.remove(account);}
 }
}
impl Inner {
 fn claim(self:&Arc<Self>,task_id:&str,mut keys:Vec<String>)->Cmd<WorkerLease>{
  keys.sort();keys.dedup();
  if keys.is_empty()||keys.iter().any(|k|k.trim().is_empty()){
   return Err(err("No configured account identities available to reserve."))
  }
  let mut running=self.running.lock().unwrap_or_else(|e|e.into_inner());
  let mut accounts=self.accounts.lock().unwrap_or_else(|e|e.into_inner());
  if running.contains(task_id){return Err(err("This task already has a worker."))}
  if keys.iter().any(|key|accounts.contains(key)){
   return Err(err("A selected AI account is reserved by another automatic task. Retry after its worker stops; no account rotation."))
  }
  running.insert(task_id.to_string());
  for key in &keys{accounts.insert(key.clone());}
  Ok(WorkerLease{inner:self.clone(),task_id:task_id.to_string(),accounts:keys})
 }
}
fn assigned_accounts(plan:&crate::script_studio::ScriptStudioPlanV1)->Cmd<Vec<String>>{
 let id=plan.claude_account_id.as_deref().ok_or_else(||err("Writer account is missing."))?;
 let mut accounts=vec![format!("claude:{id}")];
 let reviewer=plan.reviewer_account_id.as_deref().ok_or_else(||err("Reviewer account is missing."))?;
 match plan.reviewer_provider {
  crate::script_studio::ReviewerProvider::Claude=>accounts.push(format!("claude:{reviewer}")),
  crate::script_studio::ReviewerProvider::Chatgpt=>accounts.push(format!("chatgpt:{reviewer}")),
  crate::script_studio::ReviewerProvider::None=>return Err(err("Automatic reviewer provider is not configured.")),
 }
 Ok(accounts)
}
#[derive(Clone)]
pub struct AutoService{inner:Arc<Inner>}
impl AutoService{
 pub fn initialize(app:&AppHandle)->Self{
  // Never silently write channel ownership metadata into a global temporary directory.
  let root=app.path().app_data_dir().ok().map(|p|p.join("script-writer").join("automatic"));
  Self{inner:Arc::new(Inner{root,..Inner::default()})}
 }
 fn path(&self,channel:&str,task:&str)->Result<PathBuf,AutoError>{
  if !valid_id(channel)||!valid_id(task)||!task.starts_with("su_auto_"){return Err(err("Invalid automatic task identity."))}
  let root=self.inner.root.as_ref().ok_or_else(||err("App data unavailable; automatic policy cannot be stored."))?;
  Ok(root.join("channels").join(channel).join(format!("{task}.json")))
 }
 fn save(&self,p:&AutoPolicy)->Result<(),AutoError>{
  p.verify()?;
  let path=self.path(&p.channel_id,&p.task_id)?;
  let parent=path.parent().ok_or_else(||err("Automatic policy path missing."))?;
  let root=self.inner.root.as_ref().ok_or_else(||err("Automatic policy root unavailable."))?;
  let channel_root=root.join("channels");
  // Parent exists because the Studio/Execution stores are initialized first.
  safe_policy_dir(root.parent().ok_or_else(||err("Automatic policy parent missing."))?,false)?;
  for dir in [root.as_path(),channel_root.as_path(),parent]{
   safe_policy_dir(dir,true)?;
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
  let root=self.inner.root.as_ref().ok_or_else(||err("Automatic policy root unavailable."))?;
  let channel_root=root.join("channels");
  safe_policy_dir(root.parent().ok_or_else(||err("Automatic policy parent missing."))?,false)?;
  for folder in [root.as_path(),channel_root.as_path(),parent]{
   safe_policy_dir(folder,false)?;
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
  p.verify()?;
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
  let lease=self.inner.claim(&p.task_id,assigned_accounts(&plan)?)?;
  let state=self.inner.clone();
  tauri::async_runtime::spawn_blocking(move||{
   let _lease=lease; // RAII: always releases the selected provider/account locks.
   let id=p.task_id.clone();
   let outcome=Coordinator{plan:&plan,execution:&ex,review:&review,supervisor:&sup,
     adapter:&FixtureProvider,review_target:p.review_target,max_improvements:p.max_improvements}
     .run(&id,None);
   if let Err(ref error)=outcome{
    state.errors.lock().unwrap_or_else(|e|e.into_inner()).insert(id.clone(),error.clone());
    if let Ok(t)=sup.get(&p.channel_id,&id){
     if !matches!(t.stage,Stage::Paused|Stage::Cancelled|Stage::Completed|Stage::Failed){
      let _=sup.apply(&TaskRequest{channel_id:p.channel_id.clone(),task_id:id.clone(),
       expected_revision:t.revision,operation_id:format!("op_auto_block_{}",t.revision),
       action:TaskAction::MarkAutomaticBlocked{reason:error.chars().take(300).collect()}},None,None);
     }
    }
   }else{state.errors.lock().unwrap_or_else(|e|e.into_inner()).remove(&id);}
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
/// Persist an explicit reason when automatic MOCK startup recovery cannot continue.
fn record_recovery_blocked(auto:&AutoService,sup:&SupervisorStore,task:&TaskState,message:&str){
 let reason=format!("Automatic MOCK startup recovery blocked: {message}");
 auto.inner.errors.lock().unwrap_or_else(|e|e.into_inner())
  .insert(task.task_id.clone(),reason.clone());
 if task.snapshot.transport==Transport::LocalMock &&
  !matches!(task.stage,Stage::Paused|Stage::Cancelled|Stage::Completed|Stage::Failed){
  let _=sup.apply(&TaskRequest{
   channel_id:task.channel_id.clone(),task_id:task.task_id.clone(),
   expected_revision:task.revision,operation_id:format!("op_auto_recovery_block_{}",task.revision),
   action:TaskAction::MarkAutomaticBlocked{reason:reason.chars().take(300).collect()}
  },None,None);
 }
}
fn require_approval_digest(expected:&str,actual:&str)->Cmd<()>{
 if expected.len()!=64||expected!=actual{
  return Err(err("Script changed or was not previewed. Open and review the exact current version before approval."))
 }
 Ok(())
}
/// Restart only safe local fixture jobs. Never reattach or dispatch to consumer sites.
pub fn recover_at_startup(app:&AppHandle){
 if !cfg!(debug_assertions){return}
 let (Some(auto),Some(studio),Some(execution),Some(review),Some(supervisor),
      Some(claude),Some(chatgpt))=(
  app.try_state::<AutoService>(),app.try_state::<StudioService>(),
  app.try_state::<ExecutionService>(),app.try_state::<ReviewService>(),
  app.try_state::<SupervisorService>(),app.try_state::<Arc<ScriptAccounts>>(),
  app.try_state::<Arc<ChatGptAccounts>>())else{return};
 let (Ok(plans),Ok(ex),Ok(rv),Ok(sup))=(
  studio.store(),execution.store(),review.store(),supervisor.store())else{return};
 let Ok(settings)=crate::settings::load(app)else{return};
 for item in &settings.channel_profiles{
  let Some(channel)=item.get("id").and_then(|x|x.as_str())else{continue};
  let Ok(tasks)=sup.list(channel)else{continue};
  for task in tasks{
   if !task.task_id.starts_with("su_auto_")||
    matches!(task.stage,Stage::Paused|Stage::Cancelled|Stage::Failed|Stage::Completed|Stage::AwaitingApproval){
    continue;
   }
   let policy=match auto.get(channel,&task.task_id){
    Ok(p)=>p,Err(e)=>{record_recovery_blocked(&auto,&sup,&task,&e.message);continue}
   };
   let plan=match plans.get_plan(channel,&policy.plan_id){
    Ok(p)=>p,Err(e)=>{record_recovery_blocked(&auto,&sup,&task,&e.to_string());continue}
   };
   if let Err(e)=account_gate(&plan,&claude,&chatgpt){
    record_recovery_blocked(&auto,&sup,&task,&e.message);continue
   }
   if let Err(e)=auto.launch(policy,plan,ex.clone(),rv.clone(),sup.clone()){
    record_recovery_blocked(&auto,&sup,&task,&e.message);
   }
  }
 }
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
 let preview=plans.preview(&saved,&input).map_err(|e|err(e.to_string()))?;
 account_gate(&preview.plan,&claude,&chatgpt)?;
 let plan=plans.save_plan(&saved,&input).map_err(|e|err(e.to_string()))?;
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
 let mut policy=AutoPolicy{schema_version:1,channel_id:saved.channel_id.clone(),
  task_id:task.task_id.clone(),execution_id:state.execution_id.clone(),plan_id:plan.plan_id.clone(),
  plan_digest:task.snapshot.plan_sha256.clone(),mode:request.mode,
  review_target:request.review_target,max_improvements:request.max_improvements,integrity_sha256:String::new()};
 policy.seal()?;
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
 let ex=execution.store().map_err(|_|err("Execution store unavailable."))?;
 let rv=review.store().map_err(|_|err("Review store unavailable."))?;
 let sup=supervisor.store().map_err(|_|err("Supervisor store unavailable."))?;
 view(&service,&seed.channel_id,&task_id,&ex,&rv,&sup)
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
 if action=="recover" {
  account_gate(&plan,&claude,&chatgpt)?;
  service.launch(policy,plan,ex.clone(),rv.clone(),sup.clone())?;
  return view(&service,&saved.channel_id,&task_id,&ex,&rv,&sup)
 }
 let supervisor_action=match action.as_str(){
  "pause"=>TaskAction::Pause,"resume"=>TaskAction::Resume,"cancel"=>TaskAction::Cancel,
  _=>return Err(err("Unsupported automation control.")),
 };
 if action=="resume"{
  if service.running(&task_id){return Err(err("The previous local worker is still finishing. Refresh and resume after it stops."))}
  account_gate(&plan,&claude,&chatgpt)?;
 }
 let next=sup.apply(&TaskRequest{channel_id:saved.channel_id.clone(),task_id:task_id.clone(),
  expected_revision:task.revision,operation_id:format!("op_auto_control_{}",random()),
  action:supervisor_action},None,None).map_err(|e|err(e.to_string()))?;
 if action=="resume"&&next.stage!=Stage::Completed{
  service.launch(policy,plan,ex.clone(),rv.clone(),sup.clone())?;
 }
 view(&service,&saved.channel_id,&task_id,&ex,&rv,&sup)
}

#[tauri::command]
pub async fn auto_approve(app:AppHandle,seed:LegacyChannelSeed,task_id:String,confirmation:String,
 expected_script_digest:String,service:State<'_,AutoService>,review:State<'_,ReviewService>,
 execution:State<'_,ExecutionService>,supervisor:State<'_,SupervisorService>)->Cmd<AutoView>{
 enabled()?;
 if confirmation!="APPROVE FINAL SCRIPT"{return Err(err("Exact user confirmation required."))}
 let owner=actual_seed(&app,&seed).map_err(|_|err("Saved channel missing."))?.channel_id;
 let policy=service.get(&owner,&task_id)?;
 if service.running(&task_id){return Err(err("Cannot approve while automatic fixture worker is running."))}
 let ex=execution.store().map_err(|_|err("Execution store unavailable."))?;
 let rv=review.store().map_err(|_|err("Review store unavailable."))?;
 let sup=supervisor.store().map_err(|_|err("Supervisor store unavailable."))?;
 let task=sup.get(&owner,&task_id).map_err(|e|err(e.to_string()))?;
 if task.stage!=Stage::AwaitingApproval||task.snapshot.plan_sha256!=policy.plan_digest{
  return Err(err("Current final review checkpoint is not ready for explicit approval."))
 }
 let review_id=task.last_review_id.ok_or_else(||err("Final review evidence missing."))?;
 let current=rv.get(&owner,&review_id).map_err(|e|err(e.to_string()))?;
 let round=current.rounds.last().ok_or_else(||err("No saved review round."))?;
 let latest=current.versions.last().ok_or_else(||err("No immutable script version."))?;
 require_approval_digest(&expected_script_digest,&latest.text.sha256)?;
 if round.version_index!=latest.index||
  round.sections.is_empty()||round.sections.iter().any(|s|s.report.is_none()||s.score.is_none()){
  return Err(err("The current script version requires a complete fresh review before approval."))
 }
 let min_score=round.sections.iter().filter_map(|s|s.score).min().unwrap_or(0);
 let completed_improvements=current.versions.len().saturating_sub(1) as u32;
 if min_score<policy.review_target&&completed_improvements<policy.max_improvements{
  return Err(err("Review score below the configured target and improvement rounds remain; recover the automatic task first."))
 }
 let approved=rv.apply(&ReviewRequest{channel_id:owner.clone(),review_id,
  expected_revision:current.revision,operation_id:format!("op_auto_user_approval_{}",random()),
  action:ReviewAction::Approve{confirmation}}).map_err(|e|err(e.to_string()))?;
 sup.apply(&TaskRequest{channel_id:owner.clone(),task_id:task_id.clone(),
  expected_revision:task.revision,operation_id:format!("op_auto_approved_{}",random()),
  action:TaskAction::SyncReview{review_id:approved.review_id.clone()}},None,Some(&approved))
  .map_err(|e|err(e.to_string()))?;
 view(&service,&owner,&task_id,&ex,&rv,&sup)
}

#[cfg(test)]
mod tests{
 use super::*;
 fn new_fixture()->(AutoService,PathBuf){
  let root=std::env::temp_dir().join(format!("sw03m-auto-policy-{}",random()));
  fs::create_dir_all(root.join("script-writer")).unwrap();
  let path=root.join("script-writer").join("automatic");
  (AutoService{inner:Arc::new(Inner{root:Some(path),..Inner::default()})},root)
 }
 fn fixture_policy()->AutoPolicy{
  let mut p=AutoPolicy{schema_version:1,channel_id:"channel_a".into(),task_id:"su_auto_a".into(),
   execution_id:"ex_auto_a".into(),plan_id:"sp_auto_a".into(),plan_digest:"sha256_fixture".into(),
   mode:AutoMode::LocalFixture,review_target:90,max_improvements:2,integrity_sha256:String::new()};
  p.seal().unwrap();p
 }
 #[test]fn sw03m_approval_requires_exact_current_script_digest(){
  let sha="a".repeat(64);
  assert!(require_approval_digest(&sha,&sha).is_ok());
  assert!(require_approval_digest("",&sha).is_err());
  assert!(require_approval_digest(&"b".repeat(64),&sha).is_err());
  assert!(require_approval_digest("a",&sha).is_err());
 }
 #[test]fn sw03m_auto_policy_never_overwrites_or_leaks_across_channels(){
  let (service,root)=new_fixture();
  let policy=fixture_policy();
  service.save(&policy).unwrap();
  let loaded=service.get("channel_a","su_auto_a").unwrap();
  assert_eq!(loaded.review_target,90);
  assert!(service.save(&policy).is_err());
  assert!(service.get("channel_b","su_auto_a").is_err());
  assert!(service.get("channel_a","su_other").is_err());
  let original=fs::read(service.path("channel_a","su_auto_a").unwrap()).unwrap();
  assert!(service.save(&policy).is_err());
  assert_eq!(fs::read(service.path("channel_a","su_auto_a").unwrap()).unwrap(),original);
  drop(service);fs::remove_dir_all(root).unwrap();
 }
 #[cfg(unix)]
 #[test]fn sw03m_auto_policy_refuses_symlinked_storage(){
  let (service,root)=new_fixture();
  let base=root.join("script-writer").join("automatic");
  let outside=root.join("outside");
  fs::create_dir_all(&outside).unwrap();
  std::os::unix::fs::symlink(&outside,&base).unwrap();
  assert!(service.save(&fixture_policy()).is_err());
  assert_eq!(fs::read_dir(&outside).unwrap().count(),0);
  drop(service);fs::remove_dir_all(root).unwrap();
 }

 #[test]fn sw03m_account_leases_serialize_shared_provider_accounts_without_rotation(){
  let inner=Arc::new(Inner::default());
  let first=inner.claim("su_auto_first",vec!["claude:cl_1".into(),"chatgpt:gp_1".into()]).unwrap();
  assert!(inner.claim("su_auto_first",vec!["claude:cl_1".into()]).is_err());
  assert!(inner.claim("su_auto_second",vec!["claude:cl_1".into(),"chatgpt:gp_2".into()]).is_err());
  assert!(inner.claim("su_auto_second",vec!["claude:cl_2".into(),"chatgpt:gp_1".into()]).is_err());
  let unrelated=inner.claim("su_auto_third",vec!["claude:cl_2".into(),"chatgpt:gp_2".into()]).unwrap();
  drop(first);
  let second=inner.claim("su_auto_second",vec!["claude:cl_1".into(),"chatgpt:gp_1".into()]).unwrap();
  drop(unrelated);drop(second);
  assert!(inner.running.lock().unwrap().is_empty());
  assert!(inner.accounts.lock().unwrap().is_empty());
 }
 #[test]fn sw03m_auto_policy_rejects_tampered_review_target_after_restart(){
  let (service,root)=new_fixture();
  let p=fixture_policy();service.save(&p).unwrap();
  let file=service.path("channel_a","su_auto_a").unwrap();
  let mut value:serde_json::Value=serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
  value["reviewTarget"]=serde_json::json!(0);
  fs::write(&file,serde_json::to_vec(&value).unwrap()).unwrap();
  assert!(service.get("channel_a","su_auto_a").is_err());
  drop(service);fs::remove_dir_all(root).unwrap();
 }
  #[test]fn sw03m_auto_policy_requires_private_app_data_path(){
  let service=AutoService{inner:Arc::new(Inner{root:None,..Inner::default()})};
  assert!(service.save(&fixture_policy()).is_err());
  assert!(service.get("channel_a","su_auto_a").is_err());
 }
}
