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

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MasterPromptSnapshot {
    pub channel_id: String,
    pub content: String,
    pub version_id: String,
    pub content_digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
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
    Prepared,
    AwaitingUserAction,
    CopyIntent,
    Copied,
    SubmissionIntent,
    SubmissionUncertain,
    Submitted,
    AwaitingResponse,
    ResponseReceived,
    Validating,
    DraftSaved,
    ReviewPending,
    Approved,
    Failed,
    Cancelled,
}

/// Extra fields are additive under schemaVersion=1. Older Phase 03B JSON has
/// preparedPrompt:null and omits appliedOperations; both remain valid.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedPromptSnapshot {
    pub request_id: String,
    pub channel_id: String,
    pub format_version: String,
    pub content: String,
    pub content_digest: String,
    pub master_prompt_digest: String,
    pub prepared_at: String,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppliedJobOperation {
    pub operation_id: String,
    pub action_digest: String,
    pub expected_revision: u64,
    pub result_revision: u64,
    pub result_state: ScriptJobState,
}

pub const MAX_OPERATIONS: usize = 256;
pub const MAX_PROMPT_BYTES: usize = 120_000;
/// Response is exact UTF-8 text; 2 MiB prevents unbounded disk/memory use.
pub const MAX_IMPORT_BYTES: usize = 2_097_152;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScriptRevisionSource { ManualImport }
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScriptRevisionRef {
    pub revision_id: String,
    pub content_digest: String,
    pub byte_length: u64,
    pub created_at: String,
    pub source: ScriptRevisionSource,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManualSubmissionEvidence {
    UserConfirmed,
    UserConfirmedNotSubmitted,
}
pub fn valid_revision_id(id: &str) -> bool {
    id.len() == 68 && id.starts_with("rev_")
        && id[4..].bytes().all(|b| b.is_ascii_hexdigit())
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
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
    pub prepared_prompt: Option<PreparedPromptSnapshot>,
    pub revisions: Vec<ScriptRevisionRef>,
    pub approved_revision_id: Option<String>,
    pub error_code: Option<String>,
    pub recovery_action: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub applied_operations: Vec<AppliedJobOperation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submission_evidence: Option<ManualSubmissionEvidence>,
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
pub fn valid_digest(text: &str) -> bool {
    text.len() == 71 && text.starts_with("sha256:") && text[7..].bytes().all(|b| b.is_ascii_hexdigit())
}
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
        && (s.ends_with('Z') || s.rfind(|c| c == '+' || c == '-').is_some_and(|idx| idx > 18))
}
impl ScriptJobRecord {
    pub fn validate(&self, folder_id: &str) -> Result<(), &'static str> {
        if self.schema_version != SCHEMA_VERSION { return Err("unsupported_version"); }
        if !valid_job_id(&self.job_id) || self.job_id != folder_id { return Err("invalid_job_id"); }
        self.request.validate()?;
        if self.request_id != self.request.request_id || self.channel_id != self.request.channel_id
            || self.project_id != self.request.project_id { return Err("identity_mismatch"); }
        if self.request_digest != request_digest(&self.request)? { return Err("request_digest_mismatch"); }
        if self.applied_operations.len() > MAX_OPERATIONS
            || self.state_revision != self.applied_operations.len() as u64 {
            return Err("operation_history_mismatch");
        }
        let mut seen = std::collections::HashSet::new();
        for (i, op) in self.applied_operations.iter().enumerate() {
            if !valid_id(&op.operation_id) || !seen.insert(&op.operation_id)
                || !valid_digest(&op.action_digest)
                || op.expected_revision != i as u64
                || op.result_revision != (i + 1) as u64 {
                return Err("invalid_operation_history");
            }
        }
        if self.applied_operations.last().is_some_and(|op| op.result_state != self.state) {
            return Err("operation_state_mismatch");
        }
        if self.state_revision == 0 && self.state != ScriptJobState::Created {
            return Err("invalid_initial_state");
        }
        if self.approved_revision_id.is_some() || self.revisions.len() > 1 {
            return Err("unsupported_revision_data");
        }
        for reference in &self.revisions {
            if !valid_revision_id(&reference.revision_id)
                || !valid_digest(&reference.content_digest)
                || reference.byte_length == 0 || reference.byte_length > MAX_IMPORT_BYTES as u64
                || !valid_iso_utc(&reference.created_at) {
                return Err("invalid_revision_reference");
            }
        }
        if self.state == ScriptJobState::Submitted
            && self.submission_evidence != Some(ManualSubmissionEvidence::UserConfirmed) {
            return Err("missing_manual_submission_evidence");
        }
        if self.revisions.is_empty() && self.state == ScriptJobState::ResponseReceived {
            return Err("missing_response_revision");
        }
        if !self.revisions.is_empty() && self.state != ScriptJobState::ResponseReceived {
            return Err("unexpected_response_revision");
        }
        match self.state {
            ScriptJobState::Created => {
                if self.prepared_prompt.is_some() || self.state_revision != 0 { return Err("created_state_inconsistent"); }
            }
            ScriptJobState::Cancelled => {}
            ScriptJobState::Prepared | ScriptJobState::AwaitingUserAction
            | ScriptJobState::CopyIntent | ScriptJobState::Copied
            | ScriptJobState::SubmissionIntent | ScriptJobState::SubmissionUncertain
            | ScriptJobState::Submitted | ScriptJobState::ResponseReceived => {
                if self.prepared_prompt.is_none() { return Err("missing_prepared_prompt"); }
            }
            // Phase 03E will implement validating, draft, review and approval.
            _ => return Err("unimplemented_lifecycle_state"),
        }
        if let Some(prompt) = &self.prepared_prompt {
            if prompt.request_id != self.request_id || prompt.channel_id != self.channel_id
                || prompt.master_prompt_digest != self.request.master_prompt.content_digest
                || prompt.format_version != "script-prompt-v1"
                || prompt.content.trim().is_empty() || prompt.content.len() > MAX_PROMPT_BYTES
                || prompt.content_digest != digest(prompt.content.as_bytes())
                || !valid_iso_utc(&prompt.prepared_at) {
                return Err("invalid_prepared_prompt");
            }
        }
        if !valid_iso_utc(&self.created_at) || !valid_iso_utc(&self.updated_at) { return Err("invalid_job_timestamp"); }
        Ok(())
    }
}
