import { transcribeVoice } from "../../timing/api.ts";
import { buildOutcome } from "../../timing/build.ts";
import { runJob } from "../../../store/jobStore.ts";
import { openProjectOf, patchProject, type StageContext } from "./context.ts";

/** Word timing: Groq listens to the voice and gives the time of every word. */
export async function timingStage(ctx: StageContext): Promise<void> {
  const project = openProjectOf(ctx);
  const voice = project.voicePath;
  if (voice === null) throw new Error("The voice is not ready.");
  ctx.say("Groq is listening to the voice");
  const speech = await runJob("transcribe", "Preparing the voice", (id) => transcribeVoice(ctx.projectId, voice, project.language, id));
  if (speech.length === 0) throw new Error("No words were found in the voice.");
  const outcome = buildOutcome(project.script, speech, project.voiceDuration);
  patchProject(ctx, {
    words: outcome.words,
    timingSource: "groq",
    timingEstimated: false,
    alignmentQuality: outcome.quality,
    unmatchedWords: outcome.unmatched,
    scenes: [],
    mediaMap: {},
  });
}
