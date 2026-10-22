/** Manual (copy and paste) mode: the same messages the web chat would send, answered by hand in any AI chat. */

import type { Scene } from "../../../types/project.ts";
import type { PromptContext } from "../generate.ts";
import { buildBatchMessage, buildMissingMessage, buildSetupMessage, DEFAULT_BATCH, planChatGroups } from "./messages.ts";
import { parseFullBatch } from "./parse.ts";
import { applyItems } from "./runner.ts";

export interface ManualStep {
  id: string;
  kind: "setup" | "batch";
  title: string;
  message: string;
  /** Scene ids of a batch (empty for the setup). */
  ids: string[];
}

/** Setup first, then one step per batch of the scenes that still need a prompt. */
export function planManual(context: PromptContext, all: readonly Scene[], targetIds: ReadonlySet<string>, tag: string, size = DEFAULT_BATCH): ManualStep[] {
  const targets = all.filter((s) => targetIds.has(s.id));
  const groups = planChatGroups(targets, context, all, size);
  const steps: ManualStep[] = [{ id: `${tag}-SETUP1`, kind: "setup", title: "Message 1: Setup (send this first, wait for READY)", message: buildSetupMessage(context), ids: [] }];
  groups.forEach((group, i) => {
    const id = `${tag}-B${String(i + 1).padStart(2, "0")}`;
    const first = all.findIndex((s) => s.id === group[0]?.id);
    steps.push({
      id,
      kind: "batch",
      title: `Batch ${i + 1} of ${groups.length}: ${group[0]?.id ?? ""} to ${group[group.length - 1]?.id ?? ""}`,
      message: buildBatchMessage(id, context, group, all.slice(0, Math.max(0, first))),
      ids: group.map((s) => s.id),
    });
  });
  return steps;
}

export interface ManualResult {
  scenes: Scene[];
  /** Ids stored by this answer. */
  applied: string[];
  missing: string[];
  extra: string[];
  readable: boolean;
  /** A message to copy for the missing ids (only when some are missing). */
  followUp: string | null;
}

/** Reads a pasted answer for a batch: parses, verifies, repairs and stores what it finds; reports what is missing or extra. */
export function applyManualAnswer(step: ManualStep, answer: string, all: readonly Scene[], context: PromptContext): ManualResult {
  const parsed = parseFullBatch(answer, step.ids);
  const stored = applyItems(all, parsed.items, context);
  const missingScenes = all.filter((s) => parsed.missing.includes(s.id));
  const first = all.findIndex((s) => s.id === missingScenes[0]?.id);
  return {
    scenes: stored.scenes,
    applied: parsed.items.map((i) => i.id),
    missing: parsed.missing,
    extra: parsed.extra,
    readable: parsed.readable,
    followUp: missingScenes.length > 0 ? buildMissingMessage(`${step.id}-M1`, context, missingScenes, all.slice(0, Math.max(0, first))) : null,
  };
}
