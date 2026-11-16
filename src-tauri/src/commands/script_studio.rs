//! Phase 03H: typed, offline-only Tauri boundary for channel-owned Studio data.
use std::sync::Arc;
use serde::{Deserialize,Serialize};
use tauri::{AppHandle,Manager,State};

use crate::commands::{chatgpt::ChatGptAccounts,script::ScriptAccounts};
use crate::script_studio::*;

pub struct StudioService {
    store:Option<Arc<ScriptStudioStore>>,
    unavailable:Option<StudioErrorCode>,
}
impl StudioService {
    pub fn initialize(app:&AppHandle)->Self{
        let result=app.path().app_data_dir()
            .map_err(|_|StudioErrorCode::StorageFailure)
            .and_then(|dir|ScriptStudioStore::new(dir.join("script-writer").join("studio"))
                .map_err(|e|e.code));
        match result{
            Ok(store)=>Self{store:Some(Arc::new(store)),unavailable:None},
            Err(code)=>Self{store:None,unavailable:Some(code)}
        }
    }
    fn store(&self)->Result<Arc<ScriptStudioStore>,StudioCommandError>{
        self.store.as_ref().cloned().ok_or(StudioCommandError{
            code:self.unavailable.unwrap_or(StudioErrorCode::StorageFailure),
            message:"Offline Script Studio is unavailable; existing production tools remain usable.".into()
        })
    }
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct StudioCommandError{pub code:StudioErrorCode,pub message:String}
impl From<StudioError> for StudioCommandError {
    fn from(e:StudioError)->Self{Self{code:e.code,message:e.message.into()}}
}
type ResultCmd<T>=Result<T,StudioCommandError>;
fn invalid()->StudioCommandError {
    StudioCommandError{code:StudioErrorCode::ChannelMismatch,
        message:"This channel is missing from the saved channel profiles.".into()}
}
/// The saved settings are authoritative for legacy profile identity/data.
/// Caller cannot invent a profile or import into a nonexistent channel.
fn actual_seed(app:&AppHandle,claimed:&LegacyChannelSeed)->ResultCmd<LegacyChannelSeed>{
    let settings=crate::settings::load(app).map_err(|_|StudioCommandError{
        code:StudioErrorCode::StorageFailure,
        message:"Could not read saved channel profiles.".into()})?;
    let profile=settings.channel_profiles.iter().find(|v|
        v.get("id").and_then(serde_json::Value::as_str)==Some(claimed.channel_id.as_str()))
        .ok_or_else(invalid)?;
    let o=profile.get("script");
    let seed=LegacyChannelSeed{
        channel_id:claimed.channel_id.clone(),
        channel_name:profile.get("name").and_then(serde_json::Value::as_str)
            .unwrap_or("My channel").into(),
        language:profile.get("language").and_then(serde_json::Value::as_str)
            .unwrap_or("").into(),
        master_prompt:o.and_then(|v|v.get("masterPrompt"))
            .and_then(serde_json::Value::as_str).unwrap_or("").into(),
        claude_account_id:o.and_then(|v|v.get("claudeAccountId"))
            .and_then(serde_json::Value::as_str).map(str::to_owned),
    };
    seed.validate().map_err(|_|invalid())?;Ok(seed)
}
async fn blocking<T:Send+'static>(f:impl FnOnce()->Result<T,StudioError>+Send+'static)->ResultCmd<T>{
    tauri::async_runtime::spawn_blocking(f).await
        .map_err(|_|StudioCommandError{
            code:StudioErrorCode::StorageFailure,message:"Offline Studio operation stopped.".into()
        })?.map_err(Into::into)
}
fn account_ids(claude:State<'_,Arc<ScriptAccounts>>,
    chatgpt:State<'_,Arc<ChatGptAccounts>>)->(Vec<String>,Vec<String>){
    (claude.list().into_iter().map(|v|v.id).collect(),
        chatgpt.list().into_iter().map(|v|v.id).collect())
}
#[tauri::command]
pub async fn studio_get(app:AppHandle,state:State<'_,StudioService>,
    seed:LegacyChannelSeed)->ResultCmd<ChannelStudioConfigV1>{
    let seed=actual_seed(&app,&seed)?;
    let store=state.store()?;
    blocking(move||store.get(&seed)).await
}
#[tauri::command]
pub async fn studio_save(app:AppHandle,state:State<'_,StudioService>,
    claude:State<'_,Arc<ScriptAccounts>>,chatgpt:State<'_,Arc<ChatGptAccounts>>,
    seed:LegacyChannelSeed,edit:StudioEdit)->ResultCmd<ChannelStudioConfigV1>{
    let seed=actual_seed(&app,&seed)?;
    let (c,g)=account_ids(claude,chatgpt);
    let store=state.store()?;
    blocking(move||store.save(&seed,&edit,&c,&g)).await
}
#[tauri::command]
pub async fn studio_history(app:AppHandle,state:State<'_,StudioService>,
    seed:LegacyChannelSeed)->ResultCmd<Vec<ChannelStudioConfigV1>>{
    let seed=actual_seed(&app,&seed)?;
    let store=state.store()?;
    blocking(move||store.history(&seed)).await
}
#[tauri::command]
pub async fn studio_preview_plan(app:AppHandle,state:State<'_,StudioService>,
    seed:LegacyChannelSeed,input:PlanInput)->ResultCmd<StudioPreview>{
    let seed=actual_seed(&app,&seed)?;
    let store=state.store()?;
    blocking(move||store.preview(&seed,&input)).await
}
#[tauri::command]
pub async fn studio_save_plan(app:AppHandle,state:State<'_,StudioService>,
    seed:LegacyChannelSeed,input:PlanInput)->ResultCmd<ScriptStudioPlanV1>{
    let seed=actual_seed(&app,&seed)?;
    let store=state.store()?;
    blocking(move||store.save_plan(&seed,&input)).await
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PlanLookup{pub channel_id:String,pub plan_id:String}
#[tauri::command]
pub async fn studio_get_plan(state:State<'_,StudioService>,input:PlanLookup)
    ->ResultCmd<ScriptStudioPlanV1>{
    let store=state.store()?;
    blocking(move||store.get_plan(&input.channel_id,&input.plan_id)).await
}
#[tauri::command]
pub async fn studio_list_plans(state:State<'_,StudioService>,channel_id:String)
    ->ResultCmd<StudioPlanList>{
    let store=state.store()?;
    blocking(move||store.list_plans(&channel_id)).await
}
#[tauri::command]
pub async fn studio_export(app:AppHandle,state:State<'_,StudioService>,
    seed:LegacyChannelSeed)->ResultCmd<StudioBackupV1>{
    let seed=actual_seed(&app,&seed)?;
    let store=state.store()?;
    blocking(move||store.export(&seed)).await
}
#[tauri::command]
pub async fn studio_import(app:AppHandle,state:State<'_,StudioService>,
    claude:State<'_,Arc<ScriptAccounts>>,chatgpt:State<'_,Arc<ChatGptAccounts>>,
    seed:LegacyChannelSeed,backup:StudioBackupV1,operation_id:String)
    ->ResultCmd<ChannelStudioConfigV1>{
    let seed=actual_seed(&app,&seed)?;
    let (c,g)=account_ids(claude,chatgpt);
    let store=state.store()?;
    blocking(move||store.import(&seed,&backup,&operation_id,&c,&g)).await
}
