/** Step 0 — Script Writing, the first step of a new video (pure).

The script is written BEFORE the runner starts, so it is not one of the runner's
8 steps and it is not folded into Scenes any more: on the Dashboard bar it has
its own row, driven by whether the project has a saved script (see
`hasScript` on the project summary), not by whether scenes exist.

Two ways to get the script, and both end with the same saved script on the
project, so the later steps cannot tell them apart except for the source flag:
- Typed: the person pastes or types the script. The tool uses it as-is and
  never calls Claude.
- Claude: the person gives only a title/topic (and an optional word count).
  The tool composes one question from the channel's master prompt + title +
  topic + word count, sends it to Claude through the existing Claude flow,
  and saves the answer.

Channel isolation: every script record carries the channel id it was made
for, and `scriptsOfChannel` only ever returns records whose channel id
matches exactly. Nothing is shared, copied, or reused across channels. */

import { buildScriptQuestion } from "./prompt.ts";
import { canWriteScript, type ChannelProfile } from "../pipeline/profile.ts";

/** Where the project's script came from. */
export type ScriptSource = "claude" | "typed";

/** The audit record saved with a project's script. */
export interface ScriptRecord {
  /** The channel this script belongs to. Nothing from another channel may use it. */
  channelId: string;
  /** The video's title (the project name). */
  title: string;
  /** The topic/title the person typed for Claude, or "" when the script was typed. */
  topic: string;
  /** The word count the person asked for, or null when none was asked. */
  wordCountRequested: number | null;
  /** The words in the saved script. */
  wordCountActual: number;
  source: ScriptSource;
  /** A fingerprint of the master prompt used, so a later audit can show which
  channel prompt produced the script. Changes whenever the master prompt changes. */
  masterPromptVersion: string;
}

/** Word counts the person may ask for. Outside this range the number is clamped. */
export const MIN_WORD_COUNT = 50;
export const MAX_WORD_COUNT = 20000;

/** Counts the words in a script the way the rest of the app does. */
export function countScriptWords(script: string): number {
  return script.trim().split(/\s+/).filter(Boolean).length;
}

/** Clamps a word count into the allowed range, or null when there is none. */
export function clampWordCount(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.min(MAX_WORD_COUNT, Math.max(MIN_WORD_COUNT, Math.round(value)));
}

/** A short fingerprint of a master prompt: a 32-bit hash plus its length.
Stable for the same prompt, different for any different prompt. */
export function masterPromptVersion(masterPrompt: string): string {
  let hash = 2166136261;
  for (let i = 0; i < masterPrompt.length; i += 1) {
    hash ^= masterPrompt.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}-${masterPrompt.trim().length}`;
}

/** The one question sent to Claude for Step 0: the channel's master prompt,
the video's title and topic, and the word-count target as an instruction. */
export function buildStep0Question(masterPrompt: string, title: string, topic: string, wordCount: number | null): string {
  const subject = [
    title.trim() !== "" ? `TITLE OF THIS VIDEO:\n${title.trim()}` : "",
    topic.trim() !== "" ? `TOPIC OF THIS VIDEO:\n${topic.trim()}` : "",
  ]
    .filter((part) => part !== "")
    .join("\n\n");
  const question = buildScriptQuestion(masterPrompt, subject);
  const wanted = clampWordCount(wordCount);
  if (wanted === null) return question;
  return question.replace("Write the complete script now.", `Write the complete script now, about ${wanted} words long (aim for ${wanted} words, not much shorter or longer).`);
}

/** What Step 0 does with what the person gave. Pure, so the UI and the runner agree. */
export type Step0Decision =
  | { action: "useTyped"; source: "typed" }
  | { action: "callClaude"; source: "claude" }
  | { action: "needInput"; problem: string };

export function resolveStep0(input: { script: string; title: string; topic: string; profile: ChannelProfile }): Step0Decision {
  if (input.script.trim() !== "") return { action: "useTyped", source: "typed" };
  if (input.title.trim() === "" && input.topic.trim() === "") return { action: "needInput", problem: "Paste the script, or write a title or topic for Claude to write from." };
  if (!canWriteScript(input.profile)) return { action: "needInput", problem: "This channel has no script writer or no master prompt. Open the channel Settings to set them, or paste the script yourself." };
  return { action: "callClaude", source: "claude" };
}

/** Builds the audit record for a finished script. */
export function scriptRecordFor(input: { profile: ChannelProfile; title: string; topic: string; wordCount: number | null; script: string; source: ScriptSource }): ScriptRecord {
  return {
    channelId: input.profile.id,
    title: input.title,
    topic: input.topic,
    wordCountRequested: clampWordCount(input.wordCount),
    wordCountActual: countScriptWords(input.script),
    source: input.source,
    masterPromptVersion: masterPromptVersion(input.profile.script.masterPrompt),
  };
}

/** Only the records of one channel, in order. Never returns another channel's records. */
export function scriptsOfChannel<T extends { channelId: string }>(records: readonly T[], channelId: string): T[] {
  return records.filter((record) => record.channelId === channelId);
}

/** True when every record belongs to the channel it is listed under. */
export function recordsAreIsolated<T extends { channelId: string }>(records: readonly T[], channelId: string): boolean {
  return records.every((record) => record.channelId === channelId);
}

/** The audit record for an already-saved project, or null when the project
predates Step 0 records (its script source is then unknown, not guessed). */
export function recordFromProject(project: {
  channelId: string;
  name: string;
  script: string;
  scriptSource?: string;
  scriptTopic?: string;
  scriptWordsRequested?: number;
  scriptMasterPromptVersion?: string;
}): ScriptRecord | null {
  if (project.scriptSource !== "claude" && project.scriptSource !== "typed") return null;
  return {
    channelId: project.channelId,
    title: project.name,
    topic: project.scriptTopic ?? "",
    // The project file stores 0 for "none asked".
    wordCountRequested: project.scriptWordsRequested === undefined || project.scriptWordsRequested === 0 ? null : project.scriptWordsRequested,
    wordCountActual: countScriptWords(project.script),
    source: project.scriptSource,
    masterPromptVersion: project.scriptMasterPromptVersion ?? "",
  };
}
