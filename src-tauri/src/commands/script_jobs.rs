//! Typed non-sending Tauri boundary for local Script Writer jobs.
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::script_jobs::{
    JobMutation, RecoveryReport, ScriptGenerationRequest, ScriptJobAction, ScriptJobRecord,
    ScriptJobStore, StoreError, StoreErrorCode, WaitingReason,
};

pub struct ScriptJobService {
    store: Option<Arc<ScriptJobStore>>,
    unavailable: Option<StoreErrorCode>,
}

impl ScriptJobService {
    pub fn initialize(app: &AppHandle) -> Self {
        let result = app.path().app_data_dir().map_err(|_| StoreErrorCode::StorageFailure)
            .and_then(|path| ScriptJobStore::new(path.join("script-writer"))
                .map_err(|error| error.code));
        match result {
            Ok(store) => Self { store: Some(Arc::new(store)), unavailable: None },
            Err(code) => Self { store: None, unavailable: Some(code) },
        }
    }

    fn store(&self) -> Result<Arc<ScriptJobStore>, ScriptJobCommandError> {
        self.store.as_ref().cloned().ok_or_else(|| ScriptJobCommandError {
            code: self.unavailable.unwrap_or(StoreErrorCode::StorageFailure),
            message: "Local Script Job Store is unavailable. Existing application features remain usable.".into(),
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptJobCommandError {
    pub code: StoreErrorCode,
    pub message: String,
}

impl From<StoreError> for ScriptJobCommandError {
    fn from(error: StoreError) -> Self {
        Self { code: error.code, message: error.details.to_string() }
    }
}
type CmdResult<T> = Result<T, ScriptJobCommandError>;

async fn blocking<T: Send + 'static>(
    op: impl FnOnce() -> Result<T, StoreError> + Send + 'static,
) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(op).await
        .map_err(|_| ScriptJobCommandError {
            code: StoreErrorCode::StorageFailure,
            message: "Local Script Job Store operation did not complete.".into(),
        })?
        .map_err(Into::into)
}

#[tauri::command]
pub async fn script_job_create(
    state: State<'_, ScriptJobService>,
    request: ScriptGenerationRequest,
) -> CmdResult<ScriptJobRecord> {
    let store = state.store()?;
    blocking(move || store.create(request)).await
}

#[tauri::command]
pub async fn script_job_get(
    state: State<'_, ScriptJobService>,
    job_id: String,
) -> CmdResult<ScriptJobRecord> {
    let store = state.store()?;
    blocking(move || store.get(&job_id)).await
}

#[tauri::command]
pub async fn script_job_list(state: State<'_, ScriptJobService>) -> CmdResult<RecoveryReport> {
    let store = state.store()?;
    blocking(move || store.list()).await
}
#[tauri::command]
pub async fn script_job_recovery(state: State<'_, ScriptJobService>) -> CmdResult<RecoveryReport> {
    let store = state.store()?;
    blocking(move || store.recover()).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareScriptJobInput {
    pub job_id: String,
    pub channel_id: String,
    pub request_id: String,
    pub expected_revision: u64,
    pub operation_id: String,
    pub prompt_text: String,
    pub master_prompt_digest: String,
}

#[tauri::command]
pub async fn script_job_prepare(
    state: State<'_, ScriptJobService>,
    input: PrepareScriptJobInput,
) -> CmdResult<ScriptJobRecord> {
    let store = state.store()?;
    blocking(move || store.transition(JobMutation {
        job_id: input.job_id,
        channel_id: input.channel_id,
        request_id: input.request_id,
        expected_revision: input.expected_revision,
        operation_id: input.operation_id,
        action: ScriptJobAction::Prepare {
            prompt_text: input.prompt_text,
            master_prompt_digest: input.master_prompt_digest,
        },
    })).await
}

/// Separate, restricted external transition enum; the frontend cannot send an
/// arbitrary state string or a fake "submitted"/"approved" transition.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum LocalJobAction {
    BeginCopy,
    ConfirmCopy,
    AwaitUserAction { reason: WaitingReason },
    BeginManualSubmission,
    MarkSubmissionUncertain,
    ConfirmSubmitted,
    ConfirmNotSubmitted,
}

impl From<LocalJobAction> for ScriptJobAction {
    fn from(value: LocalJobAction) -> Self {
        match value {
            LocalJobAction::BeginCopy => Self::BeginCopy,
            LocalJobAction::ConfirmCopy => Self::ConfirmCopy,
            LocalJobAction::AwaitUserAction { reason } => Self::AwaitUserAction { reason },
            LocalJobAction::BeginManualSubmission => Self::BeginManualSubmission,
            LocalJobAction::MarkSubmissionUncertain => Self::MarkSubmissionUncertain,
            LocalJobAction::ConfirmSubmitted => Self::ConfirmSubmitted,
            LocalJobAction::ConfirmNotSubmitted => Self::ConfirmNotSubmitted,
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalJobTransitionInput {
    pub job_id: String,
    pub channel_id: String,
    pub request_id: String,
    pub expected_revision: u64,
    pub operation_id: String,
    pub action: LocalJobAction,
}
#[tauri::command]
pub async fn script_job_transition(
    state: State<'_, ScriptJobService>,
    input: LocalJobTransitionInput,
) -> CmdResult<ScriptJobRecord> {
    let store = state.store()?;
    blocking(move || store.transition(JobMutation {
        job_id: input.job_id, channel_id: input.channel_id,
        request_id: input.request_id, expected_revision: input.expected_revision,
        operation_id: input.operation_id, action: input.action.into(),
    })).await
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelScriptJobInput {
    pub job_id: String,
    pub channel_id: String,
    pub request_id: String,
    pub expected_revision: u64,
    pub operation_id: String,
}
#[tauri::command]
pub async fn script_job_cancel(
    state: State<'_, ScriptJobService>,
    input: CancelScriptJobInput,
) -> CmdResult<ScriptJobRecord> {
    let store = state.store()?;
    blocking(move || store.transition(JobMutation {
        job_id: input.job_id, channel_id: input.channel_id,
        request_id: input.request_id, expected_revision: input.expected_revision,
        operation_id: input.operation_id, action: ScriptJobAction::Cancel,
    })).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportScriptResponseInput {
    pub job_id: String,
    pub channel_id: String,
    pub request_id: String,
    pub expected_revision: u64,
    pub operation_id: String,
    pub text: String,
}
#[tauri::command]
pub async fn script_job_import_response(
    state: State<'_, ScriptJobService>,
    input: ImportScriptResponseInput,
) -> CmdResult<ScriptJobRecord> {
    let store = state.store()?;
    blocking(move || store.transition(JobMutation {
        job_id: input.job_id,
        channel_id: input.channel_id,
        request_id: input.request_id,
        expected_revision: input.expected_revision,
        operation_id: input.operation_id,
        action: ScriptJobAction::ImportResponse { text: input.text },
    })).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadImportedScriptInput {
    pub job_id: String,
    pub channel_id: String,
    pub request_id: String,
    pub revision_id: String,
}
#[tauri::command]
pub async fn script_job_read_response(
    state: State<'_, ScriptJobService>,
    input: ReadImportedScriptInput,
) -> CmdResult<crate::script_jobs::ImportedScriptResponse> {
    let store = state.store()?;
    blocking(move || store.read_response(&input.job_id, &input.channel_id,
        &input.request_id, &input.revision_id)).await
}


/// Exact immutable revision identity is required for every review step.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewScriptJobInput {
    pub job_id: String,
    pub channel_id: String,
    pub request_id: String,
    pub expected_revision: u64,
    pub operation_id: String,
    pub revision_id: String,
    pub content_digest: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApproveScriptJobInput {
    pub job_id: String,
    pub channel_id: String,
    pub request_id: String,
    pub expected_revision: u64,
    pub operation_id: String,
    pub revision_id: String,
    pub content_digest: String,
    pub validation_version: String,
}
async fn commit_review_action(
    state: State<'_, ScriptJobService>,
    input: ReviewScriptJobInput,
    action: fn(String, String) -> ScriptJobAction,
) -> CmdResult<ScriptJobRecord> {
    let store = state.store()?;
    blocking(move || store.transition(JobMutation {
        job_id: input.job_id,
        channel_id: input.channel_id,
        request_id: input.request_id,
        expected_revision: input.expected_revision,
        operation_id: input.operation_id,
        action: action(input.revision_id, input.content_digest),
    })).await
}

#[tauri::command]
pub async fn script_job_start_validation(
    state: State<'_, ScriptJobService>,
    input: ReviewScriptJobInput,
) -> CmdResult<ScriptJobRecord> {
    commit_review_action(state, input, |revision_id, content_digest|
        ScriptJobAction::StartValidation { revision_id, content_digest }).await
}
#[tauri::command]
pub async fn script_job_complete_validation(
    state: State<'_, ScriptJobService>,
    input: ReviewScriptJobInput,
) -> CmdResult<ScriptJobRecord> {
    commit_review_action(state, input, |revision_id, content_digest|
        ScriptJobAction::CompleteValidation { revision_id, content_digest }).await
}
#[tauri::command]
pub async fn script_job_begin_review(
    state: State<'_, ScriptJobService>,
    input: ReviewScriptJobInput,
) -> CmdResult<ScriptJobRecord> {
    commit_review_action(state, input, |revision_id, content_digest|
        ScriptJobAction::BeginReview { revision_id, content_digest }).await
}
/// Only this explicit, user-invoked command can approve a saved revision.
#[tauri::command]
pub async fn script_job_approve(
    state: State<'_, ScriptJobService>,
    input: ApproveScriptJobInput,
) -> CmdResult<ScriptJobRecord> {
    let store = state.store()?;
    blocking(move || store.transition(JobMutation {
        job_id: input.job_id,
        channel_id: input.channel_id,
        request_id: input.request_id,
        expected_revision: input.expected_revision,
        operation_id: input.operation_id,
        action: ScriptJobAction::ApproveRevision {
            revision_id: input.revision_id,
            content_digest: input.content_digest,
            validation_version: input.validation_version,
        },
    })).await
}
