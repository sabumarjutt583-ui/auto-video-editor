/** Phase 03B read-only transport types; Rust owns all durable writes.
 * No Zustand integration or Tauri commands are exposed yet. */
import type { ScriptGenerationRequest } from "../core/types.ts";

export interface ImportedScriptRevisionRef {
  readonly revisionId: string;
  readonly contentDigest: string;
  readonly byteLength: number;
  readonly createdAt: string;
  readonly source: "manual_import";
  /** Absent in original Phase 03D imported revisions. */
  readonly originRevisionId?: string | null;
}
export type ManualSubmissionEvidence = "user_confirmed" | "user_confirmed_not_submitted";
export interface ImportedScriptResponse {
  readonly revision: ImportedScriptRevisionRef;
  readonly text: string;
}
export type ScriptFindingSeverity = "error" | "warning";
export interface ScriptValidationFinding {
  readonly code: string;
  readonly severity: ScriptFindingSeverity;
  readonly message: string;
}
export interface ScriptValidationReport {
  readonly validationVersion: "script-rules-v1";
  readonly revisionId: string;
  readonly contentDigest: string;
  readonly actualWordCount: number;
  readonly requestedWordCount: number | null;
  readonly findings: readonly ScriptValidationFinding[];
}
export interface ScriptApprovalRecord {
  readonly revisionId: string;
  readonly contentDigest: string;
  readonly validationVersion: "script-rules-v1";
  readonly approvedAt: string;
  readonly source: "user_confirmed";
}
export type DurableScriptJobState =
  | "created" | "prepared" | "awaiting_user_action" | "copy_intent" | "copied"
  | "submission_intent" | "submission_uncertain" | "submitted"
  | "awaiting_response" | "response_received" | "validating"
  | "draft_saved" | "review_pending" | "approved" | "failed" | "cancelled";

/** Additional lifecycle states are reserved for future schema revisions;
 * Phase 03C implements only local states through submission_uncertain/cancelled. */
export interface PreparedScriptPromptSnapshot {
  readonly requestId: string;
  readonly channelId: string;
  readonly formatVersion: "script-prompt-v1";
  readonly content: string;
  readonly contentDigest: string;
  readonly masterPromptDigest: string;
  readonly preparedAt: string;
}
export interface AppliedScriptJobOperation {
  readonly operationId: string;
  readonly actionDigest: string;
  readonly expectedRevision: number;
  readonly resultRevision: number;
  readonly resultState: DurableScriptJobState;
}

export type DurableScriptGenerationRequest =
  Omit<ScriptGenerationRequest, "projectId"> & { readonly projectId: string | null };

export interface DurableScriptJobV1 {
  readonly schemaVersion: 1;
  readonly jobId: string;
  readonly requestId: string;
  readonly channelId: string;
  readonly projectId: string | null;
  readonly request: DurableScriptGenerationRequest;
  readonly requestDigest: string;
  readonly state: DurableScriptJobState;
  readonly stateRevision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly preparedPrompt: PreparedScriptPromptSnapshot | null;
  readonly revisions: readonly ImportedScriptRevisionRef[];
  readonly approvedRevisionId: string | null;
  readonly errorCode: string | null;
  readonly recoveryAction: string | null;
  /** Absent in valid Phase 03B v1 files; serialized after first transition. */
  readonly appliedOperations?: readonly AppliedScriptJobOperation[];
  /** Missing from valid Phase 03B/C snapshots. User-confirmed, never provider-confirmed. */
  readonly submissionEvidence?: ManualSubmissionEvidence | null;
  /** Absent from all valid Phase 03B/C/D snapshots until a review exists. */
  readonly reviewReport?: ScriptValidationReport | null;
  readonly approvalRecord?: ScriptApprovalRecord | null;
  /** Legacy single-revision snapshots omit selectedRevisionId. */
  readonly selectedRevisionId?: string | null;
  readonly validationHistory?: readonly ScriptValidationReport[];
  readonly approvalHistory?: readonly ScriptApprovalRecord[];
}

export type ScriptJobRecoveryKind =
  | "corrupt_record" | "unsupported_version" | "incomplete_record"
  | "unsafe_entry" | "io_error" | "duplicate_request"
  | "orphan_revision";

export interface ScriptJobRecoveryIssue {
  readonly jobId: string;
  readonly kind: ScriptJobRecoveryKind;
  readonly message: string;
}
export interface ScriptJobRecoveryReport {
  readonly jobs: readonly DurableScriptJobV1[];
  readonly issues: readonly ScriptJobRecoveryIssue[];
}

export type ScriptJobStoreErrorCode =
  | "invalid_request" | "invalid_job_id" | "request_conflict" | "writer_busy"
  | "storage_failure" | "recovery_blocked" | "job_not_found" | "corrupt_record"
  | "unsupported_version" | "stale_revision" | "invalid_transition"
  | "invalid_operation" | "operation_conflict" | "operation_history_full"
  | "invalid_response" | "revision_not_found" | "comparison_too_large";

export interface ScriptJobCommandError {
  readonly code: ScriptJobStoreErrorCode;
  readonly message: string;
}
export interface JobTransitionIdentity {
  readonly jobId: string;
  readonly channelId: string;
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly operationId: string;
}
export interface PrepareScriptJobInput extends JobTransitionIdentity {
  readonly promptText: string;
  readonly masterPromptDigest: string;
}
export type ScriptJobWaitingReason = "manual_action" | "login_required" | "human_verification" | "usage_limit";
export type LocalScriptJobAction =
  | { readonly type: "begin_copy" }
  | { readonly type: "confirm_copy" }
  | { readonly type: "await_user_action"; readonly reason: ScriptJobWaitingReason }
  | { readonly type: "begin_manual_submission" }
  | { readonly type: "mark_submission_uncertain" }
  | { readonly type: "confirm_submitted" }
  | { readonly type: "confirm_not_submitted" };
export interface LocalScriptJobTransitionInput extends JobTransitionIdentity {
  readonly action: LocalScriptJobAction;
}

// Phase 03D: text can only enter the Rust store via this explicit mutation.
export interface ImportScriptResponseInput extends JobTransitionIdentity {
  readonly text: string;
}
export interface ReadImportedScriptInput {
  readonly jobId: string;
  readonly channelId: string;
  readonly requestId: string;
  readonly revisionId: string;
}

/** Local-only review operations; Rust checks exact revision and channel owner. */
export interface ReviewScriptJobInput extends JobTransitionIdentity {
  readonly revisionId: string;
  readonly contentDigest: string;
}
/** Separate explicit approval; never a generic state setter. */
export interface ApproveScriptJobInput extends ReviewScriptJobInput {
  readonly validationVersion: "script-rules-v1";
}

/** Rust-owned and idempotent manual-version mutation. */
export interface CreateManualRevisionInput extends JobTransitionIdentity {
  readonly originRevisionId: string;
  readonly text: string;
}
export interface SelectScriptRevisionInput extends JobTransitionIdentity {
  readonly revisionId: string;
}
export interface ReadScriptRevisionsInput {
  readonly jobId: string;
  readonly channelId: string;
  readonly requestId: string;
}
export interface CompareScriptRevisionsInput extends ReadScriptRevisionsInput {
  readonly revisionA: string;
  readonly revisionB: string;
}
export type ScriptDiffKind = "unchanged" | "added" | "removed";
export interface ScriptRevisionDiffLine {
  readonly kind: ScriptDiffKind;
  readonly text: string;
}
export interface ScriptRevisionComparison {
  readonly revisionA: ImportedScriptRevisionRef;
  readonly revisionB: ImportedScriptRevisionRef;
  readonly wordCountA: number;
  readonly wordCountB: number;
  readonly lines: readonly ScriptRevisionDiffLine[];
}
