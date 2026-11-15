/** Phase 03B read-only transport types; Rust owns all durable writes.
 * No Zustand integration or Tauri commands are exposed yet. */
import type { ScriptGenerationRequest } from "../core/types.ts";

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
  readonly revisions: readonly string[];
  readonly approvedRevisionId: string | null;
  readonly errorCode: string | null;
  readonly recoveryAction: string | null;
  /** Absent in valid Phase 03B v1 files; serialized after first transition. */
  readonly appliedOperations?: readonly AppliedScriptJobOperation[];
}

export type ScriptJobRecoveryKind =
  | "corrupt_record" | "unsupported_version" | "incomplete_record"
  | "unsafe_entry" | "io_error" | "duplicate_request";

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
  | "invalid_operation" | "operation_conflict" | "operation_history_full";

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
  | { readonly type: "mark_submission_uncertain" };
export interface LocalScriptJobTransitionInput extends JobTransitionIdentity {
  readonly action: LocalScriptJobAction;
}
