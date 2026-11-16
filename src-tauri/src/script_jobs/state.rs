//! Allowed local transitions only. The model includes future states for decoding,
//! but no operation can claim a provider response, approved revision, or sent message.
use serde::{Deserialize, Serialize};

use super::model::{digest, PreparedPromptSnapshot, ScriptJobRecord, ScriptJobState, MAX_PROMPT_BYTES};

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ScriptJobAction {
    Prepare {
        prompt_text: String,
        master_prompt_digest: String,
    },
    BeginCopy,
    ConfirmCopy,
    AwaitUserAction { reason: WaitingReason },
    BeginManualSubmission,
    MarkSubmissionUncertain,
    /// Explicit user evidence; never supplied by a provider.
    ConfirmSubmitted,
    ConfirmNotSubmitted,
    /// Exact unmodified Unicode text, saved to an immutable file by store.rs.
    ImportResponse { text: String },
    /// Local-only review stages; no AI calls and no revision edits.
    StartValidation { revision_id: String, content_digest: String },
    CompleteValidation { revision_id: String, content_digest: String },
    BeginReview { revision_id: String, content_digest: String },
    ApproveRevision { revision_id: String, content_digest: String, validation_version: String },
    Cancel,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WaitingReason {
    ManualAction,
    LoginRequired,
    HumanVerification,
    UsageLimit,
}

impl WaitingReason {
    fn as_str(self) -> &'static str {
        match self {
            Self::ManualAction => "manual_action",
            Self::LoginRequired => "login_required",
            Self::HumanVerification => "human_verification",
            Self::UsageLimit => "usage_limit",
        }
    }
}

/// Errors are stable codes only. Never include prompt text in diagnostics.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TransitionError {
    InvalidTransition,
    InvalidPreparedPrompt,
}

pub fn apply_transition(
    job: &mut ScriptJobRecord,
    action: &ScriptJobAction,
    timestamp: &str,
) -> Result<(), TransitionError> {
    use ScriptJobAction as Action;
    use ScriptJobState as State;
    match action {
        Action::Prepare { prompt_text, master_prompt_digest } => {
            if job.state != State::Created { return Err(TransitionError::InvalidTransition); }
            if prompt_text.trim().is_empty() || prompt_text.len() > MAX_PROMPT_BYTES
                || master_prompt_digest != &job.request.master_prompt.content_digest {
                return Err(TransitionError::InvalidPreparedPrompt);
            }
            job.prepared_prompt = Some(PreparedPromptSnapshot {
                request_id: job.request_id.clone(),
                channel_id: job.channel_id.clone(),
                format_version: "script-prompt-v1".into(),
                content: prompt_text.clone(),
                content_digest: digest(prompt_text.as_bytes()),
                master_prompt_digest: master_prompt_digest.clone(),
                prepared_at: timestamp.to_string(),
            });
            job.state = State::Prepared;
        }
        Action::BeginCopy => {
            if !matches!(job.state, State::Prepared | State::AwaitingUserAction)
                { return Err(TransitionError::InvalidTransition); }
            job.state = State::CopyIntent;
            job.recovery_action = None;
        }
        Action::ConfirmCopy => {
            if job.state != State::CopyIntent { return Err(TransitionError::InvalidTransition); }
            job.state = State::Copied;
        }
        Action::AwaitUserAction { reason } => {
            if !matches!(job.state, State::Prepared | State::Copied | State::CopyIntent)
                { return Err(TransitionError::InvalidTransition); }
            job.state = State::AwaitingUserAction;
            job.recovery_action = Some(reason.as_str().to_string());
        }
        Action::BeginManualSubmission => {
            // This records intent only. No external request is ever sent here.
            if !matches!(job.state, State::Copied | State::AwaitingUserAction)
                { return Err(TransitionError::InvalidTransition); }
            job.state = State::SubmissionIntent;
            job.recovery_action = Some("confirm_external_delivery".into());
        }
        Action::MarkSubmissionUncertain => {
            if job.state != State::SubmissionIntent { return Err(TransitionError::InvalidTransition); }
            job.state = State::SubmissionUncertain;
            job.recovery_action = Some("manual_reconciliation_required".into());
        }
        Action::ConfirmSubmitted => {
            if !matches!(job.state, State::SubmissionIntent | State::SubmissionUncertain) {
                return Err(TransitionError::InvalidTransition);
            }
            job.state = State::Submitted;
            job.submission_evidence = Some(super::model::ManualSubmissionEvidence::UserConfirmed);
            job.recovery_action = Some("user_confirmed_submission".into());
        }
        Action::ConfirmNotSubmitted => {
            if !matches!(job.state, State::SubmissionIntent | State::SubmissionUncertain) {
                return Err(TransitionError::InvalidTransition);
            }
            job.state = State::Copied;
            job.submission_evidence = Some(super::model::ManualSubmissionEvidence::UserConfirmedNotSubmitted);
            job.recovery_action = Some("user_confirmed_no_submission".into());
        }
        Action::ImportResponse { text } => {
            if !matches!(job.state, State::Prepared | State::CopyIntent | State::Copied
                | State::AwaitingUserAction | State::SubmissionIntent
                | State::SubmissionUncertain | State::Submitted) {
                return Err(TransitionError::InvalidTransition);
            }
            if text.trim().is_empty() || text.len() > super::model::MAX_IMPORT_BYTES
                || text.contains('\0') { return Err(TransitionError::InvalidPreparedPrompt); }
            // The store must write and sync the revision file BEFORE publishing
            // the state checkpoint; do not mark imported content here.
            job.state = State::ResponseReceived;
            job.recovery_action = Some("manual_response_imported_unreviewed".into());
        }
        Action::StartValidation { revision_id, content_digest } => {
            if job.state != State::ResponseReceived || job.revisions.len() != 1
                || job.revisions[0].revision_id != *revision_id
                || job.revisions[0].content_digest != *content_digest {
                return Err(TransitionError::InvalidTransition);
            }
            job.state = State::Validating;
        }
        Action::CompleteValidation { revision_id, content_digest } => {
            if job.state != State::Validating || job.revisions.len() != 1
                || job.revisions[0].revision_id != *revision_id
                || job.revisions[0].content_digest != *content_digest {
                return Err(TransitionError::InvalidTransition);
            }
            // Store recomputes a deterministic report from verified bytes before commit.
            job.state = State::DraftSaved;
        }
        Action::BeginReview { revision_id, content_digest } => {
            if job.state != State::DraftSaved || job.revisions.len() != 1
                || job.revisions[0].revision_id != *revision_id
                || job.revisions[0].content_digest != *content_digest
                || job.review_report.is_none() {
                return Err(TransitionError::InvalidTransition);
            }
            job.state = State::ReviewPending;
        }
        Action::ApproveRevision { revision_id, content_digest, validation_version } => {
            let report = job.review_report.as_ref().ok_or(TransitionError::InvalidTransition)?;
            if job.state != State::ReviewPending || job.revisions.len() != 1
                || job.revisions[0].revision_id != *revision_id
                || job.revisions[0].content_digest != *content_digest
                || report.revision_id != *revision_id
                || report.content_digest != *content_digest
                || report.validation_version != *validation_version
                || super::validation::has_technical_errors(report) {
                return Err(TransitionError::InvalidTransition);
            }
            job.approved_revision_id = Some(revision_id.clone());
            job.approval_record = Some(super::model::ScriptApprovalRecord {
                revision_id: revision_id.clone(),
                content_digest: content_digest.clone(),
                validation_version: validation_version.clone(),
                approved_at: timestamp.into(),
                source: "user_confirmed".into(),
            });
            job.state = State::Approved;
        }
        Action::Cancel => {
            // Once external submission intent exists, cancellation cannot assert
            // that an external message was not delivered.
            if !matches!(job.state, State::Created | State::Prepared | State::CopyIntent
                    | State::Copied | State::AwaitingUserAction) {
                return Err(TransitionError::InvalidTransition);
            }
            job.state = State::Cancelled;
            job.recovery_action = Some("cancelled_locally".into());
        }
    }
    Ok(())
}
