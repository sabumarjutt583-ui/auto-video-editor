import { renderVideo } from "../../render/api.ts";
import { applyCaptionOverrides } from "../../captions/overrides.ts";
import { buildRenderRequest, renderProblems, todayStamp } from "../../render/request.ts";
import { runJob } from "../../../store/jobStore.ts";
import { openProjectOf, patchProject, type StageContext } from "./context.ts";
import { editorStateOf } from "./derived.ts";

/** Final video: timeline, captions, Ken Burns, transitions, mixed audio, one MP4. */
export async function renderStage(ctx: StageContext): Promise<void> {
  const project = openProjectOf(ctx);
  const problems = renderProblems(project);
  if (problems.length > 0) throw new Error(problems.join(" "));
  const state = await editorStateOf(project);
  const request = buildRenderRequest({
    project,
    editor: state.editor,
    exists: {},
    aspect: project.settings.aspectRatio,
    quality: project.settings.quality,
    captionLines: applyCaptionOverrides(state.captionLines, project.scenes, project.captionOverrides),
    captionStyle: state.captionStyle,
    font: state.font,
    cues: state.cues,
    suffix: null,
    date: todayStamp(),
  });
  ctx.say("Rendering the video");
  const done = await runJob("render", "Starting the render", (id) => renderVideo(ctx.projectId, request, id));
  patchProject(ctx, { renderedAt: new Date().toISOString(), exportDurationSeconds: done.duration, exportSizeBytes: done.sizeBytes });
  ctx.finished({ path: done.path, copyPath: done.copyPath, seconds: done.secondsTaken, sizeBytes: done.sizeBytes });
}
