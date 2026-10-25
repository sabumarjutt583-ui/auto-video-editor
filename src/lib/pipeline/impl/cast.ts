import { generateText } from "../../ai.ts";
import { applyCast } from "../../bible/edit.ts";
import { BIBLE_SYSTEM_INSTRUCTION, parseDetected, scenesPrompt, type Detected } from "../../bible/detect.ts";
import { runJob } from "../../../store/jobStore.ts";
import { openProjectOf, patchProject, type StageContext } from "./context.ts";

/** Characters and places: Gemini reads the scenes, the result is locked so every prompt uses the same words. */
export async function castStage(ctx: StageContext): Promise<void> {
  const project = openProjectOf(ctx);
  const lines = project.scenes.map((scene) => ({ id: scene.id, text: scene.text }));
  const ids = project.scenes.map((scene) => scene.id);
  const prompt = scenesPrompt(lines);
  ctx.say("Gemini is finding characters and places");
  let result: Detected | null = null;
  for (let attempt = 0; attempt < 2 && result === null; attempt += 1) {
    const answer = await runJob("ai", "Finding characters and places", (id) => generateText(prompt, BIBLE_SYSTEM_INSTRUCTION, true, id));
    result = parseDetected(answer.text, ids);
  }
  if (result === null) throw new Error("Gemini's answer about the characters could not be read (tried twice).");
  patchProject(ctx, {
    characterBible: result.characters,
    locationBible: result.locations,
    scenes: applyCast(project.scenes, result.cast),
    bibleLocked: true,
  });
}
