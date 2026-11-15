/** Phase 03B read-only transport types; Rust owns all durable writes.
 * No Zustand integration or Tauri commands are exposed yet. */
import type { ScriptGenerationRequest } from "../core/types.ts";

export type DurableScriptJobState = "created";
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
  readonly preparedPrompt: string | null;
  readonly revisions: readonly string[];
  readonly approvedRevisionId: string | null;
  readonly errorCode: string | null;
  readonly recoveryAction: string | null;
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
