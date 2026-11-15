/** Pure manual-job sequencing helpers: no Tauri, clipboard, browser or network imports. */
import type { DurableScriptJobV1, LocalScriptJobAction } from "./types.ts";

export const MAX_MANUAL_RESPONSE_BYTES = 2_097_152;
export type ManualResponseValidation =
  | { readonly valid: true; readonly bytes: number }
  | { readonly valid: false; readonly code: "empty_response" | "invalid_response" | "response_too_large" };

export function validateManualResponse(value: unknown): ManualResponseValidation {
  if (typeof value !== "string" || value.includes("\u0000")) {
    return { valid: false, code: "invalid_response" };
  }
  if (!value.trim()) return { valid: false, code: "empty_response" };
  const bytes = new TextEncoder().encode(value).length;
  if (bytes > MAX_MANUAL_RESPONSE_BYTES) {
    return { valid: false, code: "response_too_large" };
  }
  return { valid: true, bytes };
}
export interface ManualCopyOutcome {
  readonly saved: DurableScriptJobV1;
  readonly copied: boolean;
}
/** The saved copy_intent MUST finish before a clipboard call starts.
 * The follow-up "copied" transition occurs only when the actual copy reports success.
 * If clipboard access throws or returns manual, preserve copy_intent for user review.
 */
export async function copyPreparedPromptWithCheckpoint(
  job: DurableScriptJobV1,
  transition: (current: DurableScriptJobV1, action: LocalScriptJobAction) => Promise<DurableScriptJobV1>,
  copy: (text: string) => Promise<"copied" | "manual">,
): Promise<ManualCopyOutcome> {
  if (!job.preparedPrompt || !["prepared", "awaiting_user_action"].includes(job.state)) {
    throw new Error("Cannot copy an unprepared or already-submitted job.");
  }
  const started = await transition(job, { type: "begin_copy" });
  if (started.state !== "copy_intent" || !started.preparedPrompt) {
    throw new Error("Copy intent was not durably acknowledged.");
  }
  let copied: "copied" | "manual";
  try { copied = await copy(started.preparedPrompt.content); }
  catch { copied = "manual"; }
  if (copied !== "copied") return { saved: started, copied: false };
  const confirmed = await transition(started, { type: "confirm_copy" });
  if (confirmed.state !== "copied") throw new Error("Copy confirmation was not committed.");
  return { saved: confirmed, copied: true };
}
