//! Phase 03L development-only visible Chrome operator workspace.
//! Reuses the existing account profile directories and PlainWindow launcher.
//! No browser DOM/CDP access, cookies, messages, credentials, automation or API calls.
use std::{collections::HashMap,path::{Path,PathBuf},sync::Arc};
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
/// Account checks are performed against the immutable Rust-owned task, not UI selection.
fn account_matches(writer:Option<&str>,reviewer:Option<&str>,reviewer_provider:&str,
 provider:Provider,id:&str)->bool{
 !id.is_empty()&&((provider==Provider::Claude&&writer==Some(id))||
 (reviewer_provider==provider.label()&&reviewer==Some(id)))
}
fn assigned(task:&TaskState,provider:Provider,id:&str)->bool{
 task.snapshot.transport==Transport::VisibleBrowser&&
 account_matches(task.snapshot.writer_account_id.as_deref(),
 task.snapshot.reviewer_account_id.as_deref(),&task.snapshot.reviewer_provider,provider,id)
}
fn task_can_open(stage:&Stage)->bool{
 !matches!(stage,Stage::Paused|Stage::Cancelled|Stage::Completed|Stage::Failed)
}
/// Existing account manager owns this path. Refuse symlink/file redirection; never clean it.
fn validate_profile(profile:&Path)->Cmd<()>{
 if !profile.is_absolute()||profile.file_name().and_then(|x|x.to_str())!=Some("profile"){
  return Err(error("Browser profile identity/path is invalid; no window launched."))
 }
 // Only inspect account-owned and adjacent directory components, without rejecting
 // unrelated OS-level symlinks (e.g. macOS /var). No path is created or modified.
 for segment in profile.ancestors().take(4){
  match std::fs::symlink_metadata(segment){
   Ok(m) if m.file_type().is_symlink()||!m.is_dir()=>
    return Err(error("Account profile directory is a symlink or non-directory; open blocked to preserve isolation.")),
   Ok(_)=>{},
   Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},
   Err(_)=>return Err(error("Cannot inspect account profile safely; no window launched.")),
  }
 }
 Ok(())
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
enum ManagedWindow{Running(PlainWindow),Failed(String),Ended(&'static str,String)}
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
     windows.insert(key,ManagedWindow::Ended("ended_at_once",detail.clone()));
     ("ended_at_once".into(),detail)
    },
    WindowState::Closed=>{
     windows.insert(key,ManagedWindow::Ended("process_closed",String::new()));
     ("process_closed".into(),String::new())
    },
   },
   Some(ManagedWindow::Failed(e))=>("launch_failed".into(),e.clone()),
   Some(ManagedWindow::Ended(state,e))=>(state.to_string(),e.clone()),
  }
 }
 async fn open(&self,provider:Provider,id:&str,exe:&PathBuf,profile:&PathBuf,url:&str)->Cmd<(String,String)>{
  validate_profile(profile)?;
  if !exe.is_file(){return Err(error("Configured Chromium executable is missing or not a regular file; profile untouched."))}
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
    // Give the spawned child a scheduling opportunity to report a quick exit.
    // This is NOT a readiness timer and does not claim a rendered window.
    tokio::task::yield_now().await;
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
 let source=if chosen.trim().is_empty(){"automatic Chrome-first discovery"}
  else if Path::new(chosen.trim())==exe.as_path(){"browser explicitly selected in Settings"}
  else{"configured browser path missing; supported Chromium fallback selected"};
 Ok((exe,name,source.into()))
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
 if !task_can_open(&task.stage){
  return Err(error("Task is paused, cancelled, failed or completed; no browser process launched."))
 }
 if !assigned(&task,provider,&account_id){
  return Err(error("Wrong provider/account for this channel's immutable task snapshot. No browser opened."))
 }
 let profile=match provider{
  Provider::Claude=>claude.profile_dir_for(&account_id).map_err(|_|error("Selected Claude account missing."))?,
  Provider::Chatgpt=>chatgpt.profile_dir_for(&account_id).map_err(|_|error("Selected ChatGPT account missing."))?,
 };
 validate_profile(&profile)?;
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
 #[test]fn chrome_workspace_strict_writer_reviewer_separation(){
  assert!(account_matches(Some("1"),Some("2"),"chatgpt",Provider::Claude,"1"));
  assert!(account_matches(Some("1"),Some("2"),"chatgpt",Provider::Chatgpt,"2"));
  assert!(!account_matches(Some("1"),Some("2"),"chatgpt",Provider::Claude,"2"));
  assert!(!account_matches(Some("1"),Some("2"),"chatgpt",Provider::Chatgpt,"1"));
  assert!(!account_matches(Some("1"),Some("2"),"none",Provider::Chatgpt,"2"));
  assert!(!account_matches(Some("1"),Some("2"),"chatgpt",Provider::Claude,""));
  // The same account can be selected in independent channels; tasks own script data.
  assert!(account_matches(Some("1"),Some("2"),"chatgpt",Provider::Claude,"1"));
 }
 #[test]fn chrome_workspace_blocks_terminal_tasks(){
  assert!(task_can_open(&Stage::Created));
  assert!(task_can_open(&Stage::BrowserOpening));
  for stage in [Stage::Paused,Stage::Cancelled,Stage::Completed,Stage::Failed]{
   assert!(!task_can_open(&stage));
  }
 }
 #[test]fn chrome_workspace_profile_preflight_blocks_invalid_path(){
  let dir=std::env::temp_dir().join("ave-chrome-profile-preflight");
  assert!(validate_profile(&dir.join("accounts")).is_err());
  assert!(validate_profile(Path::new("relative/profile")).is_err());
  let _=std::fs::remove_dir_all(&dir);
  std::fs::create_dir_all(&dir).unwrap();
  std::fs::write(dir.join("profile"),"not a directory").unwrap();
  assert!(validate_profile(&dir.join("profile")).is_err());
  assert_eq!(std::fs::read_to_string(dir.join("profile")).unwrap(),"not a directory");
  let _=std::fs::remove_dir_all(&dir);
 }
 #[cfg(unix)]
 #[test]fn chrome_workspace_profile_preflight_rejects_symlink(){
  let dir=std::env::temp_dir().join("ave-chrome-symlink-preflight");
  let _=std::fs::remove_dir_all(&dir);std::fs::create_dir_all(dir.join("original")).unwrap();
  std::os::unix::fs::symlink(dir.join("original"),dir.join("profile")).unwrap();
  assert!(validate_profile(&dir.join("profile")).is_err());
  assert!(dir.join("original").is_dir());
  let _=std::fs::remove_dir_all(&dir);
 }
 #[tokio::test]async fn chrome_workspace_launch_failure_keeps_profile_intact(){
  let dir=std::env::temp_dir().join("ave-chrome-spawn-failure-profile");
  let _=std::fs::remove_dir_all(&dir);std::fs::create_dir_all(dir.join("profile")).unwrap();
  std::fs::write(dir.join("profile").join("keep"),b"saved account").unwrap();
  let workspace=ChromeWorkspace::default();
  let result=workspace.open(Provider::Claude,"1",
   &dir.join("browser-not-installed"),&dir.join("profile"),"https://claude.ai/new").await;
  assert!(result.is_err());
  assert_eq!(std::fs::read(dir.join("profile").join("keep")).unwrap(),b"saved account");
  let _=std::fs::remove_dir_all(&dir);
 }
 #[test]fn chrome_workspace_keeps_exit_reason_on_refresh(){
  let ws=ChromeWorkspace::default();
  assert!(ws.windows.try_lock().is_ok());
  let mut guard=ws.windows.try_lock().unwrap();
  guard.insert((Provider::Claude,"1".into()),ManagedWindow::Ended("ended_at_once","profile already in use".into()));
  drop(guard);
  let rt=tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
  let first=rt.block_on(ws.reported(Provider::Claude,"1"));
  let second=rt.block_on(ws.reported(Provider::Claude,"1"));
  assert_eq!(first,second);
  assert_eq!(first.0,"ended_at_once");
 }
}
