//! Durable Script Writer records. Serde field names deliberately mirror Phase 01.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const SCHEMA_VERSION: u32 = 1;
const MAX_ID: usize = 128;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderMode {
    ClaudeBrowserAssisted,
    ClaudeApi,
    LocalModel,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MasterPromptSnapshot {
    pub channel_id: String,
    pub content: String,
    pub version_id: String,
    pub content_digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScriptGenerationRequest {
    pub request_id: String,
    pub channel_id: String,
    #[serde(default)]
    pub project_id: Option<String>,
    pub title: String,
    pub topic: String,
    pub language: String,
    pub requested_words: Option<u32>,
    pub target_audience: String,
    pub narration_tone: String,
    pub storytelling_style: String,
    pub provider_mode: ProviderMode,
    pub additional_instructions: String,
    pub master_prompt: MasterPromptSnapshot,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScriptJobState {
    Created,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScriptJobRecord {
    pub schema_version: u32,
    pub job_id: String,
    pub request_id: String,
    pub channel_id: String,
    pub project_id: Option<String>,
    pub request: ScriptGenerationRequest,
    pub request_digest: String,
    pub state: ScriptJobState,
    pub state_revision: u64,
    pub created_at: String,
    pub updated_at: String,
    pub prepared_prompt: Option<String>,
    pub revisions: Vec<String>,
    pub approved_revision_id: Option<String>,
    pub error_code: Option<String>,
    pub recovery_action: Option<String>,
}

pub fn valid_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_ID
        && value.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
pub fn valid_job_id(id: &str) -> bool {
    id.len() == 35 && id.starts_with("sj_") && id[3..].bytes().all(|b| b.is_ascii_hexdigit())
}
fn utf16_len(text: &str) -> usize { text.encode_utf16().count() }
fn sized(text: &str, max: usize) -> bool { utf16_len(text) <= max }
fn nonempty(text: &str, max: usize) -> bool { !text.trim().is_empty() && sized(text, max) }
pub fn digest(text: &[u8]) -> String { format!("sha256:{:x}", Sha256::digest(text)) }
pub fn request_digest(request: &ScriptGenerationRequest) -> Result<String, &'static str> {
    // Explicit typed order and normalized Option projectId make this independent
    // from object key insertion order or incoming JSON whitespace.
    let bytes = serde_json::to_vec(request).map_err(|_| "request_encoding")?;
    Ok(digest(&bytes))
}

impl ScriptGenerationRequest {
    /// Keep limits aligned with src/lib/script/core/request.ts. Return no prompt text in errors.
    pub fn validate(&self) -> Result<(), &'static str> {
        if !valid_id(&self.request_id) { return Err("invalid_request_id"); }
        if !valid_id(&self.channel_id) { return Err("invalid_channel_id"); }
        if self.project_id.as_deref().is_some_and(|id| !valid_id(id)) { return Err("invalid_project_id"); }
        if !sized(&self.title, 200) || !sized(&self.topic, 2000)
            || (self.title.trim().is_empty() && self.topic.trim().is_empty()) {
            return Err("invalid_subject");
        }
        if !sized(&self.language, 120) || !sized(&self.target_audience, 500)
            || !sized(&self.narration_tone, 300) || !sized(&self.storytelling_style, 500)
            || !sized(&self.additional_instructions, 4000) { return Err("invalid_writing_settings"); }
        if self.requested_words.is_some_and(|count| !(50..=20_000).contains(&count)) { return Err("invalid_word_count"); }
        let master = &self.master_prompt;
        if master.channel_id != self.channel_id { return Err("master_channel_mismatch"); }
        if !valid_id(&master.channel_id) || !nonempty(&master.content, 8000)
            || !nonempty(&master.version_id, 120) { return Err("invalid_master_prompt"); }
        if master.content_digest != digest(master.content.as_bytes()) { return Err("master_digest_mismatch"); }
        if master.created_at.as_deref().is_some_and(|v| !valid_iso_utc(v)) { return Err("invalid_snapshot_timestamp"); }
        Ok(())
    }
}
pub fn valid_iso_utc(s: &str) -> bool {
    // Rust-owned timestamps are fixed width UTC. Imported snapshot timestamps
    // may be ISO-8601 with timezone offsets; reject control chars and malformed
    // prefixes without trying to reinterpret them.
    s.len() >= 20 && s.len() <= 40 && s.as_bytes().get(4) == Some(&b'-')
        && s.as_bytes().get(7) == Some(&b'-') && s.as_bytes().get(10) == Some(&b'T')
        && s.chars().all(|c| c.is_ascii_digit() || matches!(c, '-' | ':' | '+' | '.' | 'T' | 'Z'))
        && (s.ends_with('Z') || s.rfind(['+','-']).is_some_and(|idx| idx > 18))
}
impl ScriptJobRecord {
    pub fn validate(&self, folder_id: &str) -> Result<(), &'static str> {
        if self.schema_version != SCHEMA_VERSION { return Err("unsupported_version"); }
        if !valid_job_id(&self.job_id) || self.job_id != folder_id { return Err("invalid_job_id"); }
        self.request.validate()?;
        if self.request_id != self.request.request_id || self.channel_id != self.request.channel_id
            || self.project_id != self.request.project_id { return Err("identity_mismatch"); }
        if self.request_digest != request_digest(&self.request)? { return Err("request_digest_mismatch"); }
        if self.state != ScriptJobState::Created || self.state_revision != 0
            || self.prepared_prompt.is_some() || !self.revisions.is_empty()
            || self.approved_revision_id.is_some() { return Err("unsupported_job_state"); }
        if !valid_iso_utc(&self.created_at) || !valid_iso_utc(&self.updated_at) { return Err("invalid_job_timestamp"); }
        Ok(())
    }
}
