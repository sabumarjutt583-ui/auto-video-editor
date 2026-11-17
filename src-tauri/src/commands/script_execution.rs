//! Phase 03I typed, offline Tauri boundary. Existing saved channel profiles are authoritative.
use std::sync::Arc;
use serde::Serialize;
use tauri::{AppHandle,Manager,State};
use crate::commands::script_studio::{actual_seed,StudioService};
use crate::script_studio::LegacyChannelSeed;
use crate::script_execution::*;

pub struct ExecutionService{
    store:Option<Arc<ExecutionStore>>,
    unavailable:Option<ExecutionErrorCode>,
}
impl ExecutionService{
    pub fn initialize(app:&AppHandle)->Self{
        let initialized=app.path().app_data_dir()
            .map_err(|_|ExecutionErrorCode::StorageFailure)
            .and_then(|dir|ExecutionStore::new(dir.join("script-writer").join("executions"))
                .map_err(|e|e.code));
        match initialized{
            Ok(store)=>Self{store:Some(Arc::new(store)),unavailable:None},
            Err(code)=>Self{store:None,unavailable:Some(code)}
        }
    }
    fn store(&self)->Result<Arc<ExecutionStore>,CommandError>{
        self.store.as_ref().cloned().ok_or(CommandError{
            code:self.unavailable.unwrap_or(ExecutionErrorCode::StorageFailure),
            message:"Offline Script Execution is unavailable. Production tools are unaffected.".into()
        })
    }
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct CommandError{pub code:ExecutionErrorCode,pub message:String}
impl From<ExecutionError> for CommandError{
    fn from(value:ExecutionError)->Self{Self{code:value.code,message:value.message.into()}}
}
type Cmd<T>=Result<T,CommandError>;
fn owner(app:&AppHandle,seed:&LegacyChannelSeed)->Cmd<LegacyChannelSeed>{
    actual_seed(app,seed).map_err(|_|CommandError{
        code:ExecutionErrorCode::ChannelMismatch,
        message:"Channel does not exist in the authoritative saved profiles.".into()
    })
}
fn mismatched()->CommandError {
    CommandError{code:ExecutionErrorCode::ChannelMismatch,message:"Execution does not belong to this channel.".into()}
}
async fn background<T:Send+'static>(f:impl FnOnce()->Result<T,ExecutionError>+Send+'static)->Cmd<T>{
    tauri::async_runtime::spawn_blocking(f).await.map_err(|_|CommandError{
        code:ExecutionErrorCode::StorageFailure,message:"Offline execution task stopped.".into()
    })?.map_err(Into::into)
}
#[tauri::command]
pub async fn execution_start(app:AppHandle,state:State<'_,ExecutionService>,
    studio:State<'_,StudioService>,seed:LegacyChannelSeed,input:StartExecution)->Cmd<ExecutionState>{
    let seed=owner(&app,&seed)?;
    if input.channel_id!=seed.channel_id{return Err(mismatched())}
    let source=studio.store().map_err(|_|CommandError{
        code:ExecutionErrorCode::StorageFailure,message:"Plan store unavailable.".into()
    })?;
    let execution=state.store()?;
    background(move||{
        let plan=source.get_plan(&seed.channel_id,&input.plan_id)
            .map_err(|_|ExecutionError{code:ExecutionErrorCode::NotFound,message:"Valid immutable saved plan not found."})?;
        execution.start(&plan,&input)
    }).await
}
#[tauri::command]
pub async fn execution_get(app:AppHandle,state:State<'_,ExecutionService>,
    seed:LegacyChannelSeed,execution_id:String)->Cmd<ExecutionState>{
    let seed=owner(&app,&seed)?;
    let store=state.store()?;
    background(move||store.get(&seed.channel_id,&execution_id)).await
}
#[tauri::command]
pub async fn execution_list(app:AppHandle,state:State<'_,ExecutionService>,
    seed:LegacyChannelSeed)->Cmd<ExecutionList>{
    let seed=owner(&app,&seed)?;
    let store=state.store()?;
    background(move||store.list(&seed.channel_id)).await
}
#[tauri::command]
pub async fn execution_apply(app:AppHandle,state:State<'_,ExecutionService>,
    studio:State<'_,StudioService>,seed:LegacyChannelSeed,request:ExecutionRequest)->Cmd<ExecutionState>{
    let seed=owner(&app,&seed)?;
    if request.channel_id!=seed.channel_id{return Err(mismatched())}
    let execution=state.store()?;
    let source=studio.store().map_err(|_|CommandError{
        code:ExecutionErrorCode::StorageFailure,message:"Plan store unavailable.".into()
    })?;
    background(move||{
        let current=execution.get(&seed.channel_id,&request.execution_id)?;
        let plan=source.get_plan(&seed.channel_id,&current.plan_id)
            .map_err(|_|ExecutionError{code:ExecutionErrorCode::NotFound,message:"The saved source plan is missing or invalid."})?;
        execution.apply(&plan,&request)
    }).await
}
#[tauri::command]
pub async fn execution_read(app:AppHandle,state:State<'_,ExecutionService>,
    seed:LegacyChannelSeed,execution_id:String,kind:String,part_index:u32,fragment_index:u32)->Cmd<String>{
    let seed=owner(&app,&seed)?;
    let store=state.store()?;
    background(move||store.read(&seed.channel_id,&execution_id,&kind,part_index,fragment_index)).await
}
#[tauri::command]
pub async fn execution_candidate(app:AppHandle,state:State<'_,ExecutionService>,
    seed:LegacyChannelSeed,execution_id:String,part_index:u32)->Cmd<String>{
    let seed=owner(&app,&seed)?;
    let store=state.store()?;
    background(move||store.candidate(&seed.channel_id,&execution_id,part_index)).await
}

#[tauri::command]
pub async fn execution_validate_candidate(app:AppHandle,state:State<'_,ExecutionService>,
    seed:LegacyChannelSeed,execution_id:String,part_index:u32)->Cmd<CandidateValidation>{
    let seed=owner(&app,&seed)?;
    let store=state.store()?;
    background(move||store.validate_candidate(&seed.channel_id,&execution_id,part_index)).await
}
