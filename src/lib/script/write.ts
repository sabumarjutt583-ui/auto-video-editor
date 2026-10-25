import type { AppError } from "../../types/index.ts";
import { canWriteScript, type ChannelProfile } from "../pipeline/profile.ts";
import { scriptAsk } from "./api.ts";
import { buildScriptQuestion, cleanScript, scriptProblem } from "./prompt.ts";

function fail(message: string, details: string): never {
  const error: AppError = { message, details };
  throw error;
}

/** Asks the channel's script writer for a script about the topic. Throws an Error with a simple message when it cannot. */
export async function writeScript(profile: ChannelProfile, topic: string): Promise<string> {
  if (!canWriteScript(profile)) fail("This channel has no script writer or no master prompt. Open the channel Settings to set them.", "script writer not set");
  if (topic.trim() === "") fail("Write the topic of the video first.", "empty topic");
  const answer = await scriptAsk(buildScriptQuestion(profile.script.masterPrompt, topic));
  const script = cleanScript(answer);
  const problem = scriptProblem(script);
  if (problem) fail(problem, `script words: ${script.split(/\s+/).length}`);
  return script;
}
