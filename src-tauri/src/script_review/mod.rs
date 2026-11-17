//! Phase 03J. Offline, channel-owned professional reviews. No provider calls or video side effects.
//! Separate from legacy Script Jobs and Phase 03I's immutable execution history.
use std::{collections::HashSet,fs::{self,File,OpenOptions},io::{Read,Write},path::{Path,PathBuf},sync::Mutex,time::{SystemTime,UNIX_EPOCH}};
use rand::RngCore;
use serde::{Deserialize,Serialize};
use crate::script_jobs::{lock,model::{digest,valid_id}};
use crate::script_studio::{ScriptStudioPlanV1,RubricCriterion,valid_rubric,validate_stored_plan};

const MAX_SCRIPT:usize=64*1024*1024;
const MAX_RAW:usize=2*1024*1024;
const MAX_PROMPT:usize=256*1024;
const MAX_STATE:u64=2*1024*1024;
const MAX_CHECKPOINT:u64=512;
const SECTION_BYTES:usize=48*1024;
const MAX_SECTIONS:usize=1400;

#[derive(Clone,Copy,Debug,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
pub enum ReviewErrorCode {InvalidInput,NotFound,Conflict,StaleRevision,HistoryFull,WriterBusy,StorageFailure,CorruptRecord,RecoveryBlocked,ChannelMismatch}
#[derive(Debug)]
pub struct ReviewError {pub code:ReviewErrorCode,pub message:&'static str}
impl std::fmt::Display for ReviewError {
 fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result{f.write_str(self.message)}
}
impl std::error::Error for ReviewError {}
fn err(code:ReviewErrorCode,message:&'static str)->ReviewError{ReviewError{code,message}}
fn invalid()->ReviewError{err(ReviewErrorCode::InvalidInput,"Invalid review request; no checkpoint committed.")}
fn corrupt()->ReviewError{err(ReviewErrorCode::CorruptRecord,"Review integrity check failed; data preserved.")}
fn storage()->ReviewError{err(ReviewErrorCode::StorageFailure,"Review storage error; prior data preserved.")}
fn blocked()->ReviewError{err(ReviewErrorCode::RecoveryBlocked,"Unexpected or orphan review file; manual inspection required.")}
fn conflict()->ReviewError{err(ReviewErrorCode::Conflict,"Conflicting review operation; reload saved state.")}
fn new_id()->String{let mut b=[0u8;16];rand::rng().fill_bytes(&mut b);b.iter().map(|x|format!("{x:02x}")).collect()}
fn stamp()->String{
 let d=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
 let s=d.as_secs();
 format!("{}T{:02}:{:02}:{:02}.{:03}Z",crate::clock::civil_date((s/86400) as i64),
 s%86400/3600,s%86400%3600/60,s%60,d.subsec_millis())
}
fn directory(p:&Path,create:bool)->Result<bool,ReviewError>{
 match fs::symlink_metadata(p){
  Ok(m) if m.is_dir()&&!m.file_type().is_symlink()=>Ok(true),
  Ok(_)=>Err(blocked()),
  Err(e) if e.kind()==std::io::ErrorKind::NotFound && create=>{fs::create_dir(p).map_err(|_|storage())?;Ok(true)},
  Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Ok(false),
  _=>Err(storage())
 }
}
fn read(p:&Path,max:u64)->Result<Vec<u8>,ReviewError>{
 let m=fs::symlink_metadata(p).map_err(|_|corrupt())?;
 if !m.is_file()||m.file_type().is_symlink()||m.len()>max{return Err(corrupt())}
 let mut b=Vec::new();File::open(p).map_err(|_|storage())?.take(max+1).read_to_end(&mut b).map_err(|_|storage())?;
 if b.len() as u64>max{return Err(corrupt())}Ok(b)
}
fn publish(p:&Path,bytes:&[u8])->Result<(),ReviewError>{
 if fs::symlink_metadata(p).is_ok(){return Err(conflict())}
 let parent=p.parent().ok_or_else(storage)?;
 let temp=parent.join(format!(".review-{}.tmp",new_id()));
 let mut f=OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|_|storage())?;
 f.write_all(bytes).and_then(|_|f.sync_all()).map_err(|_|storage())?;
 if fs::symlink_metadata(p).is_ok(){return Err(conflict())}
 fs::rename(temp,p).map_err(|_|storage())?;
 #[cfg(unix)] File::open(parent).and_then(|d|d.sync_all()).map_err(|_|storage())?;
 Ok(())
}
fn valid_review_id(v:&str)->bool{v.starts_with("rv_")&&v.len()<=80&&valid_id(v)}
fn file(dir:&Path,rev:u64)->PathBuf{dir.join(format!("state-{rev:06}.json"))}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ReviewObject {pub filename:String,pub bytes:u64,pub sha256:String,pub created_at:String}
fn object_text(dir:&Path,o:&ReviewObject)->Result<String,ReviewError>{
 if !o.filename.starts_with("object-")||!o.filename.ends_with(".txt")
  ||!valid_id(o.filename.trim_end_matches(".txt"))||o.bytes>MAX_SCRIPT as u64{return Err(corrupt())}
 let b=read(&dir.join("objects").join(&o.filename),MAX_SCRIPT as u64)?;
 if b.len() as u64!=o.bytes||digest(&b)!=o.sha256{return Err(corrupt())}
 String::from_utf8(b).map_err(|_|corrupt())
}
fn refs(s:&ReviewState)->Vec<&ReviewObject>{
 let mut v=Vec::new();
 for script in &s.versions{v.push(&script.text);if let Some(p)=&script.improvement_prompt{v.push(p);}}
 for round in &s.rounds{for section in &round.sections{
  v.push(&section.prompt);if let Some(raw)=&section.raw{v.push(raw);}
 }}
 v
}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct CategoryScore {pub key:String,pub points:u32}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
pub enum Severity {Info,Warning,Error}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Finding {pub severity:Severity,pub category:String,pub summary:String,pub recommendation:String}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Report {
 pub scores:Vec<CategoryScore>,pub findings:Vec<Finding>,pub summary:String,
}
fn score(report:&Report,rubric:&[RubricCriterion])->Result<u32,Vec<String>>{
 let mut issues=Vec::new();let mut seen=HashSet::new();let mut total=0u32;
 if report.summary.trim().is_empty()||report.summary.len()>10000{issues.push("Summary must be 1–10000 characters.".into())}
 if report.scores.len()!=rubric.len(){issues.push("One explicit category score is required for every rubric category.".into())}
 for c in &report.scores{
  if !seen.insert(&c.key){issues.push(format!("Duplicate category: {}",c.key));continue}
  match rubric.iter().find(|r|r.key==c.key){
   Some(r) if c.points<=r.points=>total+=c.points,
   Some(r)=>issues.push(format!("Score {} exceeds maximum {} for {}.",c.points,r.points,c.key)),
   None=>issues.push(format!("Unknown category: {}",c.key))
  }
 }
 for r in rubric {if !seen.contains(&r.key){issues.push(format!("Missing category: {}",r.key))}}
 if report.findings.len()>200{issues.push("Too many findings (limit 200).".into())}
 for f in &report.findings{
  if f.summary.trim().is_empty()||f.summary.len()>2000||f.recommendation.len()>4000
   ||f.category.len()>80||(!f.category.is_empty()&&!rubric.iter().any(|r|r.key==f.category)){
   issues.push("Finding contains invalid category, summary or recommendation.".into());
  }
 }
 if issues.is_empty(){Ok(total)}else{Err(issues)}
}
pub fn parse_report(raw:&str,rubric:&[RubricCriterion])->Result<(Report,u32),Vec<String>>{
 match serde_json::from_str::<Report>(raw){
  Ok(report)=>match score(&report,rubric){Ok(sum)=>Ok((report,sum)),Err(e)=>Err(e)},
  Err(e)=>Err(vec![format!("Not a valid structured JSON report: {e}. Preserve original and correct manually.")])
 }
}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ReviewPolicy{
 pub provider:String,pub account_ref:Option<String>,pub prompt_version:Option<String>,
 pub prompt_digest:Option<String>,pub prompt_text:String,pub rubric:Vec<RubricCriterion>,
 pub audience:String,pub tone:String,pub style:String,pub language:String,
 pub single_instructions:String,pub per_part_instructions:String,pub final_instructions:String,
 pub title:String,pub topic:String,pub part_objective:Option<String>,pub target_words:Option<u32>,
}
fn policy(plan:&ScriptStudioPlanV1,part:Option<u32>)->Result<ReviewPolicy,ReviewError>{
 validate_stored_plan(plan).map_err(|_|corrupt())?;
 let cfg=&plan.config_snapshot;
 if !valid_rubric(&cfg.rubric){return Err(invalid())}
 let selected=plan.reviewer_prompt_version_id.as_ref().and_then(|id|
  cfg.review_versions.iter().find(|v|&v.version_id==id));
 if selected.map(|r|&r.content_digest)!=plan.reviewer_prompt_digest.as_ref(){return Err(corrupt())}
 let item=part.map(|i|plan.parts.get(i.saturating_sub(1) as usize).ok_or_else(invalid)).transpose()?;
 Ok(ReviewPolicy{
  provider:match &plan.reviewer_provider{crate::script_studio::ReviewerProvider::None=>"none",crate::script_studio::ReviewerProvider::Claude=>"claude",crate::script_studio::ReviewerProvider::Chatgpt=>"chatgpt"}.into(),
  account_ref:plan.reviewer_account_id.clone(),prompt_version:plan.reviewer_prompt_version_id.clone(),
  prompt_digest:plan.reviewer_prompt_digest.clone(),prompt_text:selected.map(|x|x.content.clone()).unwrap_or_default(),
  rubric:cfg.rubric.clone(),audience:cfg.writing.target_audience.clone(),
  tone:cfg.writing.narration_tone.clone(),style:cfg.writing.writing_style.clone(),
  language:plan.language.clone(),single_instructions:cfg.review.single_script_instructions.clone(),
  per_part_instructions:cfg.review.per_part_instructions.clone(),final_instructions:cfg.review.final_script_instructions.clone(),
  title:plan.title.clone(),topic:plan.topic.clone(),part_objective:item.map(|x|x.objective.clone()),
  target_words:item.map(|x|x.target_words)
 })
}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ScriptVersion {pub index:u32,pub text:ReviewObject,pub source:String,
 pub parent_digest:Option<String>,pub improvement_prompt:Option<ReviewObject>,
 pub validation_findings:Vec<String>}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct SectionReview{pub index:u32,pub bytes:u32,pub prompt:ReviewObject,pub raw:Option<ReviewObject>,
 pub report:Option<Report>,pub score:Option<u32>,pub validation_issues:Vec<String>}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ReviewRound {pub index:u32,pub version_index:u32,pub mode:String,pub created_at:String,
 pub sections:Vec<SectionReview>}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Approval{pub version_index:u32,pub script_digest:String,pub round_index:u32,
 pub review_digest:String,pub confirmed_at:String,pub confirmation:String,pub provenance:String}
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ReviewState{
 pub schema_version:u32,pub review_id:String,pub channel_id:String,pub execution_id:String,
 pub plan_id:String,pub plan_digest:String,pub source_digest:String,pub source_execution_revision:u64,
 pub part_index:Option<u32>,pub created_at:String,pub policy:ReviewPolicy,
 pub revision:u64,pub previous_digest:Option<String>,pub operation_id:String,pub operation_digest:String,
 pub versions:Vec<ScriptVersion>,pub rounds:Vec<ReviewRound>,pub approvals:Vec<Approval>,
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct StartReview{pub channel_id:String,pub execution_id:String,pub review_id:String,
 pub part_index:Option<u32>,pub operation_id:String}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ReviewRequest{pub channel_id:String,pub review_id:String,pub expected_revision:u64,
 pub operation_id:String,pub action:ReviewAction}
#[derive(Clone,Serialize,Deserialize)]
#[serde(tag="kind",rename_all="snake_case",rename_all_fields="camelCase")]
pub enum ReviewAction{
 ImportResponse{section_index:u32,raw:String},
 CorrectResponse{section_index:u32,report:Report},
 PrepareImprovement{goals:Vec<String>},
 ImportRevision{text:String},
 PrepareReview{mode:String},
 Approve{confirmation:String},
}
#[derive(Default,Serialize)]
#[serde(rename_all="camelCase")]
pub struct ReviewList{pub reviews:Vec<ReviewState>,pub issues:Vec<String>}
fn sections(text:&str)->Result<Vec<&str>,ReviewError>{
 if text.len()>MAX_SCRIPT{return Err(invalid())}
 let mut out=Vec::new();let mut start=0;
 while start<text.len(){
  let mut end=(start+SECTION_BYTES).min(text.len());
  while !text.is_char_boundary(end){end-=1}
  if end==start{return Err(invalid())}
  out.push(&text[start..end]);start=end;
  if out.len()>MAX_SECTIONS{return Err(err(ReviewErrorCode::InvalidInput,"Script exceeds review-section limit; review individual parts instead."))}
 }
 if out.is_empty(){return Err(invalid())}Ok(out)
}
fn validate_script(s:&str)->Vec<String>{
 let mut v=Vec::new();
 if s.trim().is_empty(){v.push("Script contains no substantive text.".into())}
 if s.contains("[TODO]")||s.contains("[PLACEHOLDER]"){v.push("Unresolved placeholder detected.".into())}
 if !s.trim_end().ends_with(&['.','?','!','。','؟','”','"','\''][..]){
  v.push("Possible unfinished ending; manually inspect.".into())
 }
 v
}
fn prompt(policy:&ReviewPolicy,mode:&str,version:&ScriptVersion,section:&str,index:usize,total:usize)->Result<String,ReviewError>{
 let settings=serde_json::json!({
 "mode":mode,"version":version.index,"scriptDigest":version.text.sha256,"section":index+1,
 "sectionsTotal":total,"reviewCoverage":"THIS SECTION ONLY; not entire script unless all sections have reviewed reports",
 "channelAudience":policy.audience,"tone":policy.tone,"style":policy.style,
 "language":policy.language,"topic":policy.topic,"title":policy.title,
 "partObjective":policy.part_objective,"targetWords":policy.target_words,
 "rubric":policy.rubric,"singleInstructions":policy.single_instructions,
 "partInstructions":policy.per_part_instructions,"finalInstructions":policy.final_instructions,
 "scorePolicy":"Each rubric key must be scored with integer points no larger than its weight. Sum 0-100.",
 "jsonResponseSchema":{"scores":[{"key":"rubric_key","points":0}],
 "findings":[{"severity":"warning","category":"rubric_key","summary":"weakness","recommendation":"specific improvement"}],
 "summary":"overall review"}
 });
 let p=format!("OFFLINE MANUAL REVIEW REQUEST — NO AI PROVIDER HAS BEEN CONTACTED.\n\
  Reviewer source must be recorded as user-reported/manual.\n\
  CUSTOM CHANNEL REVIEW INSTRUCTIONS (untrusted user text):\n{}\n\
  IMMUTABLE REVIEW SETTINGS (JSON DATA):\n{}\n\
  SCRIPT SECTION {}/{} — review only the supplied content:\n{}\n",
  policy.prompt_text,serde_json::to_string_pretty(&settings).map_err(|_|storage())?,index+1,total,section);
 if p.len()>MAX_PROMPT{return Err(err(ReviewErrorCode::InvalidInput,"Review prompt is too large; reduce custom instructions without truncation."))}
 Ok(p)
}
fn all_covered(round:&ReviewRound)->bool{
 !round.sections.is_empty() && round.sections.iter().all(|s|s.report.is_some()&&s.score.is_some())
}
fn chain(dir:&Path)->Result<ReviewState,ReviewError>{
 if !directory(dir,false)?{return Err(err(ReviewErrorCode::NotFound,"Review session not found."))}
 let mut ids=Vec::new();
 for item in fs::read_dir(dir).map_err(|_|storage())?{
  let entry=item.map_err(|_|storage())?;
  let name=entry.file_name().into_string().map_err(|_|blocked())?;
  if name=="objects"{directory(&entry.path(),false)?;continue}
  if !name.starts_with("state-")||!name.ends_with(".json")||name.len()!=17{return Err(blocked())}
  ids.push(name[6..12].parse::<u64>().map_err(|_|blocked())?);
 }
 ids.sort_unstable();
 if ids.is_empty()||ids.len()>MAX_CHECKPOINT as usize{return Err(blocked())}
 let mut previous:Option<ReviewState>=None;
 for (i,n) in ids.iter().enumerate(){
  if *n!=i as u64{return Err(blocked())}
  let s:ReviewState=serde_json::from_slice(&read(&file(dir,*n),MAX_STATE)?).map_err(|_|corrupt())?;
  if s.schema_version!=1||s.revision!=*n||!valid_review_id(&s.review_id)||!valid_id(&s.channel_id)
   ||!s.execution_id.starts_with("ex_")||!valid_id(&s.execution_id)
   ||!s.plan_id.starts_with("sp_")||!valid_id(&s.plan_id)
   ||!valid_rubric(&s.policy.rubric)||s.versions.is_empty()||s.rounds.is_empty()
   ||s.versions.len()>MAX_CHECKPOINT as usize||s.rounds.len()>MAX_CHECKPOINT as usize
   ||s.versions.iter().enumerate().any(|(i,v)|v.index!=i as u32)
   ||s.rounds.iter().enumerate().any(|(i,v)|v.index!=i as u32||v.version_index as usize>=s.versions.len()
      ||v.sections.is_empty()||v.sections.len()>MAX_SECTIONS
      ||v.sections.iter().enumerate().any(|(j,s)|s.index!=j as u32))
   ||s.versions[0].text.sha256!=s.source_digest{return Err(corrupt())}
  if let Some(prev)=&previous{
   if s.review_id!=prev.review_id||s.channel_id!=prev.channel_id
    ||s.execution_id!=prev.execution_id||s.plan_id!=prev.plan_id
    ||s.plan_digest!=prev.plan_digest||s.source_digest!=prev.source_digest
    ||s.source_execution_revision!=prev.source_execution_revision
    ||s.created_at!=prev.created_at||s.part_index!=prev.part_index
    ||serde_json::to_vec(&s.policy).map_err(|_|storage())?!=serde_json::to_vec(&prev.policy).map_err(|_|storage())?
    ||s.previous_digest.as_deref()!=Some(digest(&serde_json::to_vec(prev).map_err(|_|storage())?).as_str()){
    return Err(corrupt())
   }
  } else if s.previous_digest.is_some(){return Err(corrupt())}
  previous=Some(s);
 }
 let s=previous.ok_or_else(corrupt)?;
 let mut known=HashSet::new();
 for o in refs(&s){
  if !known.insert(o.filename.clone()){return Err(corrupt())}
  object_text(dir,o)?;
 }
 let objects=dir.join("objects");if !directory(&objects,false)?{return Err(corrupt())}
 for e in fs::read_dir(objects).map_err(|_|storage())?{
  let n=e.map_err(|_|storage())?.file_name().into_string().map_err(|_|blocked())?;
  if !known.contains(&n){return Err(blocked())}
 }
 Ok(s)
}
pub struct ReviewStore{root:PathBuf,lease:File,mutex:Mutex<()>}
impl Drop for ReviewStore{fn drop(&mut self){lock::unlock(&self.lease)}}
impl ReviewStore{
 pub fn new(root:PathBuf)->Result<Self,ReviewError>{
  directory(&root,true)?;directory(&root.join("channels"),true)?;
  let p=root.join("writer.lock");
  if let Ok(m)=fs::symlink_metadata(&p){
   if !m.is_file()||m.file_type().is_symlink(){return Err(blocked())}
  }
  let lease=OpenOptions::new().read(true).write(true).create(true).open(p).map_err(|_|storage())?;
  lock::try_lock(&lease).map_err(|_|err(ReviewErrorCode::WriterBusy,"Another review process holds the exclusive writer lease."))?;
  Ok(Self{root,lease,mutex:Mutex::new(())})
 }
 fn folder(&self,channel:&str,id:&str)->Result<PathBuf,ReviewError>{
  if !valid_id(channel)||!valid_review_id(id){return Err(invalid())}
  let p=self.root.join("channels").join(channel);
  directory(&p,false)?;Ok(p.join(id))
 }
 fn object(&self,dir:&Path,rev:u64,name:&str,text:&str,max:usize)->Result<ReviewObject,ReviewError>{
  if text.len()>max||text.contains('\0'){return Err(invalid())}
  let filename=format!("object-{rev:06}-{name}.txt");
  if !valid_id(filename.trim_end_matches(".txt")){return Err(invalid())}
  let o=ReviewObject{filename:filename.clone(),bytes:text.len() as u64,sha256:digest(text.as_bytes()),created_at:stamp()};
  publish(&dir.join("objects").join(filename),text.as_bytes())?;Ok(o)
 }
 fn checkpoint(&self,dir:&Path,s:&ReviewState)->Result<(),ReviewError>{
  let bytes=serde_json::to_vec(s).map_err(|_|storage())?;
  if bytes.len() as u64>MAX_STATE{return Err(err(ReviewErrorCode::HistoryFull,"Review metadata limit reached."))}
  publish(&file(dir,s.revision),&bytes)
 }
 fn make_round(&self,dir:&Path,rev:u64,mode:&str,version:&ScriptVersion,p:&ReviewPolicy,index:u32)->Result<ReviewRound,ReviewError>{
  if !["single","part","final","continuity","improvement"].contains(&mode){return Err(invalid())}
  let text=object_text(dir,&version.text)?;
  let chunks=sections(&text)?;
  // Preflight every prompt before writing any immutable object. An input-validation
  // error must never strand partially published objects.
  let instructions=chunks.iter().enumerate()
   .map(|(i,chunk)|prompt(p,mode,version,chunk,i,chunks.len()))
   .collect::<Result<Vec<_>,ReviewError>>()?;
  let mut all=Vec::new();
  for (i,content) in instructions.iter().enumerate(){
   let o=self.object(dir,rev,&format!("prompt-r{index}-s{i}"),content,MAX_PROMPT)?;
   all.push(SectionReview{index:i as u32,bytes:chunks[i].len() as u32,prompt:o,raw:None,report:None,
    score:None,validation_issues:Vec::new()});
  }
  Ok(ReviewRound{index,version_index:version.index,mode:mode.into(),created_at:stamp(),sections:all})
 }
 pub fn start(&self,plan:&ScriptStudioPlanV1,execution:&crate::script_execution::ExecutionState,
  source:&str,input:&StartReview)->Result<ReviewState,ReviewError>{
  if !valid_review_id(&input.review_id)||!valid_id(&input.operation_id)
   ||!valid_id(&input.channel_id)||!valid_id(&input.execution_id)
   ||execution.channel_id!=input.channel_id||execution.execution_id!=input.execution_id
   ||plan.channel_id!=input.channel_id||plan.plan_id!=execution.plan_id
   ||digest(&serde_json::to_vec(plan).map_err(|_|storage())?)!=execution.plan_digest{return Err(err(ReviewErrorCode::ChannelMismatch,"Review source plan or channel does not match saved execution."))}
  let source_ref=match input.part_index {
   Some(n) if n>0=>execution.parts.get((n-1) as usize).and_then(|p|p.committed.as_ref()).ok_or_else(invalid)?,
   None=>execution.assembled.as_ref().ok_or_else(invalid)?,
   _=>return Err(invalid()),
  };
  if source_ref.sha256!=digest(source.as_bytes())||source_ref.bytes!=source.len() as u64
   ||source.trim().is_empty()||source.len()>MAX_SCRIPT{return Err(corrupt())}
  let policy=policy(plan,input.part_index)?;
  // Reject oversized/invalid prompt inputs before creating an on-disk review directory.
  let mode=if input.part_index.is_some(){"part"}else if execution.total_parts==1{"single"}else{"final"};
  let preview_version=ScriptVersion{index:0,source:String::new(),parent_digest:None,
   improvement_prompt:None,validation_findings:Vec::new(),
   text:ReviewObject{filename:"object-000000-script-v0.txt".into(),bytes:source.len() as u64,
    sha256:digest(source.as_bytes()),created_at:stamp()}};
  let pieces=sections(source)?;
  for (i,piece) in pieces.iter().enumerate(){
   prompt(&policy,mode,&preview_version,piece,i,pieces.len())?;
  }
  let op=digest(&serde_json::to_vec(input).map_err(|_|storage())?);
  let _guard=self.mutex.lock().unwrap_or_else(|e|e.into_inner());
  let channel=self.root.join("channels").join(&input.channel_id);
  let dir=self.folder(&input.channel_id,&input.review_id)?;
  if directory(&dir,false)?{
   let existing=chain(&dir)?;
   if existing.operation_id==input.operation_id&&existing.operation_digest==op&&existing.revision==0{return Ok(existing)}
   let first:ReviewState=serde_json::from_slice(&read(&file(&dir,0),MAX_STATE)?).map_err(|_|corrupt())?;
   if first.operation_id==input.operation_id&&first.operation_digest==op{return Ok(existing)}
   return Err(conflict())
  }
  directory(&channel,true)?;directory(&dir,true)?;directory(&dir.join("objects"),true)?;
  let original=self.object(&dir,0,"script-v0",source,MAX_SCRIPT)?;
  let version=ScriptVersion{index:0,text:original,source:"immutable_phase_03i_manual_execution".into(),
   parent_digest:None,improvement_prompt:None,validation_findings:validate_script(source)};
  let round=self.make_round(&dir,0,mode,&version,&policy,0)?;
  let s=ReviewState{schema_version:1,review_id:input.review_id.clone(),channel_id:input.channel_id.clone(),
   execution_id:input.execution_id.clone(),plan_id:plan.plan_id.clone(),plan_digest:execution.plan_digest.clone(),
   source_digest:digest(source.as_bytes()),source_execution_revision:execution.revision,
   part_index:input.part_index,created_at:stamp(),policy,
   revision:0,previous_digest:None,operation_id:input.operation_id.clone(),
   operation_digest:op,versions:vec![version],rounds:vec![round],approvals:Vec::new()};
  self.checkpoint(&dir,&s)?;Ok(s)
 }
 pub fn get(&self,channel:&str,id:&str)->Result<ReviewState,ReviewError>{
  let _g=self.mutex.lock().unwrap_or_else(|e|e.into_inner());
  let s=chain(&self.folder(channel,id)?)?;
  if s.channel_id!=channel||s.review_id!=id{return Err(corrupt())}Ok(s)
 }
 pub fn list(&self,channel:&str)->Result<ReviewList,ReviewError>{
  let _g=self.mutex.lock().unwrap_or_else(|e|e.into_inner());
  if !valid_id(channel){return Err(invalid())}
  let p=self.root.join("channels").join(channel);
  if !directory(&p,false)?{return Ok(ReviewList::default())}
  let mut list=ReviewList::default();
  for e in fs::read_dir(p).map_err(|_|storage())?{
   let e=e.map_err(|_|storage())?;
   let name=e.file_name().into_string().map_err(|_|blocked())?;
   if !valid_review_id(&name){list.issues.push("Unexpected review-folder entry preserved.".into());continue}
   match chain(&e.path()){
    Ok(s) if s.review_id==name&&s.channel_id==channel=>list.reviews.push(s),
    _=>list.issues.push(format!("Review {name} requires manual recovery inspection.")),
   }
  }
  list.reviews.sort_by(|a,b|a.created_at.cmp(&b.created_at));Ok(list)
 }
 pub fn read(&self,channel:&str,id:&str,kind:&str,index:u32)->Result<String,ReviewError>{
  let _g=self.mutex.lock().unwrap_or_else(|e|e.into_inner());
  let dir=self.folder(channel,id)?;let state=chain(&dir)?;
  if state.channel_id!=channel{return Err(corrupt())}
  let o=match kind{
   "script"=>state.versions.get(index as usize).map(|v|&v.text),
   "improvement"=>state.versions.last().and_then(|v|v.improvement_prompt.as_ref()),
   "prompt"=>state.rounds.last().and_then(|v|v.sections.get(index as usize)).map(|v|&v.prompt),
   "raw"=>state.rounds.last().and_then(|v|v.sections.get(index as usize)).and_then(|v|v.raw.as_ref()),
   _=>return Err(invalid())
  }.ok_or_else(||err(ReviewErrorCode::NotFound,"Requested review artifact is absent."))?;
  object_text(&dir,o)
 }
 pub fn read_history(&self,channel:&str,id:&str,kind:&str,round_index:u32,item_index:u32)->Result<String,ReviewError>{
  let _g=self.mutex.lock().unwrap_or_else(|e|e.into_inner());
  let dir=self.folder(channel,id)?;let state=chain(&dir)?;
  if state.channel_id!=channel{return Err(corrupt())}
  let artifact=match kind{
   "script"=>state.versions.get(item_index as usize).map(|v|&v.text),
   "improvement"=>state.versions.get(item_index as usize).and_then(|v|v.improvement_prompt.as_ref()),
   "prompt"|"raw"=>{
    let section=state.rounds.get(round_index as usize)
     .and_then(|r|r.sections.get(item_index as usize)).ok_or_else(invalid)?;
    if kind=="prompt"{Some(&section.prompt)}else{section.raw.as_ref()}
   },
   _=>return Err(invalid())
  }.ok_or_else(||err(ReviewErrorCode::NotFound,"Historical review artifact is unavailable."))?;
  object_text(&dir,artifact)
 }
 pub fn apply(&self,input:&ReviewRequest)->Result<ReviewState,ReviewError>{
  if !valid_id(&input.channel_id)||!valid_review_id(&input.review_id)||!valid_id(&input.operation_id){return Err(invalid())}
  let _g=self.mutex.lock().unwrap_or_else(|e|e.into_inner());
  let dir=self.folder(&input.channel_id,&input.review_id)?;
  let current=chain(&dir)?;
  if current.channel_id!=input.channel_id{return Err(corrupt())}
  let op=digest(&serde_json::to_vec(input).map_err(|_|storage())?);
  for n in 1..=current.revision{
   let old:ReviewState=serde_json::from_slice(&read(&file(&dir,n),MAX_STATE)?).map_err(|_|corrupt())?;
   if old.operation_id==input.operation_id{
    if old.operation_digest==op&&old.revision==input.expected_revision+1{return Ok(current)}
    return Err(conflict())
   }
  }
  if input.expected_revision!=current.revision{return Err(err(ReviewErrorCode::StaleRevision,"Review state is stale; reload before changing."))}
  if current.revision>=MAX_CHECKPOINT-1{return Err(err(ReviewErrorCode::HistoryFull,"Review checkpoint cap reached."))}
  let mut next=current.clone();
  next.revision+=1;next.previous_digest=Some(digest(&serde_json::to_vec(&current).map_err(|_|storage())?));
  next.operation_id=input.operation_id.clone();next.operation_digest=op;
  match &input.action{
   ReviewAction::ImportResponse{section_index,raw}=>{
    if raw.trim().is_empty()||raw.len()>MAX_RAW||raw.contains('\0'){return Err(invalid())}
    let round=next.rounds.last_mut().ok_or_else(corrupt)?;
    let item=round.sections.get_mut(*section_index as usize).ok_or_else(invalid)?;
    if item.raw.is_some(){return Err(conflict())}
    let o=self.object(&dir,next.revision,&format!("raw-r{}-s{section_index}",round.index),raw,MAX_RAW)?;
    let parsed=parse_report(raw,&next.policy.rubric);
    item.raw=Some(o);
    match parsed{
     Ok((r,total))=>{item.report=Some(r);item.score=Some(total);item.validation_issues=Vec::new()},
     Err(issues)=>{item.report=None;item.score=None;item.validation_issues=issues}
    }
   },
   ReviewAction::CorrectResponse{section_index,report}=>{
    let total=score(report,&next.policy.rubric).map_err(|_|invalid())?;
    let r=next.rounds.last_mut().ok_or_else(corrupt)?;
    let item=r.sections.get_mut(*section_index as usize).ok_or_else(invalid)?;
    if item.raw.is_none()||item.report.is_some(){return Err(conflict())}
    item.report=Some(report.clone());item.score=Some(total);item.validation_issues=Vec::new();
   },
   ReviewAction::PrepareImprovement{goals}=>{
    if goals.is_empty()||goals.len()>24||goals.iter().any(|g|g.trim().is_empty()||g.len()>300){return Err(invalid())}
    let last=next.rounds.last().ok_or_else(corrupt)?;
    if !all_covered(last)||last.version_index as usize!=next.versions.len()-1{return Err(invalid())}
    let version=next.versions.last().ok_or_else(corrupt)?;
    if version.improvement_prompt.is_some(){return Err(conflict())}
    let findings=last.sections.iter().flat_map(|s|s.report.as_ref().into_iter().flat_map(|r|r.findings.iter())).collect::<Vec<_>>();
    let data=serde_json::json!({"goals":goals,"findings":findings,"rubric":next.policy.rubric,
     "originalDigest":version.text.sha256,"reviewMode":last.mode,
     "instruction":"Improve the script while preserving meaning, important claims, identities, pacing and exact user-selected goals. The output is a NEW script, not an approval."});
    let prompt=format!("OFFLINE SCRIPT IMPROVEMENT REQUEST — manual use only, not submitted.\n{}\n\nSCRIPT:\n{}",
     serde_json::to_string_pretty(&data).map_err(|_|storage())?,object_text(&dir,&version.text)?);
    if prompt.len()>MAX_PROMPT{return Err(err(ReviewErrorCode::InvalidInput,"Improvement prompt exceeds 256 KiB; improve individual parts instead of silently truncating."))}
    let o=self.object(&dir,next.revision,"improvement",&prompt,MAX_PROMPT)?;
    next.versions.last_mut().ok_or_else(corrupt)?.improvement_prompt=Some(o);
   },
   ReviewAction::ImportRevision{text}=>{
    if text.trim().is_empty()||text.len()>MAX_SCRIPT||text.contains('\0'){return Err(invalid())}
    let last=next.versions.last().ok_or_else(corrupt)?;
    if last.improvement_prompt.is_none(){return Err(invalid())}
    if last.text.sha256==digest(text.as_bytes()){return Err(conflict())}
    let parent=last.text.sha256.clone();
    let n=next.versions.len() as u32;
    let r=self.object(&dir,next.revision,&format!("script-v{n}"),text,MAX_SCRIPT)?;
    next.versions.push(ScriptVersion{index:n,text:r,source:"manual_improved_revision".into(),
     parent_digest:Some(parent),improvement_prompt:None,validation_findings:validate_script(text)});
   },
   ReviewAction::PrepareReview{mode}=>{
    let v=next.versions.last().ok_or_else(corrupt)?.clone();
    let prior=next.rounds.last().ok_or_else(corrupt)?;
    if prior.version_index==v.index && !all_covered(prior){return Err(invalid())}
    let idx=next.rounds.len() as u32;
    let round=self.make_round(&dir,next.revision,mode,&v,&next.policy,idx)?;
    next.rounds.push(round);
   },
   ReviewAction::Approve{confirmation}=>{
    if confirmation!="APPROVE FINAL SCRIPT"||next.part_index.is_some(){return Err(invalid())}
    let version=next.versions.last().ok_or_else(corrupt)?;
    if !version.validation_findings.is_empty(){return Err(err(ReviewErrorCode::InvalidInput,"Script has unresolved deterministic validation warnings; correct script and re-review."))}
    let round=next.rounds.last().ok_or_else(corrupt)?;
    if round.version_index!=version.index||!all_covered(round)
     ||!["single","final","improvement"].contains(&round.mode.as_str()){return Err(invalid())}
    if next.approvals.iter().any(|a|a.version_index==version.index){return Err(conflict())}
    let proof=serde_json::to_vec(&round.sections.iter().map(|s|(&s.raw,&s.report,&s.score)).collect::<Vec<_>>()).map_err(|_|storage())?;
    next.approvals.push(Approval{version_index:version.index,script_digest:version.text.sha256.clone(),
     round_index:round.index,review_digest:digest(&proof),confirmed_at:stamp(),
     confirmation:confirmation.clone(),provenance:"explicit_local_user_confirmation".into()});
   }
  }
  self.checkpoint(&dir,&next)?;Ok(next)
 }
}
#[cfg(test)]
mod tests;
