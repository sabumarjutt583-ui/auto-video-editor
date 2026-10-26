/** Approval for "Make video" steps (Phase 4). A pure state machine over the steps, nothing here runs a step.

How it connects to what already exists: the runner already stops at a step when the profile has a
pause for it (`pauses` in `stages.ts`) and waits for "Continue" (`confirm` in `runner.ts`, the
store's `answer` in `pipelineStore.ts`). This file only names that decision, so a step can be
approved, rejected (Stop pressed at its pause), or marked needs-attention (it failed) — and so the
run screen can show it. Steps without a pause never need an approval: the one-click happy path is
unchanged, because `isApprovedFor` returns true for them whatever the state says. */

import { STAGE_IDS, type Pauses, type StageId } from "./stages.ts";
import type { RunView } from "./view.ts";

/** "pending" = not decided yet (or waiting at its pause). "approved" = may run / already ran. */
export type ApprovalStatus = "pending" | "approved" | "rejected" | "needs-attention";

export type ApprovalState = Record<StageId, ApprovalStatus>;

/** Every step starts undecided. Unpaused steps still count as approved by `isApprovedFor`. */
export function initialApprovals(): ApprovalState {
  return Object.fromEntries(STAGE_IDS.map((id) => [id, "pending" as ApprovalStatus])) as ApprovalState;
}

/** One decision changed, everything else kept. */
export function setApproval(state: ApprovalState, stage: StageId, status: ApprovalStatus): ApprovalState {
  return { ...state, [stage]: status };
}

/** "Continue" at a pause. */
export function approve(state: ApprovalState, stage: StageId): ApprovalState {
  return setApproval(state, stage, "approved");
}

/** "Stop" at a pause. */
export function reject(state: ApprovalState, stage: StageId): ApprovalState {
  return setApproval(state, stage, "rejected");
}

/** A step failed and needs a look before it runs again. */
export function markNeedsAttention(state: ApprovalState, stage: StageId): ApprovalState {
  return setApproval(state, stage, "needs-attention");
}

/** True when the step may run: no pause for it, or it was approved. */
export function isApprovedFor(state: ApprovalState, pauses: Pauses, stage: StageId): boolean {
  return !pauses[stage] || state[stage] === "approved";
}

/** Steps that failed, in pipeline order. */
export function stagesNeedingAttention(state: ApprovalState): StageId[] {
  return STAGE_IDS.filter((id) => state[id] === "needs-attention");
}

/** The first paused step that is still waiting for a decision, or null when none is waiting. */
export function nextWaitingApproval(state: ApprovalState, pauses: Pauses): StageId | null {
  return STAGE_IDS.find((id) => pauses[id] && state[id] === "pending") ?? null;
}

/** Reads the approval of every step out of a run view, so the store never has to keep a second copy:
waiting = pending, running/done/skipped = approved (a running step already passed its pause),
error = needs-attention, the step a run stopped at = rejected, everything else = pending. */
export function approvalFromView(view: RunView): ApprovalState {
  const state = initialApprovals();
  for (const row of view.rows) {
    switch (row.state) {
      case "waiting":
        state[row.id] = "pending";
        break;
      case "running":
      case "done":
      case "skipped":
        state[row.id] = "approved";
        break;
      case "error":
        state[row.id] = "needs-attention";
        break;
      default:
        break;
    }
  }
  if (view.status === "stopped") {
    const stopped = view.rows.find((row) => row.detail === "Stopped before this step");
    if (stopped) state[stopped.id] = "rejected";
  }
  return state;
}
