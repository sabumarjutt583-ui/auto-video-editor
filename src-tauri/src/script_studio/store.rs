//! Append-only, single-writer local Studio configuration and immutable plan store.
use std::{fs::{self,File,OpenOptions},io::{Read,Write},path::{Path,PathBuf},sync::Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use rand::RngCore;
use serde::{Serialize,Deserialize};

use crate::script_jobs::lock;
use crate::script_jobs::model::{digest,valid_id};
use super::model::*;
use super::planning::{build_plan,validate_stored_plan};

const MAX_CONFIG_BYTES:u64=1_048_576;
const MAX_PLAN_BYTES:u64=1_048_576;
#[derive(Clone,Copy,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
pub enum StudioErrorCode {
    InvalidInput,InvalidAccount,ChannelMismatch,NotFound,Conflict,StaleRevision,
    HistoryFull,WriterBusy,StorageFailure,CorruptRecord,UnsupportedVersion,RecoveryBlocked,
}
#[derive(Debug)]
pub struct StudioError {pub code:StudioErrorCode,pub message:&'static str}
impl std::fmt::Display for StudioError {
    fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result{f.write_str(self.message)}
}
impl std::error::Error for StudioError {}
fn err(code:StudioErrorCode,message:&'static str)->StudioError {StudioError{code,message}}
fn storage()->StudioError {err(StudioErrorCode::StorageFailure,"Local Studio storage failed. Existing files were not deleted.")}
fn corrupt()->StudioError {err(StudioErrorCode::CorruptRecord,"Studio record is corrupt or inconsistent; preserved for inspection.")}
fn invalid()->StudioError {err(StudioErrorCode::InvalidInput,"Studio input is invalid; no files were changed.")}
fn random_id()->String {
    let mut bytes=[0u8;16];rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b|format!("{b:02x}")).collect()
}
fn timestamp()->String {
    let ms=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    let secs=ms/1000;
    format!("{}T{:02}:{:02}:{:02}.{:03}Z",
        crate::clock::civil_date((secs/86400) as i64),
        secs%86400/3600,secs%86400%3600/60,secs%60,ms%1000)
}
fn check_dir(path:&Path,create:bool)->Result<bool,StudioError>{
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() && !m.file_type().is_symlink()=>Ok(true),
        Ok(_)=>Err(err(StudioErrorCode::RecoveryBlocked,"Unsafe or symlinked Studio directory; unchanged.")),
        Err(e) if e.kind()==std::io::ErrorKind::NotFound && create=>{
            fs::create_dir(path).map_err(|_|storage())?;Ok(true)
        }
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(false),
        Err(_)=>Err(storage())
    }
}
fn checked_file(path:&Path,max:u64)->Result<Vec<u8>,StudioError>{
    let m=fs::symlink_metadata(path).map_err(|_|storage())?;
    if !m.is_file() || m.file_type().is_symlink() || m.len()>max{return Err(corrupt())}
    let mut bytes=Vec::new();
    File::open(path).map_err(|_|storage())?.take(max+1).read_to_end(&mut bytes).map_err(|_|storage())?;
    if bytes.len() as u64>max{return Err(corrupt())}Ok(bytes)
}
fn persist_new(path:&Path,content:&[u8])->Result<(),StudioError>{
    if content.len()>MAX_CONFIG_BYTES as usize {return Err(invalid())}
    let parent=path.parent().ok_or_else(storage)?;
    check_dir(parent,false)?;
    if path.exists()||fs::symlink_metadata(path).is_ok(){
        return Err(err(StudioErrorCode::Conflict,"Committed Studio file already exists."));
    }
    let temp=parent.join(format!(".studio-{}.tmp",random_id()));
    let mut file=OpenOptions::new().create_new(true).write(true).open(&temp).map_err(|_|storage())?;
    let result=(||{
        file.write_all(content).map_err(|_|storage())?;
        file.flush().map_err(|_|storage())?;
        file.sync_all().map_err(|_|storage())?;
        // With a store-wide OS lease, never publish over an existing file,
        // including on Windows where replacing an open target differs.
        if fs::symlink_metadata(path).is_ok(){return Err(storage())}
        fs::rename(&temp,path).map_err(|_|storage())?;
        #[cfg(unix)]
        File::open(parent).and_then(|d|d.sync_all()).map_err(|_|storage())?;
        Ok(())
    })();
    if result.is_err(){let _=fs::remove_file(&temp);}
    result
}
fn version_path(folder:&Path,version:u64)->PathBuf {
    folder.join(format!("config-{version:06}.json"))
}
fn load_config_file(path:&Path,channel_id:&str)->Result<ChannelStudioConfigV1,StudioError>{
    let data=checked_file(path,MAX_CONFIG_BYTES)?;
    let value:serde_json::Value=serde_json::from_slice(&data).map_err(|_|corrupt())?;
    match value.get("schemaVersion").and_then(|v|v.as_u64()){
        Some(v) if v>SCHEMA_VERSION as u64 =>
            return Err(err(StudioErrorCode::UnsupportedVersion,"Newer Studio schema is preserved and unsupported.")),
        Some(v) if v==SCHEMA_VERSION as u64=>{}
        _=>return Err(corrupt())
    }
    let config:ChannelStudioConfigV1=serde_json::from_value(value).map_err(|_|corrupt())?;
    config.validate().map_err(|_|corrupt())?;
    if config.channel_id!=channel_id{return Err(corrupt())}
    Ok(config)
}
fn hash_config(config:&ChannelStudioConfigV1)->Result<String,StudioError>{
    Ok(digest(&serde_json::to_vec(config).map_err(|_|storage())?))
}
fn validate_history(old:&ChannelStudioConfigV1,next:&ChannelStudioConfigV1)->Result<(),StudioError>{
    if next.revision!=old.revision+1 || next.created_at!=old.created_at
        || !next.prompt_versions.starts_with(&old.prompt_versions)
        || !next.review_versions.starts_with(&old.review_versions)
        || next.previous_digest.as_deref()!=Some(hash_config(old)?.as_str()) {
        return Err(corrupt());
    }
    Ok(())
}
fn load_chain(folder:&Path,channel:&str)->Result<Option<ChannelStudioConfigV1>,StudioError>{
    if !check_dir(folder,false)?{return Ok(None)}
    let mut records=Vec::<u64>::new();
    for entry in fs::read_dir(folder).map_err(|_|storage())? {
        let entry=entry.map_err(|_|storage())?;
        let name=entry.file_name().into_string().map_err(|_|corrupt())?;
        if name=="plans" {check_dir(&entry.path(),false)?;continue;}
        if name.starts_with(".studio-") && name.ends_with(".tmp"){
            return Err(err(StudioErrorCode::RecoveryBlocked,"An incomplete Studio write is preserved; inspect before further edits."));
        }
        if !(name.starts_with("config-") && name.ends_with(".json")
            && name.len()==18){return Err(err(StudioErrorCode::RecoveryBlocked,
                "Unexpected Studio file; no automatic repair was performed."));}
        let rev=name[7..13].parse::<u64>().map_err(|_|corrupt())?;
        if rev==0 || rev>MAX_CONFIG_REVISIONS{return Err(corrupt());}
        let meta=fs::symlink_metadata(entry.path()).map_err(|_|storage())?;
        if !meta.is_file()||meta.file_type().is_symlink(){return Err(corrupt());}
        records.push(rev);
    }
    if records.is_empty(){return Ok(None)}
    records.sort_unstable();records.dedup();
    let mut previous=None;
    for (i,rev) in records.into_iter().enumerate(){
        if rev !=(i+1) as u64 {return Err(err(StudioErrorCode::RecoveryBlocked,"Missing Studio configuration checkpoint."))}
        let record=load_config_file(&version_path(folder,rev),channel)?;
        if record.revision!=rev{return Err(corrupt())}
        if let Some(old)=&previous {validate_history(old,&record)?;}
        else if record.previous_digest.is_some() {return Err(corrupt())}
        previous=Some(record);
    }
    Ok(previous)
}
fn check_accounts(c:&ChannelStudioConfigV1,claude:&[String],chatgpt:&[String])->Result<(),StudioError>{
    let valid=|id:&String,ids:&[String]|ids.contains(id);
    if c.accounts.claude_account_id.as_ref().is_some_and(|v|!valid(v,claude))
        || c.accounts.chatgpt_review_account_id.as_ref().is_some_and(|v|!valid(v,chatgpt))
        || c.accounts.allowed_claude_account_ids.iter().any(|v|!valid(v,claude))
        || c.accounts.allowed_chatgpt_account_ids.iter().any(|v|!valid(v,chatgpt))
        || c.skills.iter().any(|skill|!valid(&skill.claude_account_id,claude)) {
        return Err(err(StudioErrorCode::InvalidAccount,"Selected account reference no longer exists; choose an existing account."));
    }
    Ok(())
}
fn choose_version(versions:&mut Vec<TextVersion>,channel:&str,new_content:Option<&str>,
    selected:Option<String>,options:Option<PlanningOverride>,kind:&str)
    ->Result<Option<String>,StudioError>{
    let mut current=selected;
    if let Some(content)=new_content {
        if !content.is_empty(){
            if !good_text(content,MAX_TEXT_BYTES,true){return Err(invalid())}
            if versions.len()>=MAX_VERSIONS{return Err(err(StudioErrorCode::HistoryFull,"Prompt history limit reached."))}
            let id=format!("{kind}_{}",random_id());
            let item=TextVersion{version_id:id.clone(),channel_id:channel.into(),content:content.into(),
                content_digest:digest(content.as_bytes()),created_at:timestamp(),
                planning_override:options};
            versions.push(item);current=Some(id);
        }
    }
    if current.as_ref().is_some_and(|id|!versions.iter().any(|v|&v.version_id==id)){
        return Err(err(StudioErrorCode::ChannelMismatch,"Selected prompt version does not belong to this channel."));
    }
    Ok(current)
}
pub struct ScriptStudioStore{
    root:PathBuf,lock_file:File,operation:Mutex<()>,
}
impl Drop for ScriptStudioStore {
    fn drop(&mut self){lock::unlock(&self.lock_file)}
}
impl ScriptStudioStore{
    pub fn new(root:PathBuf)->Result<Self,StudioError>{
        check_dir(&root,true)?;
        check_dir(&root.join("channels"),true)?;
        let path=root.join("writer.lock");
        if let Ok(meta)=fs::symlink_metadata(&path){
            if !meta.is_file()||meta.file_type().is_symlink(){return Err(storage())}
        }
        let file=OpenOptions::new().read(true).write(true).create(true).open(path).map_err(|_|storage())?;
        lock::try_lock(&file).map_err(|_|err(StudioErrorCode::WriterBusy,
            "Another Script Studio process owns this directory."))?;
        Ok(Self{root,lock_file:file,operation:Mutex::new(())})
    }
    fn folder(&self,channel:&str)->Result<PathBuf,StudioError>{
        if !valid_id(channel) {return Err(err(StudioErrorCode::ChannelMismatch,"Invalid channel ID."))}
        Ok(self.root.join("channels").join(channel))
    }
    pub fn get(&self,seed:&LegacyChannelSeed)->Result<ChannelStudioConfigV1,StudioError>{
        seed.validate().map_err(|_|invalid())?;
        let _guard=self.operation.lock().unwrap_or_else(|p|p.into_inner());
        let folder=self.folder(&seed.channel_id)?;
        load_chain(&folder,&seed.channel_id)?.map_or_else(
            ||{let value=ChannelStudioConfigV1::seed(seed.channel_id.clone(),seed.channel_name.clone(),
                    seed.language.clone(),seed.master_prompt.clone(),seed.claude_account_id.clone());
                value.validate().map_err(|_|invalid())?;Ok(value)},
            Ok)
    }
    pub fn save(&self,seed:&LegacyChannelSeed,edit:&StudioEdit,
        claude:&[String],chatgpt:&[String])->Result<ChannelStudioConfigV1,StudioError>{
        seed.validate().map_err(|_|invalid())?;
        if edit.channel_id!=seed.channel_id || !valid_id(&edit.operation_id)
            ||!good_text(&edit.channel_name,60,true){return Err(invalid());}
        let _guard=self.operation.lock().unwrap_or_else(|p|p.into_inner());
        let folder=self.folder(&seed.channel_id)?;
        let current=load_chain(&folder,&seed.channel_id)?.unwrap_or_else(||{
            ChannelStudioConfigV1::seed(seed.channel_id.clone(),seed.channel_name.clone(),
                seed.language.clone(),seed.master_prompt.clone(),seed.claude_account_id.clone())
        });
        current.validate().map_err(|_|corrupt())?;
        let op_digest=digest(&serde_json::to_vec(edit).map_err(|_|invalid())?);
        if current.revision>=edit.expected_revision {
            // Durable deduplication across the complete bounded history.
            for rev in 1..=current.revision {
                let old=load_config_file(&version_path(&folder,rev),&seed.channel_id)?;
                if old.operation_id.as_deref()==Some(edit.operation_id.as_str()){
                    if old.operation_digest.as_deref()==Some(op_digest.as_str())
                        && old.revision==edit.expected_revision+1{return Ok(old);}
                    return Err(err(StudioErrorCode::Conflict,"Operation ID reused with changed configuration."));
                }
            }
        }
        if current.revision!=edit.expected_revision {
            return Err(err(StudioErrorCode::StaleRevision,"Studio settings changed in another operation; reload before saving."));
        }
        if current.revision>=MAX_CONFIG_REVISIONS{
            return Err(err(StudioErrorCode::HistoryFull,"Studio configuration history full; no old version removed."));
        }
        let mut next=current.clone();
        next.revision=current.revision+1;next.updated_at=timestamp();
        if next.revision==1 {next.created_at=next.updated_at.clone();}
        next.previous_digest=if current.revision==0{None}else{Some(hash_config(&current)?)};
        next.operation_id=Some(edit.operation_id.clone());next.operation_digest=Some(op_digest);
        next.channel_name=edit.channel_name.clone();
        next.writing=edit.writing.clone();next.accounts=edit.accounts.clone();
        next.review=edit.review.clone();next.rubric=edit.rubric.clone();
        next.planning=edit.planning.clone();next.skills=edit.skills.clone();
        next.selected_prompt_version_id=choose_version(&mut next.prompt_versions,&next.channel_id,
            edit.new_master_prompt.as_deref(),edit.select_master_version_id.clone()
                .or_else(||current.selected_prompt_version_id.clone()),
            edit.new_master_planning.clone(),"mp")?;
        next.selected_review_version_id=choose_version(&mut next.review_versions,&next.channel_id,
            edit.new_review_prompt.as_deref(),edit.select_review_version_id.clone()
                .or_else(||current.selected_review_version_id.clone()),
            edit.new_review_planning.clone(),"rp")?;
        next.validate().map_err(|_|invalid())?;
        check_accounts(&next,claude,chatgpt)?;
        if current.revision>0{validate_history(&current,&next)?;}
        check_dir(&folder,true)?;
        let bytes=serde_json::to_vec_pretty(&next).map_err(|_|storage())?;
        persist_new(&version_path(&folder,next.revision),&bytes)?;
        Ok(next)
    }
    pub fn history(&self,seed:&LegacyChannelSeed)->Result<Vec<ChannelStudioConfigV1>,StudioError>{
        let _g=self.operation.lock().unwrap_or_else(|p|p.into_inner());
        let folder=self.folder(&seed.channel_id)?;
        let Some(latest)=load_chain(&folder,&seed.channel_id)? else{return Ok(Vec::new())};
        (1..=latest.revision).map(|n|load_config_file(&version_path(&folder,n),&seed.channel_id)).collect()
    }
    pub fn get_plan(&self,channel:&str,plan_id:&str)->Result<ScriptStudioPlanV1,StudioError>{
        let _g=self.operation.lock().unwrap_or_else(|p|p.into_inner());
        self.get_plan_locked(channel,plan_id)
    }
    fn get_plan_locked(&self,channel:&str,plan_id:&str)->Result<ScriptStudioPlanV1,StudioError>{
        if !valid_id(plan_id)||!plan_id.starts_with("sp_"){return Err(invalid())}
        let folder=self.folder(channel)?.join("plans");
        if !check_dir(&folder,false)?{return Err(err(StudioErrorCode::NotFound,"No saved plans for this channel."))}
        let file=folder.join(format!("{plan_id}.json"));
        let bytes=checked_file(&file,MAX_PLAN_BYTES)?;
        let raw:serde_json::Value=serde_json::from_slice(&bytes).map_err(|_|corrupt())?;
        if raw.get("schemaVersion").and_then(|v|v.as_u64()).is_some_and(|v|v>SCHEMA_VERSION as u64){
            return Err(err(StudioErrorCode::UnsupportedVersion,"Future plan version preserved."));
        }
        let plan:ScriptStudioPlanV1=serde_json::from_value(raw).map_err(|_|corrupt())?;
        validate_stored_plan(&plan).map_err(|_|corrupt())?;
        if plan.channel_id!=channel || plan.plan_id!=plan_id{return Err(corrupt())}
        Ok(plan)
    }
    pub fn preview(&self,seed:&LegacyChannelSeed,input:&PlanInput)
        ->Result<super::model::StudioPreview,StudioError>{
        let config=self.get(seed)?;
        build_plan(&config,input,"1970-01-01T00:00:00.000Z")
            .map(super::planning::previews).map_err(|_|invalid())
    }
    pub fn save_plan(&self,seed:&LegacyChannelSeed,input:&PlanInput)
        ->Result<ScriptStudioPlanV1,StudioError>{
        let _g=self.operation.lock().unwrap_or_else(|p|p.into_inner());
        let folder=self.folder(&seed.channel_id)?;
        let config=load_chain(&folder,&seed.channel_id)?.unwrap_or_else(||ChannelStudioConfigV1::seed(
            seed.channel_id.clone(),seed.channel_name.clone(),seed.language.clone(),seed.master_prompt.clone(),
            seed.claude_account_id.clone()));
        let plans=folder.join("plans");
        if check_dir(&plans,false)? {
            let dest=plans.join(format!("{}.json",input.plan_id));
            if fs::symlink_metadata(dest).is_ok(){
                let previous=self.get_plan_locked(&seed.channel_id,&input.plan_id)?;
                let expected=build_plan(&previous.config_snapshot,input,&previous.created_at)
                    .map_err(|_|err(StudioErrorCode::Conflict,"Plan ID reused with different request."))?;
                if previous==expected{return Ok(previous)}
                return Err(err(StudioErrorCode::Conflict,"Plan ID reused with changed input."));
            }
        }
        let plan=build_plan(&config,input,&timestamp()).map_err(|_|invalid())?;
        validate_stored_plan(&plan).map_err(|_|invalid())?;
        check_dir(&folder,true)?;check_dir(&plans,true)?;
        // 256 plans per channel, no silent old-plan cleanup.
        if fs::read_dir(&plans).map_err(|_|storage())?.count()>=MAX_PLANS {
            return Err(err(StudioErrorCode::HistoryFull,"Saved plan limit reached."));
        }
        persist_new(&plans.join(format!("{}.json",plan.plan_id)),
            &serde_json::to_vec_pretty(&plan).map_err(|_|storage())?)?;
        Ok(plan)
    }
    pub fn list_plans(&self,channel:&str)->Result<StudioPlanList,StudioError>{
        let _g=self.operation.lock().unwrap_or_else(|p|p.into_inner());
        let folder=self.folder(channel)?.join("plans");
        if !check_dir(&folder,false)?{return Ok(StudioPlanList::default())}
        let mut result=StudioPlanList::default();
        for entry in fs::read_dir(&folder).map_err(|_|storage())?{
            let entry=entry.map_err(|_|storage())?;
            let name=entry.file_name().into_string().map_err(|_|corrupt())?;
            if !name.ends_with(".json"){result.issues.push("Uncommitted or unexpected plan artifact preserved.".into());continue;}
            let id=&name[..name.len()-5];
            match self.get_plan_locked(channel,id) {
                Ok(plan)=>result.plans.push(plan),
                Err(e)=>result.issues.push(format!("Plan {id} needs inspection ({:?}).",e.code)),
            }
        }
        result.plans.sort_by(|a,b|a.plan_id.cmp(&b.plan_id));
        Ok(result)
    }
    pub fn export(&self,seed:&LegacyChannelSeed)->Result<StudioBackupV1,StudioError>{
        Ok(StudioBackupV1 {backup_version:1,source_channel_id:seed.channel_id.clone(),
            config:self.get(seed)?})
    }
    pub fn import(&self,seed:&LegacyChannelSeed,backup:&StudioBackupV1,
        operation_id:&str,claude:&[String],chatgpt:&[String])
        ->Result<ChannelStudioConfigV1,StudioError>{
        seed.validate().map_err(|_|invalid())?;
        if !valid_id(operation_id)||backup.backup_version!=1||
            backup.source_channel_id!=backup.config.channel_id ||
            backup.config.validate().is_err(){return Err(invalid())}
        let _g=self.operation.lock().unwrap_or_else(|p|p.into_inner());
        let folder=self.folder(&seed.channel_id)?;
        if load_chain(&folder,&seed.channel_id)?.is_some() {
            return Err(err(StudioErrorCode::Conflict,"Import requires a channel without existing Studio configuration."));
        }
        let mut imported=backup.config.clone();
        imported.channel_id=seed.channel_id.clone();imported.channel_name=seed.channel_name.clone();
        for version in imported.prompt_versions.iter_mut().chain(imported.review_versions.iter_mut()) {
            version.channel_id=seed.channel_id.clone();
        }
        for skill in &mut imported.skills {
            skill.channel_id=seed.channel_id.clone();
            skill.status=SkillInstallStatus::RegisteredLocally;
            skill.user_confirmed_at=None;
        }
        imported.revision=1;imported.created_at=timestamp();imported.updated_at=imported.created_at.clone();
        imported.previous_digest=None;imported.operation_id=Some(operation_id.into());
        imported.operation_digest=Some(digest(&serde_json::to_vec(backup).map_err(|_|invalid())?));
        imported.validate().map_err(|_|invalid())?;
        check_accounts(&imported,claude,chatgpt)?;
        check_dir(&folder,true)?;
        persist_new(&version_path(&folder,1),
            &serde_json::to_vec_pretty(&imported).map_err(|_|storage())?)?;
        Ok(imported)
    }
}
#[derive(Default,Serialize)]
#[serde(rename_all="camelCase")]
pub struct StudioPlanList {pub plans:Vec<ScriptStudioPlanV1>,pub issues:Vec<String>}
