/** What the run screen shows after a "Make video" run (Phase 4): one summary, worked out from the
run view, so a page can show the result without reading the store's internals. Pure data only — no
component, no navigation, no account use. The finished video itself is still opened from the
project, as today; this file only names the result and the next step in plain words.

Multi-account note: "Make video" still runs one project at a time in the store; parallel work across
accounts already lives in the image engine's video queue (one video per ready account). So this file
only summarises account readiness (how many accounts can work now, and when the next one is back),
it does not start a multi-account run — a parallel multi-project run would need a new run model and
is later work, not claimed here. */

import { STAGE_IDS, type StageId } from "./stages.ts";
import { percentDone, type RunView } from "./view.ts";

/** The finished video, in the same shape the store already reports (kept local so this file does not
import the store, which needs the app runtime). */
export interface FinishedVideo {
  path: string;
  copyPath: string | null;
  seconds: number;
  sizeBytes: number;
}

export interface RunSummary {
  /** The run's own status. */
  status: RunView["status"];
  /** 0 to 100, from the finished steps. */
  percent: number;
  /** The step that failed, when one did. */
  failedStage: StageId | null;
  /** The step waiting for "Continue", when one is. */
  waitingStage: StageId | null;
  /** The finished video, when the run finished one. */
  finished: FinishedVideo | null;
  /** The next step for the person, in plain words. */
  nextAction: string;
}

export function runSummary(view: RunView, finished: FinishedVideo | null): RunSummary {
  const failedStage = view.rows.find((row) => row.state === "error")?.id ?? null;
  const waitingStage = view.rows.find((row) => row.state === "waiting")?.id ?? null;
  let nextAction: string;
  if (view.status === "finished" && finished) nextAction = "Open the finished video.";
  else if (view.status === "finished") nextAction = "The video is finished.";
  else if (waitingStage) nextAction = `Press Continue for ${waitingStage}.`;
  else if (failedStage) nextAction = "Fix the failed step, then resume.";
  else if (view.status === "stopped") nextAction = "Resume when you are ready.";
  else if (view.status === "cancelled") nextAction = "Start again when you are ready.";
  else if (view.status === "running") nextAction = "Wait for the run to finish.";
  else nextAction = "Start making the video.";
  return { status: view.status, percent: percentDone(view), failedStage, waitingStage, finished, nextAction };
}

/** One account's video readiness, in the same shape the image engine's video status reports. */
export interface AccountReadiness {
  id: string;
  /** True when this account can make a video now. */
  ready: boolean;
  /** Epoch ms this account is back, 0 when it is ready now. */
  backAt: number;
}

export interface AccountsSummary {
  ready: number;
  resting: number;
  /** True when at least one account can work now. */
  canRun: boolean;
  /** The soonest back time of a resting account, 0 when none is resting. */
  backAt: number;
}

/** How many accounts can work now, and when the next one is back (the soonest back time). */
export function accountsSummary(accounts: readonly AccountReadiness[]): AccountsSummary {
  const ready = accounts.filter((account) => account.ready).length;
  const resting = accounts.length - ready;
  const backTimes = accounts.filter((account) => !account.ready && account.backAt > 0).map((account) => account.backAt);
  return { ready, resting, canRun: ready > 0, backAt: backTimes.length > 0 ? Math.min(...backTimes) : 0 };
}

/** True when every step of the run is finished or skipped. */
export function allStagesDone(view: RunView): boolean {
  return view.rows.length > 0 && view.rows.every((row) => row.state === "done" || row.state === "skipped");
}

/** The steps in pipeline order that are not finished yet — the shape a "continue" list needs. */
export function remainingStages(view: RunView): StageId[] {
  const done = new Set(view.rows.filter((row) => row.state === "done" || row.state === "skipped").map((row) => row.id));
  return STAGE_IDS.filter((id) => !done.has(id));
}
