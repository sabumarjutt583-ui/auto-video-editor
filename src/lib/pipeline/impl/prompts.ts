import { generateText } from "../../ai.ts";
import { logFrontendError } from "../../appUpdate/api.ts";
import { toAppError } from "../../errors.ts";
import { generatePrompts, type PromptContext } from "../../prompts/generate.ts";
import { randomPauseMs, runChatPrompts } from "../../prompts/chat/runner.ts";
import { loadThread, saveThread } from "../../prompts/chat/threadStore.ts";
import { webChatTransport } from "../../prompts/chat/tauriTransport.ts";
import { runJob } from "../../../store/jobStore.ts";
import { useProjectStore } from "../../../store/projectStore.ts";
import { useSettingsStore } from "../../../store/settingsStore.ts";
import { useStyleStore } from "../../../store/styleStore.ts";
import { openProjectOf, patchProject, type StageContext } from "./context.ts";

/** Prompts: one picture prompt per scene, in the channel's style (Gemini API key, or the web chat when Settings says so). */
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

  const outcome = await runJob("ai", "Writing prompts with Gemini", async (jobId) => {
    if (settings?.textViaChat === true) {
      const chat = await runChatPrompts({
        scenes: latest(),
        targetIds,
        context,
        transport: webChatTransport(jobId),
        tag: ctx.projectId.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase() || "P",
        batchSize: Math.min(25, Math.max(5, settings.chatBatchSize ?? 10)),
        pauseBetween: () => randomPauseMs(settings.chatPauseMinSec ?? 4, settings.chatPauseMaxSec ?? 12),
        onLog: (line) => void logFrontendError(line, "make video (chat run)").catch(() => undefined),
        thread: loadThread(ctx.projectId),
        onThread: (thread) => saveThread(ctx.projectId, thread),
        onBatch: ({ batch, total }) => ctx.say(`Prompts: batch ${batch} of ${total}`),
        onScenes,
      });
      return { scenes: chat.scenes, failed: chat.failed ? { batch: chat.failed.batch, error: chat.failed.error } : null };
    }
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
