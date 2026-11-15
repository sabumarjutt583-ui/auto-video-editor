//! Durable local Script Writer job foundation (Phase 03B). Not connected to providers or UI.
mod lock;
mod model;
mod store;
#[cfg(test)]
mod tests;

pub use model::{MasterPromptSnapshot, ProviderMode, ScriptGenerationRequest, ScriptJobRecord, ScriptJobState};
pub use store::{RecoveryIssue, RecoveryKind, RecoveryReport, ScriptJobStore, StoreError, StoreErrorCode};
