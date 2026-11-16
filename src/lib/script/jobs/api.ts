/** Opt-in Phase 03C commands only; no Zustand subscription and no invocation
 * during app initialization or existing Script Writer generation. */
import { invoke } from "@tauri-apps/api/core";

import type { ScriptGenerationRequest } from "../core/types.ts";
import type {
  DurableScriptJobV1, ScriptJobCommandError, ScriptJobRecoveryReport,
  PrepareScriptJobInput, LocalScriptJobTransitionInput, JobTransitionIdentity,
  ScriptJobStoreErrorCode, ImportScriptResponseInput, ReadImportedScriptInput,
  ImportedScriptResponse, ReviewScriptJobInput, ApproveScriptJobInput,
  CreateManualRevisionInput, SelectScriptRevisionInput, ReadScriptRevisionsInput,
  CompareScriptRevisionsInput, ImportedScriptRevisionRef, ScriptRevisionComparison,
} from "./types.ts";

export const createScriptJob = (request: ScriptGenerationRequest): Promise<DurableScriptJobV1> =>
  invoke<DurableScriptJobV1>("script_job_create", { request });
export const getScriptJob = (jobId: string): Promise<DurableScriptJobV1> =>
  invoke<DurableScriptJobV1>("script_job_get", { jobId });
export const listScriptJobs = (): Promise<ScriptJobRecoveryReport> =>
  invoke<ScriptJobRecoveryReport>("script_job_list");
export const recoverScriptJobs = (): Promise<ScriptJobRecoveryReport> =>
  invoke<ScriptJobRecoveryReport>("script_job_recovery");
export const prepareScriptJob = (input: PrepareScriptJobInput): Promise<DurableScriptJobV1> =>
  invoke<DurableScriptJobV1>("script_job_prepare", { input });
export const transitionScriptJob = (input: LocalScriptJobTransitionInput): Promise<DurableScriptJobV1> =>
  invoke<DurableScriptJobV1>("script_job_transition", { input });
export const cancelScriptJob = (input: JobTransitionIdentity): Promise<DurableScriptJobV1> =>
  invoke<DurableScriptJobV1>("script_job_cancel", { input });
export const importScriptResponse = (input: ImportScriptResponseInput): Promise<DurableScriptJobV1> =>
  invoke<DurableScriptJobV1>("script_job_import_response", { input });
export const readImportedScript = (input: ReadImportedScriptInput): Promise<ImportedScriptResponse> =>
  invoke<ImportedScriptResponse>("script_job_read_response", { input });
export const startScriptValidation = (input: ReviewScriptJobInput): Promise<DurableScriptJobV1> =>
  invoke<DurableScriptJobV1>("script_job_start_validation", { input });
export const completeScriptValidation = (input: ReviewScriptJobInput): Promise<DurableScriptJobV1> =>
  invoke<DurableScriptJobV1>("script_job_complete_validation", { input });
export const beginScriptReview = (input: ReviewScriptJobInput): Promise<DurableScriptJobV1> =>
  invoke<DurableScriptJobV1>("script_job_begin_review", { input });
/** Requires a direct UI action and exact committed revision/validation version. */
export const approveScriptRevision = (input: ApproveScriptJobInput): Promise<DurableScriptJobV1> =>
  invoke<DurableScriptJobV1>("script_job_approve", { input });
export const createManualRevision = (input: CreateManualRevisionInput): Promise<DurableScriptJobV1> =>
  invoke<DurableScriptJobV1>("script_job_create_revision", { input });
export const selectScriptRevision = (input: SelectScriptRevisionInput): Promise<DurableScriptJobV1> =>
  invoke<DurableScriptJobV1>("script_job_select_revision", { input });
export const listSavedScriptRevisions = (input: ReadScriptRevisionsInput): Promise<readonly ImportedScriptRevisionRef[]> =>
  invoke<readonly ImportedScriptRevisionRef[]>("script_job_list_revisions", { input });
export const compareSavedScriptRevisions = (input: CompareScriptRevisionsInput): Promise<ScriptRevisionComparison> =>
  invoke<ScriptRevisionComparison>("script_job_compare_revisions", { input });

const CODES: readonly ScriptJobStoreErrorCode[] = [
  "invalid_request", "invalid_job_id", "request_conflict", "writer_busy",
  "storage_failure", "recovery_blocked", "job_not_found", "corrupt_record",
  "unsupported_version", "stale_revision", "invalid_transition",
  "invalid_operation", "operation_conflict", "operation_history_full",
  "invalid_response", "revision_not_found", "comparison_too_large",
];

/** Tauri may reject with a structured error, a string, or a transport error.
 * Only recognize explicitly validated safe typed job errors. */
export function parseScriptJobCommandError(error: unknown): ScriptJobCommandError | null {
  if (typeof error !== "object" || error === null || Array.isArray(error)) return null;
  const candidate = error as Record<string, unknown>;
  if (typeof candidate.code !== "string" || !CODES.includes(candidate.code as ScriptJobStoreErrorCode)
    || typeof candidate.message !== "string") return null;
  return { code: candidate.code as ScriptJobStoreErrorCode, message: candidate.message };
}
