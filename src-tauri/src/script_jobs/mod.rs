//! Durable local Script Writer job foundation (Phase 03B). Not connected to providers or UI.
mod lock;
mod model;
mod store;
mod state;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod state_tests;

pub use model::{MasterPromptSnapshot, ProviderMode, ScriptGenerationRequest, ScriptJobRecord, ScriptJobState, PreparedPromptSnapshot, AppliedJobOperation};
pub use store::{RecoveryIssue, RecoveryKind, RecoveryReport, ScriptJobStore, StoreError, StoreErrorCode, JobMutation};
pub use state::{ScriptJobAction, WaitingReason};
