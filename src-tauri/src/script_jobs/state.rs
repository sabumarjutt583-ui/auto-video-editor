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
