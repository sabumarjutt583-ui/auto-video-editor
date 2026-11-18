//! Phase 03L development-only visible Chrome operator workspace.
//! Reuses the existing account profile directories and PlainWindow launcher.
//! No browser DOM/CDP access, cookies, messages, credentials, automation or API calls.
use std::{collections::HashMap,path::PathBuf,sync::Arc};
use serde::{Deserialize,Serialize};
use tauri::{AppHandle,State};
use crate::{
 commands::{chatgpt::ChatGptAccounts,script::ScriptAccounts,
  script_studio::{actual_seed},script_supervisor::SupervisorService},
 imagegen::{browser::{locator,signin::{PlainWindow,WindowState}},ops::ImageGen},
 script_studio::LegacyChannelSeed,script_supervisor::{TaskState,Transport,Stage},
};

#[derive(Clone,Copy,Debug,PartialEq,Eq,Hash,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
pub enum Provider{Claude,Chatgpt}
impl Provider{
 fn label(self)->&'static str{match self{Self::Claude=>"claude",Self::Chatgpt=>"chatgpt"}}
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct ChromeError{pub message:String}
type Cmd<T>=Result<T,ChromeError>;
fn error(s:impl Into<String>)->ChromeError{ChromeError{message:s.into()}}
fn development()->Cmd<()>{
 if cfg!(debug_assertions){Ok(())}
 else{Err(error("Visible Chrome Studio is development-only and unavailable in production."))}
}
fn assigned(task:&TaskState,provider:Provider,id:&str)->bool{
 !id.is_empty()&&task.snapshot.transport==Transport::VisibleBrowser&&
 ((provider==Provider::Claude&&task.snapshot.writer_account_id.as_deref()==Some(id))||
 (task.snapshot.reviewer_provider==provider.label()
  &&task.snapshot.reviewer_account_id.as_deref()==Some(id)))
}
fn validate_site(provider:Provider,url:&str)->Cmd<()>{
 let trusted=match provider{
  Provider::Claude=>["https://claude.ai/","https://claude.ai"].as_slice(),
  Provider::Chatgpt=>["https://chatgpt.com/","https://chatgpt.com","https://chat.openai.com/","https://chat.openai.com"].as_slice(),
 };
 if trusted.iter().any(|base|url==*base || (base.ends_with('/')&&url.starts_with(base))){
  Ok(())
 }else{Err(error("The configured provider page is not a supported HTTPS Claude/ChatGPT origin."))}
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct WindowReport{
 pub provider:Provider,pub account_id:String,pub display_name:String,
 /// Logical profile identity, not a filesystem path or browser credential.
 pub profile_identity:String,pub saved_account_present:bool,
 pub last_reported_connected:bool,pub signing_in:bool,
 pub reported_account_error:String,pub process_state:String,
 pub last_launch_error:String,pub authentication_verified:bool,
 pub can_focus:bool,pub can_close_safely:bool,
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct WorkspaceReport{
 pub browser_available:bool,pub browser_name:String,
 pub browser_diagnostic:String,pub accounts:Vec<WindowReport>,
 pub warning:&'static str,
}
#[derive(Default)]
pub struct ChromeWorkspace{
 /// One tracked process per provider/profile in this desktop run. No destructive close command.
 windows:tokio::sync::Mutex<HashMap<(Provider,String),ManagedWindow>>,
}
enum ManagedWindow{Running(PlainWindow),Failed(String),Ended(String)}
impl ChromeWorkspace{
 async fn reported(&self,provider:Provider,id:&str)->(String,String){
  let mut windows=self.windows.lock().await;
  let key=(provider,id.to_owned());
  match windows.get_mut(&key){
   None=>("not_observed_after_app_restart".into(),String::new()),
   Some(ManagedWindow::Running(window))=>match window.state(){
    WindowState::Open=>("process_running_window_not_verified".into(),String::new()),
    WindowState::EndedAtOnce=>{
     let detail="Browser process ended immediately; this profile may already be open elsewhere. Inspect it manually, and do not assume the window was launched.".to_string();
     windows.insert(key,ManagedWindow::Ended(detail.clone()));
     ("ended_at_once".into(),detail)
    },
    WindowState::Closed=>{
     windows.insert(key,ManagedWindow::Ended(String::new()));
     ("process_closed".into(),String::new())
    },
   },
   Some(ManagedWindow::Failed(e))=>("launch_failed".into(),e.clone()),
   Some(ManagedWindow::Ended(e))=>("process_closed_or_handed_off".into(),e.clone()),
  }
 }
 async fn open(&self,provider:Provider,id:&str,exe:&PathBuf,profile:&PathBuf,url:&str)->Cmd<(String,String)>{
  let key=(provider,id.to_owned());
  let mut windows=self.windows.lock().await;
  if let Some(ManagedWindow::Running(window))=windows.get_mut(&key){
   if window.state()==WindowState::Open{
    return Ok(("already_running".into(),"Existing tracked process; focus control is unsupported. Switch to the browser manually.".into()));
   }
  }
  // Do not remove, overwrite or migrate browser profiles; PlainWindow only creates missing dirs.
  match PlainWindow::open(exe,profile,url).await{
   Ok(mut window)=>{
    let outcome=match window.state(){
     WindowState::Open=>"process_running_window_not_verified",
     WindowState::Closed=>"process_closed",
     WindowState::EndedAtOnce=>"ended_at_once_profile_may_be_in_use",
    }.to_string();
    windows.insert(key,ManagedWindow::Running(window));
    Ok((outcome,"Browser process observed, not proof of a rendered window, sign-in or AI response.".into()))
   },
   Err(e)=>{
    windows.insert(key,ManagedWindow::Failed(e.clone()));
    Err(error(format!("Browser launch failed without altering saved account profiles: {e}")))
   }
  }
 }
}
async fn task_for(app:&AppHandle,seed:&LegacyChannelSeed,id:&str,service:&SupervisorService)->Cmd<TaskState>{
 development()?;
 let owner=actual_seed(app,seed).map_err(|_|error("Saved channel identity could not be verified."))?.channel_id;
 let store=service.store().map_err(|_|error("Supervisor state unavailable."))?;
 let task_id=id.to_owned();
 let task=tauri::async_runtime::spawn_blocking(move||store.get(&owner,&task_id))
  .await.map_err(|_|error("Supervisor lookup failed."))?
  .map_err(|_|error("Task missing, invalid or belongs to a different channel."))?;
 if task.snapshot.transport!=Transport::VisibleBrowser{return Err(error("Only visible-browser tasks can open a browser."))}
 Ok(task)
}
fn browser(ig:&ImageGen)->Cmd<(PathBuf,String,String)>{
 let chosen=ig.engine.settings().browser_path;
 let exe=locator::find(Some(&chosen))
  .ok_or_else(||error("Chrome/Chromium unavailable. Install Chrome or choose a supported browser in Settings."))?;
 let name=exe.file_name().and_then(|s|s.to_str()).unwrap_or("Chromium-based browser").to_string();
 Ok((exe,name,if chosen.trim().is_empty(){"automatic discovery"}else{"settings preference with supported fallback"}.into()))
}
#[tauri::command]
pub async fn chrome_workspace_status(app:AppHandle,seed:LegacyChannelSeed,task_id:String,
 service:State<'_,SupervisorService>,chrome:State<'_,ChromeWorkspace>,
 claude:State<'_,Arc<ScriptAccounts>>,chatgpt:State<'_,Arc<ChatGptAccounts>>,
 ig:State<'_,Arc<ImageGen>>)->Cmd<WorkspaceReport>{
 let task=task_for(&app,&seed,&task_id,&service).await?;
 let available=browser(&ig);
 let pairs=[(Provider::Claude,task.snapshot.writer_account_id.as_deref()),
  (if task.snapshot.reviewer_provider=="claude"{Provider::Claude}else{Provider::Chatgpt},
   task.snapshot.reviewer_account_id.as_deref())];
 let mut accounts=Vec::new();
 for (provider,maybe_id) in pairs{
  let Some(id)=maybe_id else{continue};
  if !assigned(&task,provider,id){continue}
  if accounts.iter().any(|a:&WindowReport|a.provider==provider&&a.account_id==id){continue}
  let (name,present,connected,signing_in,last)=match provider{
   Provider::Claude=>{
    match claude.account_status(id){Ok(a)=>(a.name,true,a.connected,a.signing_in,a.last_error),
     Err(_)=>("(missing Claude account)".into(),false,false,false,String::new())}
   },
   Provider::Chatgpt=>{
    match chatgpt.account_status(id){Ok(a)=>(a.name,true,a.connected,a.signing_in,a.last_error),
     Err(_)=>("(missing ChatGPT account)".into(),false,false,false,String::new())}
   },
  };
  let (process_state,last_launch_error)=chrome.reported(provider,id).await;
  accounts.push(WindowReport{provider,account_id:id.into(),display_name:name,
   profile_identity:format!("{}:{}",provider.label(),id),saved_account_present:present,
   last_reported_connected:connected,signing_in,
   reported_account_error:last,process_state,last_launch_error,
   authentication_verified:false,can_focus:false,can_close_safely:false});
 }
 let (browser_available,browser_name,browser_diagnostic)=match available{
  Ok((_,n,source))=>(true,n,source),
  Err(e)=>(false,String::new(),e.message),
 };
 Ok(WorkspaceReport{browser_available,browser_name,browser_diagnostic,accounts,
  warning:"A browser process is not a verified window or login. Manual site interaction, window closing, and any security check remain the user's responsibility."})
}
#[tauri::command]
pub async fn chrome_workspace_open(app:AppHandle,seed:LegacyChannelSeed,task_id:String,
 provider:Provider,account_id:String,service:State<'_,SupervisorService>,
 chrome:State<'_,ChromeWorkspace>,claude:State<'_,Arc<ScriptAccounts>>,
 chatgpt:State<'_,Arc<ChatGptAccounts>>,ig:State<'_,Arc<ImageGen>>)->Cmd<WorkspaceReport>{
 let task=task_for(&app,&seed,&task_id,&service).await?;
 if matches!(task.stage,Stage::Paused|Stage::Cancelled|Stage::Completed){
  return Err(error("This task is paused or terminal; resume or create a new task before launching."))
 }
 if !assigned(&task,provider,&account_id){
  return Err(error("Wrong provider/account for this channel's immutable task snapshot. No browser opened."))
 }
 let profile=match provider{
  Provider::Claude=>claude.profile_dir_for(&account_id).map_err(|_|error("Selected Claude account missing."))?,
  Provider::Chatgpt=>chatgpt.profile_dir_for(&account_id).map_err(|_|error("Selected ChatGPT account missing."))?,
 };
 let (exe,_,_)=browser(&ig)?;
 let config=ig.engine.config();
 let url=match provider{
  Provider::Claude=>config.script.url.as_str(),
  Provider::Chatgpt=>config.chatgpt.url.as_str(),
 };
 validate_site(provider,&url)?;
 chrome.open(provider,&account_id,&exe,&profile,&url).await?;
 chrome_workspace_status(app,seed,task_id,service,chrome,claude,chatgpt,ig).await
}
#[cfg(test)]
mod tests{
 use super::*;
 #[test]fn chrome_workspace_provider_allowlist(){
  assert!(validate_site(Provider::Claude,"https://claude.ai/new").is_ok());
  assert!(validate_site(Provider::Chatgpt,"https://chatgpt.com/").is_ok());
  assert!(validate_site(Provider::Claude,"https://claude.ai.evil.test/").is_err());
  assert!(validate_site(Provider::Chatgpt,"http://chatgpt.com/").is_err());
  assert!(validate_site(Provider::Chatgpt,"https://example.org/").is_err());
 }
 #[test]fn profile_identity_uses_provider_namespaces(){
  assert_ne!(format!("{}:1",Provider::Claude.label()),format!("{}:1",Provider::Chatgpt.label()));
 }
 #[tokio::test]async fn chrome_workspace_does_not_claim_process_after_restart(){
  let workspace=ChromeWorkspace::default();
  let (s,_)=workspace.reported(Provider::Claude,"1").await;
  assert_eq!(s,"not_observed_after_app_restart");
 }
}
