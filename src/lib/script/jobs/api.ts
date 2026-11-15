/** Opt-in Phase 03C commands only; no Zustand subscription and no invocation
 * during app initialization or existing Script Writer generation. */
import { invoke } from "@tauri-apps/api/core";

import type { ScriptGenerationRequest } from "../core/types.ts";
import type {
  DurableScriptJobV1, ScriptJobCommandError, ScriptJobRecoveryReport,
  PrepareScriptJobInput, LocalScriptJobTransitionInput, JobTransitionIdentity,
  ScriptJobStoreErrorCode,
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

const CODES: readonly ScriptJobStoreErrorCode[] = [
  "invalid_request", "invalid_job_id", "request_conflict", "writer_busy",
  "storage_failure", "recovery_blocked", "job_not_found", "corrupt_record",
  "unsupported_version", "stale_revision", "invalid_transition",
  "invalid_operation", "operation_conflict", "operation_history_full",
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
