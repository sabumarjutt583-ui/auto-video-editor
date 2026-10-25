/** Runs the steps of "Make video" one after another. The steps themselves are given in, so this file is pure. */

import type { Pauses, StageId } from "./stages.ts";

export type PipelineEvent =
  | { type: "skipped"; stage: StageId }
  | { type: "waiting"; stage: StageId }
  | { type: "start"; stage: StageId }
  | { type: "done"; stage: StageId }
  | { type: "error"; stage: StageId; error: unknown }
  | { type: "stopped"; stage: StageId }
  | { type: "cancelled"; stage: StageId | null }
  | { type: "finished" };

export type PipelineOutcome = "finished" | "stopped" | "failed" | "cancelled";

export interface PipelineOptions {
  stages: readonly StageId[];
  /** True when the step is already finished (it is skipped, nothing is paid twice). */
  isDone: (stage: StageId) => boolean;
  run: (stage: StageId) => Promise<void>;
  pauses: Pauses;
  /** Called before a step that wants a "Continue". Resolves false when the person stops the run. */
  confirm: (stage: StageId) => Promise<boolean>;
  /** The person pressed Cancel. */
  cancelRequested: () => boolean;
  /** True for the error a cancelled job throws. */
  isCancel: (error: unknown) => boolean;
  onEvent: (event: PipelineEvent) => void;
}

/** Thrown into `error` events when a step returned without finishing its work. */
export class IncompleteStage extends Error {
  readonly stage: StageId;

  constructor(stage: StageId) {
    super(`The step "${stage}" ended but its work is not complete.`);
    this.name = "IncompleteStage";
    this.stage = stage;
  }
}

export async function runPipeline(options: PipelineOptions): Promise<PipelineOutcome> {
  const { onEvent } = options;
  for (const stage of options.stages) {
    if (options.cancelRequested()) {
      onEvent({ type: "cancelled", stage });
      return "cancelled";
    }
    if (options.isDone(stage)) {
      onEvent({ type: "skipped", stage });
      continue;
    }
    if (options.pauses[stage]) {
      onEvent({ type: "waiting", stage });
      if (!(await options.confirm(stage))) {
        onEvent({ type: "stopped", stage });
        return "stopped";
      }
    }
    onEvent({ type: "start", stage });
    try {
      await options.run(stage);
    } catch (error) {
      if (options.isCancel(error) || options.cancelRequested()) {
        onEvent({ type: "cancelled", stage });
        return "cancelled";
      }
      onEvent({ type: "error", stage, error });
      return "failed";
    }
    if (!options.isDone(stage)) {
      onEvent({ type: "error", stage, error: new IncompleteStage(stage) });
      return "failed";
    }
    onEvent({ type: "done", stage });
  }
  onEvent({ type: "finished" });
  return "finished";
}
