import { imagegenPause, imagegenStart } from "../../imagegen/api.ts";
import { buildJobs } from "../../imagegen/mapping.ts";
import { projectDirPath } from "../../media/api.ts";
import { useImageGenStore } from "../../../store/imagegenStore.ts";
import { openProjectOf, type StageContext } from "./context.ts";
import { scenesWithoutPicture } from "../plan.ts";

const POLL_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pictures: the free engine (Google accounts) makes one picture per scene. Resumes: only scenes without a picture are sent. */
export async function imagesStage(ctx: StageContext): Promise<void> {
  const store = useImageGenStore.getState();
  await store.init();
  const folder = await projectDirPath(ctx.projectId);
  const snapshot = useImageGenStore.getState().snapshot;
  if (snapshot?.projectDir !== folder) await imagegenStart(ctx.projectId, [], false, false);

  const project = openProjectOf(ctx);
  const missing = scenesWithoutPicture(project);
  if (missing.length === 0) return;
  const { jobs } = buildJobs(project.scenes, project.settings.aspectRatio, missing);
  if (jobs.length === 0) throw new Error("No scene has a prompt to make a picture from.");
  ctx.say(`Making ${jobs.length} pictures`);
  await imagegenStart(ctx.projectId, jobs, false, true);

  const wanted = new Set(missing);
  let idle = 0;
  for (;;) {
    if (ctx.cancelled()) {
      await imagegenPause().catch(() => undefined);
      return;
    }
    await sleep(POLL_MS);
    await useImageGenStore.getState().reconcile();
    const now = useImageGenStore.getState().snapshot;
    const left = scenesWithoutPicture(openProjectOf(ctx)).filter((id) => wanted.has(id));
    if (left.length === 0) return;
    ctx.say(`Pictures: ${jobs.length - left.length} of ${jobs.length} done`);
    if (!now) continue;
    const working = now.stats.queued + now.stats.generating;
    idle = working === 0 ? idle + 1 : 0;
    // Nothing is queued or being made for three checks in a row: the engine has given up on the rest.
    if (idle >= 3) {
      const reasons = now.jobs.filter((job) => job.status === "failed" && wanted.has(job.id)).map((job) => job.error).filter((text) => text !== "");
      const notice = now.notice?.text ?? "";
      const why = reasons[0] ?? notice;
      throw new Error(`${left.length} of ${jobs.length} pictures are missing.${why ? ` ${why}` : ""} Check the Google accounts in Settings, then press Continue.`);
    }
  }
}
