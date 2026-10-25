import { generateText } from "../../ai.ts";
import { toAppError } from "../../errors.ts";
import { generatePrompts, type PromptContext } from "../../prompts/generate.ts";
import { runJob } from "../../../store/jobStore.ts";
import { useProjectStore } from "../../../store/projectStore.ts";
import { useSettingsStore } from "../../../store/settingsStore.ts";
import { useStyleStore } from "../../../store/styleStore.ts";
import { openProjectOf, patchProject, type StageContext } from "./context.ts";

/** Prompts: one picture prompt per scene, in the channel's style (written by Gemini or Groq, as chosen in Settings). */
export async function promptsStage(ctx: StageContext): Promise<void> {
  if (!useStyleStore.getState().loaded) await useStyleStore.getState().load();
  const project = openProjectOf(ctx);
  const style = useStyleStore.getState().styles.find((s) => s.id === project.styleId);
  if (!style) throw new Error("The picture style of the channel profile was not found. Choose a style in the profile.");
  const context: PromptContext = { style, characters: project.characterBible, locations: project.locationBible, settings: project.promptSettings, aspect: project.settings.aspectRatio };
  const settings = useSettingsStore.getState().settings;
  const targetIds = new Set(project.scenes.filter((scene) => scene.prompt.trim() === "").map((scene) => scene.id));
  if (targetIds.size === 0) return;
  ctx.say(`Writing ${targetIds.size} prompts`);
  const onScenes = (next: typeof project.scenes) => patchProject(ctx, { scenes: next });
  const latest = () => useProjectStore.getState().project?.scenes ?? project.scenes;

  const outcome = await runJob("ai", `Writing prompts with ${settings?.textProvider === "groq" ? "Groq" : "Gemini"}`, async (jobId) => {
    return generatePrompts({
      scenes: latest(),
      targetIds,
      context,
      resendOnError: true,
      batchSize: Math.min(20, Math.max(5, settings?.apiBatchSize ?? 10)),
      parallel: Math.min(3, Math.max(1, settings?.apiParallel ?? 2)),
      call: async (system, prompt) => (await generateText(prompt, system, true, jobId)).text,
      onBatch: (number, total) => ctx.say(`Prompts: batch ${number} of ${total}`),
      onScenes,
    });
  });
  patchProject(ctx, { scenes: outcome.scenes });
  if (outcome.failed) {
    const reason = toAppError(outcome.failed.error).message;
    throw new Error(`Prompt batch ${outcome.failed.batch} failed: ${reason} The earlier batches are kept, press Continue to try the rest.`);
  }
}
