import { groupSentencesWithAi } from "../../scenes/aiGroups.ts";
import { buildBySeconds, buildBySentences, buildFromSentenceGroups, FALLBACK_SECONDS } from "../../scenes/build.ts";
import { splitSentences } from "../../sentences.ts";
import { runJob } from "../../../store/jobStore.ts";
import { openProjectOf, patchProject, type StageContext } from "./context.ts";

/** Scenes: cut the narration the way the channel profile says. */
export async function scenesStage(ctx: StageContext): Promise<void> {
  const project = openProjectOf(ctx);
  const settings = project.sceneSettings;
  const input = { words: project.words, voiceDuration: project.voiceDuration, settings };
  ctx.say(settings.mode === "seconds" ? `Cutting a scene about every ${settings.targetSeconds} seconds` : "Cutting the scenes");
  let scenes;
  if (settings.mode === "ai") {
    const sentences = splitSentences(project.words);
    const groups = await groupSentencesWithAi(
      sentences.map((sentence) => sentence.text),
      (start) => runJob("ai", "Asking Gemini to group the sentences", start),
    );
    scenes = groups ? buildFromSentenceGroups(input, groups) : buildBySeconds(input, FALLBACK_SECONDS);
  } else if (settings.mode === "seconds") {
    scenes = buildBySeconds(input);
  } else {
    scenes = buildBySentences(input);
  }
  if (scenes.length === 0) throw new Error("No scenes could be made from the narration.");
  patchProject(ctx, { scenes, mediaMap: {} });
}
