/** The brother tool's 7-step display, mapped onto this tool's steps (pure).

The brother tool shows: Script Writing, Voice Generation, SRT Generation, Image Prompts,
Image Generation, Video Editing, Export & Verify. Script Writing is Step 0 here: it is
its own step, written before the runner starts (typed in, or written by Claude from the
channel's master prompt), and it is NOT folded into Scenes any more. Its row is driven
by whether the project has a saved script (`hasScript` on the summary, or a run that
has started, since a run cannot start without a script or an own voice file):

- Script Writing = the saved script itself (Step 0).
- Voice Generation = Voice, SRT Generation = Word timing (the word times become the captions).
- Image Prompts = Characters and places AND Prompts. The character/place bible has to be
  locked before a prompt can be written in the channel's style, so both count for this step.
- Image Generation = Pictures, Video Editing = Music and sounds (the mix is the last editing
  assembly), Export & Verify = Final video (the finished MP4 exists).

The pause-for-review toggles use the same folding for the runner steps: "Approve Image
Prompts" covers both the bible and the prompts, so ticking it pauses both and unticking
it pauses neither. "Approve Script" still pauses the Scenes runner step — the first
runner step that uses the script — while the script itself is reviewed in Step 0 before
"Make video" is pressed at all, so the script is always seen before it is used. */

import type { ProjectSummary } from "../../types/project.ts";
import { stageProgress } from "./dashboard.ts";
import type { Pauses, StageId } from "./stages.ts";
import type { RowState, RunView } from "./view.ts";

export type SevenStepId = "script" | "voice" | "srt" | "imagePrompts" | "images" | "videoEditing" | "exportVerify";

export interface SevenStepInfo {
  id: SevenStepId;
  label: string;
}

export const SEVEN_STEPS: readonly SevenStepInfo[] = [
  { id: "script", label: "Script Writing" },
  { id: "voice", label: "Voice Generation" },
  { id: "srt", label: "SRT Generation" },
  { id: "imagePrompts", label: "Image Prompts" },
  { id: "images", label: "Image Generation" },
  { id: "videoEditing", label: "Video Editing" },
  { id: "exportVerify", label: "Export & Verify" },
];

export const SEVEN_STEP_IDS: readonly SevenStepId[] = SEVEN_STEPS.map((step) => step.id);

export function sevenStepLabel(id: SevenStepId): string {
  return SEVEN_STEPS.find((step) => step.id === id)?.label ?? id;
}

/** Which display step an existing step belongs to. */
export function sevenStepForStage(stage: StageId): SevenStepId {
  switch (stage) {
    case "scenes":
      return "script";
    case "voice":
      return "voice";
    case "timing":
      return "srt";
    case "cast":
    case "prompts":
      return "imagePrompts";
    case "images":
      return "images";
    case "audio":
      return "videoEditing";
    case "render":
      return "exportVerify";
  }
}

export type SevenStepState = "done" | "running" | "waiting" | "error" | "pending";

export interface SevenStepRow {
  id: SevenStepId;
  label: string;
  done: boolean;
  state: SevenStepState;
  /** "12 of 40" for steps with a count, else "". */
  detail: string;
}

function row(id: SevenStepId, done: boolean, state: SevenStepState, detail = ""): SevenStepRow {
  return { id, label: sevenStepLabel(id), done, state, detail };
}

/** The 7 display steps for a project, from its finished-step flags. Step 0 is
driven by the saved script alone: scenes do not finish it, and a saved script
finishes it even before any scene exists. */
export function sevenStepsFromSummary(project: ProjectSummary): SevenStepRow[] {
  const by = Object.fromEntries(stageProgress(project).map((step) => [step.id, step]));
  const imagePromptsDone = by.cast.done && by.prompts.done;
  const scriptDone = project.hasScript === true;
  return [
    row("script", scriptDone, scriptDone ? "done" : "pending", scriptDone ? "Script saved" : ""),
    row("voice", by.voice.done, by.voice.done ? "done" : "pending"),
    row("srt", by.timing.done, by.timing.done ? "done" : "pending"),
    row("imagePrompts", imagePromptsDone, imagePromptsDone ? "done" : "pending", by.prompts.detail),
    row("images", by.images.done, by.images.done ? "done" : "pending", by.images.detail),
    row("videoEditing", by.audio.done, by.audio.done ? "done" : "pending"),
    row("exportVerify", by.render.done, by.render.done ? "done" : "pending"),
  ];
}

/** The worst state wins: an error beats waiting, waiting beats running, and a step is only
finished when every step folded into it is finished or skipped. */
function combineStates(states: readonly RowState[]): SevenStepState {
  if (states.includes("error")) return "error";
  if (states.includes("waiting")) return "waiting";
  if (states.includes("running")) return "running";
  if (states.length > 0 && states.every((state) => state === "done" || state === "skipped")) return "done";
  return "pending";
}

function combineDetail(details: readonly string[]): string {
  return details.filter((detail) => detail !== "").join(" · ");
}

/** The 7 display steps for a live run, from its row states. Step 0 is not a
runner row: a run that has started already has its script (typed, or written
by Claude, or an own voice file), so a started run counts Step 0 as done and
an idle run counts it as pending. It is never read from the Scenes row. */
export function sevenStepsFromView(view: RunView): SevenStepRow[] {
  const by = Object.fromEntries(view.rows.map((step) => [step.id, step]));
  const pick = (stages: readonly StageId[]): { state: SevenStepState; detail: string } => {
    const found = stages.map((stage) => by[stage]).filter((step) => step !== undefined);
    return { state: combineStates(found.map((step) => step.state)), detail: combineDetail(found.map((step) => step.detail)) };
  };
  const make = (id: SevenStepId, stages: readonly StageId[]): SevenStepRow => {
    const combined = pick(stages);
    return row(id, combined.state === "done", combined.state, combined.detail);
  };
  const scriptRow: SevenStepRow = view.status === "idle" ? row("script", false, "pending") : row("script", true, "done", "Script saved");
  return [
    scriptRow,
    make("voice", ["voice"]),
    make("srt", ["timing"]),
    make("imagePrompts", ["cast", "prompts"]),
    make("images", ["images"]),
    make("videoEditing", ["audio"]),
    make("exportVerify", ["render"]),
  ];
}

/** The share of finished display steps, 0 to 100. */
export function sevenStepPercent(rows: readonly SevenStepRow[]): number {
  return rows.length === 0 ? 0 : Math.round((rows.filter((step) => step.done).length / rows.length) * 100);
}

/** The display step the video is at: the first one that is not finished (null when everything is). */
export function sevenStepCurrent(rows: readonly SevenStepRow[]): SevenStepId | null {
  return rows.find((step) => !step.done)?.id ?? null;
}

export type ReviewToggleId = "script" | "voice" | "srt" | "imagePrompts" | "images";

export interface ReviewToggle {
  id: ReviewToggleId;
  label: string;
  /** The existing steps this toggle pauses. */
  stages: readonly StageId[];
}

/** The brother tool's five pause-for-review toggles, on this tool's steps. */
export const REVIEW_TOGGLES: readonly ReviewToggle[] = [
  { id: "script", label: "Approve Script", stages: ["scenes"] },
  { id: "voice", label: "Approve Voice", stages: ["voice"] },
  { id: "srt", label: "Approve SRT", stages: ["timing"] },
  { id: "imagePrompts", label: "Approve Image Prompts", stages: ["cast", "prompts"] },
  { id: "images", label: "Approve Images", stages: ["images"] },
];

/** A toggle reads as on only when every step it covers is paused. */
export function reviewToggleChecked(pauses: Pauses, toggle: ReviewToggle): boolean {
  return toggle.stages.every((stage) => pauses[stage]);
}

/** Changing a toggle changes every step it covers, and nothing else. */
export function setReviewToggle(pauses: Pauses, toggle: ReviewToggle, value: boolean): Pauses {
  return { ...pauses, ...Object.fromEntries(toggle.stages.map((stage) => [stage, value])) } as Pauses;
}
