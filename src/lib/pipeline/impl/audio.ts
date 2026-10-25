import { buildAudioMix, importMusic } from "../../audio/api.ts";
import { buildMixRequest } from "../../audio/mixRequest.ts";
import { readEditor } from "../../editor/model.ts";
import { runJob } from "../../../store/jobStore.ts";
import { openProjectOf, patchProject, type StageContext } from "./context.ts";
import { editorStateOf } from "./derived.ts";

/** Music and sounds: copy the channel's music into the project, then mix voice, music and effects. */
export async function audioStage(ctx: StageContext): Promise<void> {
  let project = openProjectOf(ctx);
  const paths = ctx.profile.audio.musicPaths;
  if (paths.length > 0 && readEditor(project).audio.tracks.length === 0) {
    ctx.say("Copying the music");
    const imported = await runJob("audio", "Copying music", (id) => importMusic(ctx.projectId, paths, id));
    if (imported.imported.length > 0) {
      const editor = readEditor(project);
      const tracks = imported.imported.map((m, i) => ({ id: `m${i + 1}`, path: m.path, name: m.name, duration: m.duration }));
      patchProject(ctx, { editor: { ...editor, audio: { ...editor.audio, tracks } } });
    }
    project = openProjectOf(ctx);
  }
  if (project.voicePath === null) throw new Error("The voice is not ready.");
  const voicePath = project.voicePath;
  const state = await editorStateOf(project);
  ctx.say("Mixing the audio");
  const request = buildMixRequest(state.editor.audio, voicePath, project.voiceDuration, state.cues);
  const result = await runJob("audio", "Mixing the audio", (id) => buildAudioMix(ctx.projectId, request, id));
  const editor = readEditor(openProjectOf(ctx));
  patchProject(ctx, { editor: { ...editor, audio: { ...editor.audio, mix: { path: result.path, ...result.loudness, builtAt: new Date().toISOString() } } } });
}
