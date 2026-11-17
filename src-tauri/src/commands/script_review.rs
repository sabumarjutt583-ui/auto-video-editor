//! Phase 03J offline-only review commands. Authorized channel profiles remain authoritative.
use std::sync::Arc;
use serde::Serialize;
use tauri::{AppHandle,Manager,State};
use crate::commands::{script_studio::{actual_seed,StudioService},script_execution::ExecutionService};
use crate::script_studio::LegacyChannelSeed;
use crate::script_review::*;

pub struct ReviewService{
 store:Option<Arc<ReviewStore>>,unavailable:Option<ReviewErrorCode>
}
impl ReviewService{
 pub fn initialize(app:&AppHandle)->Self{
  let initialized=app.path().app_data_dir()
   .map_err(|_|ReviewErrorCode::StorageFailure)
   .and_then(|p|ReviewStore::new(p.join("script-writer").join("reviews")).map_err(|e|e.code));
  match initialized{
   Ok(store)=>Self{store:Some(Arc::new(store)),unavailable:None},
   Err(e)=>Self{store:None,unavailable:Some(e)}
  }
 }
 fn store(&self)->Cmd<Arc<ReviewStore>>{
  self.store.as_ref().cloned().ok_or(CommandError{
   code:self.unavailable.unwrap_or(ReviewErrorCode::StorageFailure),
   message:"Offline review store unavailable; production workflows unaffected.".into()
  })
 }
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct CommandError{pub code:ReviewErrorCode,pub message:String}
impl From<ReviewError> for CommandError{
 fn from(e:ReviewError)->Self{Self{code:e.code,message:e.message.into()}}
}
type Cmd<T>=Result<T,CommandError>;
fn owner(app:&AppHandle,seed:&LegacyChannelSeed)->Cmd<String>{
 actual_seed(app,seed).map(|s|s.channel_id).map_err(|_|CommandError{
  code:ReviewErrorCode::ChannelMismatch,
  message:"Saved channel profile not found or invalid.".into()
 })
}
async fn background<T:Send+'static>(f:impl FnOnce()->Result<T,ReviewError>+Send+'static)->Cmd<T>{
 tauri::async_runtime::spawn_blocking(f).await.map_err(|_|CommandError{
  code:ReviewErrorCode::StorageFailure,message:"Offline review operation stopped.".into()
 })?.map_err(Into::into)
}
#[tauri::command]
pub async fn review_start(app:AppHandle,state:State<'_,ReviewService>,
 studio:State<'_,StudioService>,execution:State<'_,ExecutionService>,
 seed:LegacyChannelSeed,input:StartReview)->Cmd<ReviewState>{
 let channel=owner(&app,&seed)?;
 if channel!=input.channel_id{return Err(CommandError{
  code:ReviewErrorCode::ChannelMismatch,message:"Review requested for another channel.".into()
 })}
 let reviews=state.store()?;
 let executions=execution.store().map_err(|_|CommandError{code:ReviewErrorCode::StorageFailure,
  message:"Immutable execution store unavailable.".into()})?;
 let plans=studio.store().map_err(|_|CommandError{code:ReviewErrorCode::StorageFailure,
  message:"Immutable plan store unavailable.".into()})?;
 background(move||{
  let execution=executions.get(&channel,&input.execution_id).map_err(|_|ReviewError{
   code:ReviewErrorCode::NotFound,message:"Source execution not found or invalid."})?;
  let plan=plans.get_plan(&channel,&execution.plan_id).map_err(|_|ReviewError{
   code:ReviewErrorCode::NotFound,message:"Immutable source plan not found or invalid."})?;
  let kind=if input.part_index.is_some(){"part"}else{"assembled"};
  let script=executions.read(&channel,&input.execution_id,kind,input.part_index.unwrap_or(0),0)
   .map_err(|_|ReviewError{code:ReviewErrorCode::CorruptRecord,
    message:"Source script missing or integrity verification failed."})?;
  reviews.start(&plan,&execution,&script,&input)
 }).await
}
#[tauri::command]
pub async fn review_get(app:AppHandle,state:State<'_,ReviewService>,
 seed:LegacyChannelSeed,review_id:String)->Cmd<ReviewState>{
 let channel=owner(&app,&seed)?;let store=state.store()?;
 background(move||store.get(&channel,&review_id)).await
}
#[tauri::command]
pub async fn review_list(app:AppHandle,state:State<'_,ReviewService>,
 seed:LegacyChannelSeed)->Cmd<ReviewList>{
 let channel=owner(&app,&seed)?;let store=state.store()?;
 background(move||store.list(&channel)).await
}
#[tauri::command]
pub async fn review_read(app:AppHandle,state:State<'_,ReviewService>,
 seed:LegacyChannelSeed,review_id:String,kind:String,index:u32)->Cmd<String>{
 let channel=owner(&app,&seed)?;let store=state.store()?;
 background(move||store.read(&channel,&review_id,&kind,index)).await
}
#[tauri::command]
pub async fn review_apply(app:AppHandle,state:State<'_,ReviewService>,
 seed:LegacyChannelSeed,request:ReviewRequest)->Cmd<ReviewState>{
 let channel=owner(&app,&seed)?;
 if request.channel_id!=channel{return Err(CommandError{
  code:ReviewErrorCode::ChannelMismatch,message:"Review operation channel mismatch.".into()
 })}
 let store=state.store()?;background(move||store.apply(&request)).await
}
