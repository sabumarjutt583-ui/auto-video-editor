//! Phase 03K supervisor command boundary. No automated consumer-site requests.
use std::sync::Arc;
use serde::Serialize;
use tauri::{AppHandle,Manager,State};
use crate::script_supervisor::*;
use crate::script_studio::LegacyChannelSeed;
use crate::commands::{
 script_studio::{actual_seed,StudioService},script_execution::ExecutionService,
 script_review::ReviewService,script::ScriptAccounts,chatgpt::ChatGptAccounts,
};
pub struct SupervisorService{
 store:Option<Arc<SupervisorStore>>,error:Option<String>
}
impl SupervisorService{
 pub fn initialize(app:&AppHandle)->Self{
  let r=app.path().app_data_dir().map_err(|e|e.to_string())
   .and_then(|p|SupervisorStore::new(p.join("script-writer").join("supervisor")).map_err(|e|e.to_string()));
  match r{Ok(store)=>Self{store:Some(Arc::new(store)),error:None},
   Err(e)=>Self{store:None,error:Some(e)}}
 }
 pub(crate) fn store(&self)->Result<Arc<SupervisorStore>,CommandError>{
  self.store.as_ref().cloned().ok_or_else(||CommandError{
   message:self.error.clone().unwrap_or("Supervisor unavailable".into())})
 }
}
#[derive(Serialize)]
pub struct CommandError{pub message:String}
type Cmd<T>=Result<T,CommandError>;
impl From<SupervisorError> for CommandError{fn from(value:SupervisorError)->Self{Self{message:value.to_string()}}}
fn owner(app:&AppHandle,seed:&LegacyChannelSeed)->Cmd<String>{
 actual_seed(app,seed).map(|s|s.channel_id).map_err(|_|CommandError{message:"Saved channel profile not found or changed.".into()})
}
fn enabled()->Cmd<()>{
 if !cfg!(debug_assertions){return Err(CommandError{message:"Phase 03K supervisor is development-only.".into()})}
 Ok(())
}
async fn blocking<T:Send+'static>(f:impl FnOnce()->Result<T,SupervisorError>+Send+'static)->Cmd<T>{
 tauri::async_runtime::spawn_blocking(f).await.map_err(|_|CommandError{message:"Offline supervisor worker failed.".into()})?.map_err(Into::into)
}
#[tauri::command]
pub async fn supervisor_start(app:AppHandle,seed:LegacyChannelSeed,input:TaskStart,
 service:State<'_,SupervisorService>,studio:State<'_,StudioService>,execution:State<'_,ExecutionService>,
 claude:State<'_,Arc<ScriptAccounts>>,chatgpt:State<'_,Arc<ChatGptAccounts>>)->Cmd<TaskState>{
 enabled()?;let channel=owner(&app,&seed)?;
 if channel!=input.channel_id{return Err(CommandError{message:"Wrong channel.".into()})}
 let store=service.store()?;
 let plans=studio.store().map_err(|_|CommandError{message:"Plan store unavailable.".into()})?;
 let executions=execution.store().map_err(|_|CommandError{message:"Execution store unavailable.".into()})?;
 let claude_ids=claude.list().into_iter().map(|s|s.id).collect::<Vec<_>>();
 let chatgpt_ids=chatgpt.list().into_iter().map(|s|s.id).collect::<Vec<_>>();
 blocking(move||{
  let e=executions.get(&channel,&input.execution_id).map_err(|_|SupervisorError("Immutable execution not found for channel."))?;
  let p=plans.get_plan(&channel,&e.plan_id).map_err(|_|SupervisorError("Immutable plan not found for channel."))?;
  let c=&p.config_snapshot.accounts;
  // Immutable plan-selected account takes priority; alternative accounts never
  // silently replace that immutable binding.
  let actual_writer=resolve_account(p.claude_account_id.as_deref(),&claude_ids,
   c.writer_policy==crate::script_studio::AccountPolicy::StrictSelected,
   input.writer_account_id.as_deref(),&c.allowed_claude_account_ids)?;
  if actual_writer!=input.writer_account_id{return Err(SupervisorError("Writer selection must be explicit."))}
  let selected_reviewer=match &p.reviewer_provider{
   crate::script_studio::ReviewerProvider::Claude=>&claude_ids,
   crate::script_studio::ReviewerProvider::Chatgpt=>&chatgpt_ids,
   crate::script_studio::ReviewerProvider::None=>&chatgpt_ids
  };
  let reviewer=resolve_account(p.reviewer_account_id.as_deref(),selected_reviewer,
   c.reviewer_policy==crate::script_studio::AccountPolicy::StrictSelected,
   input.reviewer_account_id.as_deref(),
   if matches!(&p.reviewer_provider,crate::script_studio::ReviewerProvider::Claude){
    &c.allowed_claude_account_ids
   }else{&c.allowed_chatgpt_account_ids})?;
  if reviewer!=input.reviewer_account_id{return Err(SupervisorError("Reviewer selection must be explicit."))}
  store.start(&p,&e,&input)
 }).await
}
#[tauri::command]
pub async fn supervisor_list(app:AppHandle,seed:LegacyChannelSeed,
 service:State<'_,SupervisorService>)->Cmd<Vec<TaskState>>{
 enabled()?;let channel=owner(&app,&seed)?;let store=service.store()?;
 blocking(move||store.list(&channel)).await
}
#[tauri::command]
pub async fn supervisor_get(app:AppHandle,seed:LegacyChannelSeed,task_id:String,
 service:State<'_,SupervisorService>)->Cmd<TaskState>{
 enabled()?;let channel=owner(&app,&seed)?;let store=service.store()?;
 blocking(move||store.get(&channel,&task_id)).await
}
#[tauri::command]
pub async fn supervisor_apply(app:AppHandle,seed:LegacyChannelSeed,request:TaskRequest,
 service:State<'_,SupervisorService>,execution:State<'_,ExecutionService>,
 review:State<'_,ReviewService>)->Cmd<TaskState>{
 enabled()?;let channel=owner(&app,&seed)?;
 if request.channel_id!=channel{return Err(CommandError{message:"Supervisor channel mismatch.".into()})}
 let store=service.store()?;
 let executions=execution.store().map_err(|_|CommandError{message:"Execution store unavailable.".into()})?;
 let reviews=review.store().map_err(|_|CommandError{message:"Review store unavailable.".into()})?;
 blocking(move||{
  let current=store.get(&channel,&request.task_id)?;
  let e=if matches!(&request.action,TaskAction::SyncExecution|TaskAction::PreparePrompt){
   Some(executions.get(&channel,&current.snapshot.execution_id)
    .map_err(|_|SupervisorError("Source execution missing or corrupt; not advancing."))?)
  }else{None};
  let review_id=match &request.action{TaskAction::SyncReview{review_id}|TaskAction::InspectApproval{review_id}=>Some(review_id),_=>None};
  let saved=if let Some(id)=review_id{
   Some(reviews.get(&channel,id).map_err(|_|SupervisorError("Source review missing or corrupt; not advancing."))?)
  }else{None};
  store.apply(&request,e.as_ref(),saved.as_ref())
 }).await
}
#[derive(Clone,serde::Deserialize)]
#[serde(rename_all="snake_case")]
pub enum MockScenario{Complete,Delayed,Partial,ProviderFailure,ConnectionLost,SubmissionUncertain,TooLarge,InvalidReview}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct MockResult{pub status:&'static str,pub provenance:&'static str,pub text:Option<String>,pub issue:Option<&'static str>}
#[tauri::command]
pub async fn supervisor_mock(seed:LegacyChannelSeed,app:AppHandle,
 service:State<'_,SupervisorService>,task_id:String,part_index:u32,scenario:MockScenario)->Cmd<MockResult>{
 enabled()?;let channel=owner(&app,&seed)?;let store=service.store()?;
 let s=blocking(move||store.get(&channel,&task_id)).await?;
 if s.snapshot.transport!=Transport::LocalMock{return Err(CommandError{message:"Mock disabled for this task transport.".into()})}
 if part_index==0||part_index>s.total_parts{return Err(CommandError{message:"Invalid part index.".into()})}
 let words=s.snapshot.plan.parts[(part_index-1) as usize].target_words;
 let (status,text,issue)=match scenario{
  MockScenario::Complete=>("mock_complete",Some(format!(
   "Part {part_index}: This is a deterministic offline test paragraph. {} The ending is complete.",
   "Controlled local text is never a Claude or ChatGPT response. ".repeat(words.min(150) as usize/10+1))),None),
  MockScenario::Delayed=>("mock_delayed_pending",None,Some("Deterministic delay gate: no response yet; explicitly request the complete mock when ready. No timers or external calls.")),
  MockScenario::Partial=>("mock_partial",Some(format!("Part {part_index}: An intentionally unfinished fragment")) ,Some("Partial response: import as fragment, never commit without checking.")),
  MockScenario::ProviderFailure=>("mock_failure",None,Some("Synthetic provider error; no external connection was attempted.")),
  MockScenario::ConnectionLost=>("mock_disconnected",None,Some("Synthetic connection interruption; retry requires explicit user choice.")),
  MockScenario::SubmissionUncertain=>("mock_uncertain",None,Some("Synthetic uncertain submission; never retry automatically.")),
  MockScenario::TooLarge=>("mock_limit",None,Some("Mock output exceeded the declared local response limit.")),
  MockScenario::InvalidReview=>("mock_invalid_review",Some("{invalid JSON".into()),Some("Intentionally invalid manual report for correction testing.")),
 };
 Ok(MockResult{status,provenance:"deterministic_local_mock_no_provider_network",text,issue})
}
