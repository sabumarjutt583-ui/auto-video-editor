import { validateManualResponse } from "./manual.ts";
import { currentSelectedScriptRevision } from "./review.ts";
import type { DurableScriptJobV1, ScriptRevisionComparison } from "./types.ts";

const reviewable = new Set<DurableScriptJobV1["state"]>([
  "response_received", "validating", "draft_saved", "review_pending", "approved",
]);

/** UI eligibility only: Rust still validates job owner, CAS, operation ID and text. */
export function canCreateScriptRevision(job: DurableScriptJobV1, originId: string, text: unknown): boolean {
  return reviewable.has(job.state)
    && job.revisions.length > 0 && job.revisions.length < 64
    && Boolean(currentSelectedScriptRevision(job))
    && job.revisions.some(revision => revision.revisionId === originId)
    && validateManualResponse(text).valid;
}

/** Selecting historical approval never makes it active: Rust resets review state. */
export function canSelectScriptRevision(job: DurableScriptJobV1, revisionId: string): boolean {
  const active = currentSelectedScriptRevision(job);
  return reviewable.has(job.state) && Boolean(active)
    && revisionId !== active?.revisionId
    && job.revisions.some(revision => revision.revisionId === revisionId);
}

export function summarizeScriptRevisionDiff(diff: ScriptRevisionComparison): {
  readonly addedLines: number;
  readonly removedLines: number;
  readonly unchangedLines: number;
} {
  return {
    addedLines: diff.lines.filter(line => line.kind === "added").length,
    removedLines: diff.lines.filter(line => line.kind === "removed").length,
    unchangedLines: diff.lines.filter(line => line.kind === "unchanged").length,
  };
}
