import { applySilenceRemoval, importVoice, skipSilenceRemoval } from "../../audio.ts";
import { voiceProviderMismatch } from "../providers.ts";
import { ttsGenerate } from "../../tts/api.ts";
import { runJob } from "../../../store/jobStore.ts";
import { openProjectOf, patchProject, type StageContext } from "./context.ts";

/** Voice: make it from the script (or import the person's file), clean it, lock it. */
export async function voiceStage(ctx: StageContext): Promise<void> {
  let project = openProjectOf(ctx);
  if (project.voiceOriginalPath === null) {
    let source = ctx.voiceFile;
    if (source === null) {
      if (project.script.trim() === "") throw new Error("There is no script to make the voice from.");
      const { provider, model, voice, style, rate, volume } = ctx.providers.voice;
      if (voiceProviderMismatch(ctx.providers.voice)) throw new Error("The saved voice does not belong to its provider. Choose the voice provider and voice in Channels > Settings, save, then continue this video.");
      ctx.say(provider === "edge" ? "Making the voice with Edge TTS" : "Making the voice with Gemini");
      const made = await runJob("tts", "Making the voice", (id) =>
        ttsGenerate(ctx.projectId, { text: project.script, voice, model, style, provider, rate, volume }, id),
      );
      source = made.path;
    }
    ctx.say("Copying the voice into the project");
    const imported = await importVoice(ctx.projectId, source);
    patchProject(ctx, {
      voiceOriginalPath: imported.originalPath,
      voiceOriginalDuration: imported.duration,
      voiceSampleRate: imported.sampleRate,
      voiceChannels: imported.channels,
      voicePath: null,
      voiceDuration: imported.duration,
      cutMap: [],
      voiceCleanup: { ...project.voiceCleanup, mode: "none" },
    });
    project = openProjectOf(ctx);
  }

  const original = project.voiceOriginalPath;
  if (original === null) throw new Error("The voice file is missing.");
  if (project.voicePath === null) {
    const cleanup = project.voiceCleanup;
    const cut = ctx.profile.voice.cutSilence;
    ctx.say(cut ? "Cutting the long silences" : "Preparing the voice");
    const params = { thresholdDb: cleanup.thresholdDb, minSilence: cleanup.minSilence, padding: cleanup.padding, normalize: cleanup.normalize };
    const result = cut
      ? await runJob("silence-apply", "Cutting silences", (id) => applySilenceRemoval(ctx.projectId, original, params, id))
      : await runJob("silence-skip", "Preparing the voice", (id) => skipSilenceRemoval(ctx.projectId, original, cleanup.normalize, id));
    patchProject(ctx, {
      voicePath: result.processedPath,
      voiceDuration: result.duration,
      voiceSampleRate: result.sampleRate,
      voiceChannels: result.channels,
      cutMap: result.removed,
      voiceCleanup: { ...cleanup, mode: cut ? "cut" : "skipped" },
    });
  }
  patchProject(ctx, { voiceLocked: true });
}
