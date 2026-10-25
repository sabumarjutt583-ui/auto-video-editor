/** What the run screen shows: one row per step. A pure reducer over the runner's events. */

import type { PipelineEvent } from "./runner.ts";
import { STAGE_IDS, type StageId } from "./stages.ts";

export type RowState = "pending" | "skipped" | "waiting" | "running" | "done" | "error";

export interface StageRow {
  id: StageId;
  state: RowState;
  /** A short line from the step ("Pictures: 12 of 40 done"). */
  detail: string;
  error: unknown;
}

export interface RunView {
  rows: StageRow[];
  /** "idle" before the first start. */
  status: "idle" | "running" | "finished" | "failed" | "stopped" | "cancelled";
}

export function initialView(stages: readonly StageId[] = STAGE_IDS): RunView {
  return { rows: stages.map((id) => ({ id, state: "pending", detail: "", error: null })), status: "idle" };
}

function setRow(view: RunView, stage: StageId, patch: Partial<StageRow>): RunView {
  return { ...view, rows: view.rows.map((row) => (row.id === stage ? { ...row, ...patch } : row)) };
}

export function reduceView(view: RunView, event: PipelineEvent): RunView {
  switch (event.type) {
    case "skipped":
      return setRow({ ...view, status: "running" }, event.stage, { state: "skipped", detail: "Already done", error: null });
    case "waiting":
      return setRow({ ...view, status: "running" }, event.stage, { state: "waiting", detail: "Waiting for you", error: null });
    case "start":
      return setRow({ ...view, status: "running" }, event.stage, { state: "running", detail: "", error: null });
    case "done":
      return setRow(view, event.stage, { state: "done", detail: "" });
    case "error":
      return setRow({ ...view, status: "failed" }, event.stage, { state: "error", error: event.error });
    case "stopped":
      return setRow({ ...view, status: "stopped" }, event.stage, { state: "pending", detail: "Stopped before this step" });
    case "cancelled":
      return { ...(event.stage ? setRow(view, event.stage, { state: "pending", detail: "Cancelled" }) : view), status: "cancelled" };
    case "finished":
      return { ...view, status: "finished" };
  }
}

/** Shows a line from the running step. */
export function withDetail(view: RunView, stage: StageId, detail: string): RunView {
  return setRow(view, stage, { detail });
}

/** Before a new try: the rows that failed or stopped go back to pending, finished rows stay. */
export function restart(view: RunView): RunView {
  return {
    status: "running",
    rows: view.rows.map((row) => (row.state === "done" || row.state === "skipped" ? row : { ...row, state: "pending", detail: "", error: null })),
  };
}

/** The share of steps that are finished, 0 to 100. */
export function percentDone(view: RunView): number {
  const done = view.rows.filter((row) => row.state === "done" || row.state === "skipped").length;
  return view.rows.length === 0 ? 0 : Math.round((done / view.rows.length) * 100);
}
