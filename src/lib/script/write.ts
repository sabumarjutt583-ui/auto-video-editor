import type { AppError } from "../../types/index.ts";
import { canWriteScript, type ChannelProfile } from "../pipeline/profile.ts";
import { scriptAsk } from "./api.ts";
import { buildScriptQuestion, cleanScript, scriptProblem } from "./prompt.ts";
import { buildStep0Question, scriptRecordFor, type ScriptRecord } from "./step0.ts";

function fail(message: string, details: string): never {
  const error: AppError = { message, details };
  throw error;
}

/** Step 0: asks the channel's script writer for a script about the title/topic,
with the word count as an instruction, and returns the script plus its audit
record (channel, title, topic, word count, master prompt version). Uses the
existing Claude flow; throws an Error with a simple message when it cannot. */
export async function writeScriptForStep0(
  profile: ChannelProfile,
  input: { title: string; topic: string; wordCount: number | null },
): Promise<{ script: string; record: ScriptRecord }> {
  if (!canWriteScript(profile)) fail("This channel has no script writer or no master prompt. Open the channel Settings to set them.", "script writer not set");
  const title = input.title.trim();
  const topic = input.topic.trim();
  if (title === "" && topic === "") fail("Write a title or topic for the script writer first.", "empty title and topic");
  const answer = await scriptAsk(buildStep0Question(profile.script.masterPrompt, title, topic, input.wordCount), profile.script.claudeAccountId ?? null);
  const script = cleanScript(answer);
  const problem = scriptProblem(script);
  if (problem) fail(problem, `script words: ${script.split(/\s+/).length}`);
  return { script, record: scriptRecordFor({ profile, title, topic, wordCount: input.wordCount, script, source: "claude" }) };
}

/** Asks the channel's script writer for a script about the topic. Throws an Error with a simple message when it cannot. */
export async function writeScript(profile: ChannelProfile, topic: string): Promise<string> {
  if (!canWriteScript(profile)) fail("This channel has no script writer or no master prompt. Open the channel Settings to set them.", "script writer not set");
  if (topic.trim() === "") fail("Write the topic of the video first.", "empty topic");
  const answer = await scriptAsk(buildScriptQuestion(profile.script.masterPrompt, topic), profile.script.claudeAccountId ?? null);
  const script = cleanScript(answer);
  const problem = scriptProblem(script);
  if (problem) fail(problem, `script words: ${script.split(/\s+/).length}`);
  return script;
}
