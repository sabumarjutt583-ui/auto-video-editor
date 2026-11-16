//! Phase 03H offline Script Studio contracts. No provider, browser or project schema usage.
use serde::{Deserialize, Serialize};
use crate::script_jobs::model::{digest, valid_id};

pub const SCHEMA_VERSION: u32 = 1;
pub const MAX_CONFIG_REVISIONS: u64 = 256;
pub const MAX_VERSIONS: usize = 64;
pub const MAX_SKILLS: usize = 64;
pub const MAX_PLANS: usize = 256;
pub const MAX_PARTS: u32 = 40;
pub const MAX_TOTAL_WORDS: u32 = 200_000;
pub const MAX_TEXT_BYTES: usize = 64_000;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="snake_case")]
pub enum WritingMode { MasterPrompt, ClaudeSkill, MasterPlusSkill }
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="snake_case")]
pub enum ScriptMode { Single, MultiPart }
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="snake_case")]
pub enum AccountPolicy { StrictSelected, AutomaticPermitted }
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="snake_case")]
pub enum ReviewerProvider { None, Claude, Chatgpt }
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="snake_case")]
pub enum SkillInstallStatus { RegisteredLocally, UserConfirmedInstalled, NeedsAttention }
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct PlanningDefaults {
    pub default_script_mode: ScriptMode,
    pub default_part_count: u32,
    pub default_total_words: u32,
    pub target_words_per_part: Option<u32>,
    pub outline_required: bool,
    pub continuity_required: bool,
}
impl Default for PlanningDefaults {
    fn default() -> Self { Self { default_script_mode:ScriptMode::Single,
        default_part_count:1,default_total_words:1600,target_words_per_part:None,
        outline_required:false,continuity_required:false } }
}
impl PlanningDefaults {
    pub fn valid(&self)->bool {
        self.default_total_words>=50 && self.default_total_words<=MAX_TOTAL_WORDS
            && self.default_part_count>=1 && self.default_part_count<=MAX_PARTS
            && self.default_total_words>=50*self.default_part_count
            && self.target_words_per_part.map_or(true, |n| n>=50 && n<=MAX_TOTAL_WORDS)
    }
}
/// Structured preference override, never guessed by parsing natural-language instructions.
#[derive(Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PlanningOverride {
    pub default_script_mode:Option<ScriptMode>,
    pub default_part_count:Option<u32>,
    pub default_total_words:Option<u32>,
    pub target_words_per_part:Option<u32>,
    pub outline_required:Option<bool>,
    pub continuity_required:Option<bool>,
}
impl PlanningOverride {
    pub fn apply(&self, target:&mut PlanningDefaults) {
        if let Some(value)=&self.default_script_mode { target.default_script_mode=value.clone(); }
        if let Some(value)=self.default_part_count { target.default_part_count=value; }
        if let Some(value)=self.default_total_words { target.default_total_words=value; }
        if let Some(value)=self.target_words_per_part { target.target_words_per_part=Some(value); }
        if let Some(value)=self.outline_required { target.outline_required=value; }
        if let Some(value)=self.continuity_required { target.continuity_required=value; }
    }
}
#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct TextVersion {
    pub version_id:String,
    pub channel_id:String,
    pub content:String,
    pub content_digest:String,
    pub created_at:String,
    pub planning_override:Option<PlanningOverride>,
}
impl TextVersion {
    pub fn valid(&self,channel:&str)->bool {
        self.channel_id==channel && valid_id(&self.version_id)
            && self.content.len()<=MAX_TEXT_BYTES && !self.content.contains('\0')
            && self.content_digest==digest(self.content.as_bytes())
    }
}
#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct SkillRegistration {
    pub skill_id:String,
    pub channel_id:String,
    pub display_name:String,
    pub exact_name:String,
    pub claude_account_id:String,
    pub description:String,
    pub status:SkillInstallStatus,
    pub user_confirmed_at:Option<String>,
    pub planning_override:Option<PlanningOverride>,
}
impl SkillRegistration {
    pub fn valid(&self, channel:&str)->bool {
        self.channel_id==channel && valid_id(&self.skill_id) &&
        good_text(&self.display_name,120,true) && good_text(&self.exact_name,150,true)
            && valid_id(&self.claude_account_id) && good_text(&self.description,1000,false)
            && (!matches!(self.status,SkillInstallStatus::UserConfirmedInstalled)
                || self.user_confirmed_at.as_ref().is_some_and(|s|valid_stamp(s)))
    }
}
#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct AccountPreferences {
    pub claude_account_id:Option<String>,
    pub chatgpt_review_account_id:Option<String>,
    pub writer_policy:AccountPolicy,
    pub reviewer_policy:AccountPolicy,
    pub allowed_claude_account_ids:Vec<String>,
    pub allowed_chatgpt_account_ids:Vec<String>,
}
impl Default for AccountPreferences {
    fn default()->Self{Self{claude_account_id:None,chatgpt_review_account_id:None,
        writer_policy:AccountPolicy::StrictSelected,reviewer_policy:AccountPolicy::StrictSelected,
        allowed_claude_account_ids:Vec::new(),allowed_chatgpt_account_ids:Vec::new()}}
}
#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct RubricCriterion {
    pub key:String,
    pub label:String,
    pub points:u32,
}
pub fn default_rubric()->Vec<RubricCriterion> {
    [("hook","Opening hook",15),("retention","Audience retention",15),
        ("rehooks","Rehooks",10),("story","Storytelling",15),
        ("clarity","Clarity",15),("engagement","Psychological engagement",10),
        ("audience","Audience relevance",10),("ending","Ending and CTA",5),
        ("consistency","Consistency",5)].iter().map(|(key,label,points)|RubricCriterion {
            key:(*key).into(),label:(*label).into(),points:*points
        }).collect()
}
pub fn valid_rubric(criteria:&[RubricCriterion])->bool {
    criteria.len()>=1 && criteria.len()<=24
        && criteria.iter().map(|r|r.points as u64).sum::<u64>()==100
        && criteria.iter().all(|r|valid_id(&r.key)&&good_text(&r.label,120,true)&&r.points<=100)
        && {let mut unique=std::collections::HashSet::new();
            criteria.iter().all(|r|unique.insert(&r.key))}
}
#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct WritingSettings {
    pub instruction_mode:WritingMode,
    pub selected_skill_id:Option<String>,
    pub language:String,
    pub target_audience:String,
    pub narration_tone:String,
    pub writing_style:String,
    pub additional_instructions:String,
    pub default_word_target:u32,
}
#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ReviewSettings {
    pub provider:ReviewerProvider,
    pub require_user_approval:bool,
    pub single_script_instructions:String,
    pub per_part_instructions:String,
    pub final_script_instructions:String,
}
#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ChannelStudioConfigV1 {
    pub schema_version:u32,
    pub channel_id:String,
    pub channel_name:String,
    pub revision:u64,
    pub created_at:String,
    pub updated_at:String,
    pub previous_digest:Option<String>,
    pub operation_id:Option<String>,
    pub operation_digest:Option<String>,
    pub prompt_versions:Vec<TextVersion>,
    pub selected_prompt_version_id:Option<String>,
    pub review_versions:Vec<TextVersion>,
    pub selected_review_version_id:Option<String>,
    pub skills:Vec<SkillRegistration>,
    pub writing:WritingSettings,
    pub accounts:AccountPreferences,
    pub review:ReviewSettings,
    pub rubric:Vec<RubricCriterion>,
    pub planning:PlanningDefaults,
}
pub fn valid_stamp(s:&str)->bool {s.len()>=20 && s.len()<=40 && s.ends_with('Z') && s.contains('T')}
pub fn good_text(s:&str,max:usize,required:bool)->bool {
    s.len()<=max && !s.contains('\0') && (!required || !s.trim().is_empty())
}
impl ChannelStudioConfigV1 {
    pub fn seed(channel_id:String,channel_name:String,language:String,master:String,claude:Option<String>)->Self {
        let first= if master.is_empty(){Vec::new()}else{vec![TextVersion {
            version_id:"legacy_1".into(),channel_id:channel_id.clone(),
            content_digest:digest(master.as_bytes()),content:master,created_at:"1970-01-01T00:00:00.000Z".into(),
            planning_override:None
        }]};
        let chosen=first.first().map(|v|v.version_id.clone());
        Self{schema_version:SCHEMA_VERSION,channel_id,channel_name,revision:0,
            created_at:"1970-01-01T00:00:00.000Z".into(),updated_at:"1970-01-01T00:00:00.000Z".into(),
            previous_digest:None,operation_id:None,operation_digest:None,
            prompt_versions:first,selected_prompt_version_id:chosen,review_versions:Vec::new(),
            selected_review_version_id:None,skills:Vec::new(),
            writing:WritingSettings{instruction_mode:WritingMode::MasterPrompt,selected_skill_id:None,
                language,target_audience:String::new(),narration_tone:String::new(),
                writing_style:String::new(),additional_instructions:String::new(),default_word_target:1600},
            accounts:AccountPreferences{claude_account_id:claude,..Default::default()},
            review:ReviewSettings{provider:ReviewerProvider::None,require_user_approval:true,
                single_script_instructions:String::new(),per_part_instructions:String::new(),
                final_script_instructions:String::new()},
            rubric:default_rubric(),planning:PlanningDefaults::default()}
    }
    pub fn active_prompt(&self)->Option<&TextVersion> {
        self.selected_prompt_version_id.as_ref().and_then(|id|self.prompt_versions.iter().find(|v|&v.version_id==id))
    }
    pub fn active_reviewer(&self)->Option<&TextVersion>{
        self.selected_review_version_id.as_ref().and_then(|id|self.review_versions.iter().find(|v|&v.version_id==id))
    }
    pub fn active_skill(&self)->Option<&SkillRegistration>{
        self.writing.selected_skill_id.as_ref().and_then(|id|self.skills.iter().find(|v|&v.skill_id==id))
    }
    pub fn validate(&self)->Result<(),&'static str>{
        if self.schema_version!=SCHEMA_VERSION {return Err("unsupported_version")}
        if !valid_id(&self.channel_id)||!good_text(&self.channel_name,60,true)
            || !valid_stamp(&self.created_at)||!valid_stamp(&self.updated_at)
            || self.revision>MAX_CONFIG_REVISIONS {return Err("invalid_identity")}
        if self.prompt_versions.len()>MAX_VERSIONS || self.review_versions.len()>MAX_VERSIONS
            || self.skills.len()>MAX_SKILLS {return Err("history_limit")}
        for (versions,selected) in [(&self.prompt_versions,&self.selected_prompt_version_id),
            (&self.review_versions,&self.selected_review_version_id)]{
            let mut unique=std::collections::HashSet::new();
            if !versions.iter().all(|v|v.valid(&self.channel_id)&&unique.insert(&v.version_id)) {
                return Err("invalid_version")
            }
            if selected.as_ref().is_some_and(|id|!versions.iter().any(|v|&v.version_id==id)){
                return Err("missing_selected_version")
            }
        }
        if !self.skills.iter().all(|s|s.valid(&self.channel_id)) ||
            {let mut ids=std::collections::HashSet::new();!self.skills.iter().all(|s|ids.insert(&s.skill_id))}{
            return Err("invalid_skill")
        }
        if self.writing.selected_skill_id.as_ref().is_some_and(|id|
            !self.skills.iter().any(|s|&s.skill_id==id)){return Err("missing_skill")}
        if !good_text(&self.writing.language,120,false) ||
            !good_text(&self.writing.target_audience,500,false) ||
            !good_text(&self.writing.narration_tone,300,false)||
            !good_text(&self.writing.writing_style,500,false)||
            !good_text(&self.writing.additional_instructions,4000,false)||
            !(50..=20_000).contains(&self.writing.default_word_target){return Err("invalid_writing")}
        if !self.planning.valid()||!valid_rubric(&self.rubric) {return Err("invalid_planning_or_rubric")}
        if !good_text(&self.review.single_script_instructions,MAX_TEXT_BYTES,false)
            ||!good_text(&self.review.per_part_instructions,MAX_TEXT_BYTES,false)
            ||!good_text(&self.review.final_script_instructions,MAX_TEXT_BYTES,false) {
            return Err("invalid_review")
        }
        if !self.accounts.claude_account_id.as_ref().map_or(true, |s|valid_id(s)) ||
            !self.accounts.chatgpt_review_account_id.as_ref().map_or(true, |s|valid_id(s)) ||
            self.accounts.allowed_claude_account_ids.len()>32 ||
            self.accounts.allowed_chatgpt_account_ids.len()>32 ||
            !self.accounts.allowed_claude_account_ids.iter()
                .chain(&self.accounts.allowed_chatgpt_account_ids).all(|s|valid_id(s)) {
            return Err("invalid_account")
        }
        Ok(())
    }
}
#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct LegacyChannelSeed {
    pub channel_id:String,
    pub channel_name:String,
    pub language:String,
    pub master_prompt:String,
    pub claude_account_id:Option<String>,
}
impl LegacyChannelSeed {
    pub fn validate(&self)->Result<(),&'static str>{
        if !valid_id(&self.channel_id)||!good_text(&self.channel_name,60,true)
            ||!good_text(&self.language,120,false)||!good_text(&self.master_prompt,8000,false)
            ||!self.claude_account_id.as_ref().map_or(true, |id|valid_id(id)){return Err("invalid_legacy_profile")}
        Ok(())
    }
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct StudioEdit {
    pub channel_id:String,
    pub expected_revision:u64,
    pub operation_id:String,
    pub channel_name:String,
    pub writing:WritingSettings,
    pub accounts:AccountPreferences,
    pub review:ReviewSettings,
    pub rubric:Vec<RubricCriterion>,
    pub planning:PlanningDefaults,
    pub skills:Vec<SkillRegistration>,
    pub new_master_prompt:Option<String>,
    pub select_master_version_id:Option<String>,
    pub new_review_prompt:Option<String>,
    pub select_review_version_id:Option<String>,
    pub new_master_planning:Option<PlanningOverride>,
    pub new_review_planning:Option<PlanningOverride>,
}
#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PartRequest {
    pub title:String,
    pub objective:String,
    pub override_words:Option<u32>,
}
#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PlanInput {
    pub plan_id:String,
    pub channel_id:String,
    pub expected_config_revision:u64,
    pub title:String,
    pub topic:String,
    pub language:Option<String>,
    pub mode:Option<ScriptMode>,
    pub total_words:Option<u32>,
    pub part_count:Option<u32>,
    pub outline_required:Option<bool>,
    pub continuity_required:Option<bool>,
    pub parts:Vec<PartRequest>,
}
#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ScriptPlanPart {pub index:u32,pub title:String,pub objective:String,pub target_words:u32}
#[derive(Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ScriptStudioPlanV1 {
    pub schema_version:u32,
    pub plan_id:String,
    pub channel_id:String,
    pub config_revision:u64,
    pub config_digest:String,
    pub created_at:String,
    pub title:String,
    pub topic:String,
    pub language:String,
    pub writing_mode:WritingMode,
    pub selected_prompt_version_id:Option<String>,
    pub selected_prompt_digest:Option<String>,
    pub selected_skill_id:Option<String>,
    pub selected_skill_name:Option<String>,
    pub claude_account_id:Option<String>,
    pub reviewer_provider:ReviewerProvider,
    pub reviewer_account_id:Option<String>,
    pub reviewer_prompt_version_id:Option<String>,
    pub reviewer_prompt_digest:Option<String>,
    pub mode:ScriptMode,
    pub total_words:u32,
    pub part_count:u32,
    pub outline_required:bool,
    pub continuity_required:bool,
    pub parts:Vec<ScriptPlanPart>,
    /// Immutable full channel-config copy, independent of later edits.
    pub config_snapshot:ChannelStudioConfigV1,
    pub warnings:Vec<String>,
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct StudioPreview {
    pub plan:ScriptStudioPlanV1,
    pub writing_preview:String,
    pub review_preview:String,
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct StudioBackupV1 {pub backup_version:u32,pub source_channel_id:String,pub config:ChannelStudioConfigV1}
