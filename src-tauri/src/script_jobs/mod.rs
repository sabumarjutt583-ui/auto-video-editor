//! Durable local Script Writer job foundation (Phase 03B). Not connected to providers or UI.
mod lock;
mod model;
mod store;
mod state;
mod validation;
mod comparison;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod state_tests;

pub use model::{MasterPromptSnapshot, ProviderMode, ScriptGenerationRequest, ScriptJobRecord, ScriptJobState, PreparedPromptSnapshot, AppliedJobOperation, ScriptValidationFinding, ScriptValidationReport, ScriptApprovalRecord, ValidationSeverity};
pub use store::{RecoveryIssue, RecoveryKind, RecoveryReport, ScriptJobStore, StoreError, StoreErrorCode, JobMutation, ImportedScriptResponse};
pub use state::{ScriptJobAction, WaitingReason};
pub use model::ScriptRevisionRef;
pub use comparison::ScriptRevisionComparison;
