import { useState } from "react";

import { toAppError } from "../../lib/errors";
import { flowBatchPrepareWith, flowBatchRun } from "../../lib/imagegen/api";
import { registerVideo, type VideoItem } from "../../lib/imagegen/video";
import { useProjectStore } from "../../store/projectStore";
import type { AppError, Project } from "../../types";
import {
  FLOW_BATCH_VIDEO_MODELS,
  flowVideoCreditsPerVideo,
  type FlowBatchVideoModel,
} from "../../lib/flowBatch/flowBatch";
import { Button } from "../ui";
import { ErrorNotice } from "../ErrorNotice";

/**
 * Videos made with Batch Flow Studio, in Flow's place. The old
 * one-video-at-a-time Google Flow engine is no longer offered: this
 * sends all selected scenes as one paragraph batch to the shared
 * Batch tool, downloads per card in card order, and renames each
 * download from the scene record (S01.mp4 → S01_000.0-008.0.mp4).
 * A failed card keeps its own scene number; no other scene is
 * renumbered. The credit estimate is shown before anything is
 * generated, using the live model + duration table (Omni 1.1 Flash
 * by default; Veo 3.1 Series Quality at 100 credits is refused by
 * the default cap of 20). A clip lasts only the chosen duration,
 * so a longer scene needs more than one clip or a loop.
 */
export function FlowBatchVideoRun({
  project,
  items,
  ensureConsent,
}: {
  project: Project;
  items: VideoItem[];
  ensureConsent: () => Promise<boolean>;
}) {
  const [videoModel, setVideoModel] = useState<FlowBatchVideoModel>("Omni 1.1 Flash");
  const [videoSeconds, setVideoSeconds] = useState(4);
  const [videoResolution, setVideoResolution] = useState("720p");
  const [report, setReport] = useState("");
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const perVideo = flowVideoCreditsPerVideo(videoModel, videoSeconds, videoResolution);
  const estimated = perVideo === null ? null : perVideo * items.length;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      if (items.length === 0) return;
      if (!(await ensureConsent())) return;
      const aspect = project.settings.aspectRatio;
      const jobs = items.map((item) => ({
        sceneId: item.sceneId,
        fileName: item.fileName,
        prompt: item.prompt,
        aspect,
      }));
      const prepared = await flowBatchPrepareWith(jobs, "videos", videoModel, videoSeconds, videoResolution);
      setReport(`Prepared ${prepared.paragraphCount} prompts. Estimated cost: ${prepared.estimatedCredits} credits. Generating…`);
      const result = await flowBatchRun({
        projectId: project.id,
        jobs,
        generationType: "videos",
        videoModel,
        videoSeconds,
        videoResolution,
      });
      for (const saved of result.saved) {
        const fresh = useProjectStore.getState().project;
        if (!fresh || fresh.id !== project.id) break;
        const patch = registerVideo(fresh, saved.sceneId, {
          path: saved.path,
          accountName: result.accountName,
          width: saved.width,
          height: saved.height,
          duration: saved.duration,
          modified: saved.modified,
        });
        if (patch) useProjectStore.getState().update(patch);
      }
      const parts = [`${result.saved.length} videos saved`];
      if (result.failedSceneIds.length > 0) parts.push(`${result.failedSceneIds.length} failed (${result.failedSceneIds.join(", ")}) — their numbers were not reused`);
      setReport(parts.join(", ") + ".");
    } catch (caught) {
      setError(toAppError(caught, "Batch Flow Studio did not make the videos."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Batch videos are made from words (Text to Video). The scene&apos;s picture is not sent as a frame in this step;
        use Gemini above if you want to animate a picture instead.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label>
          Model{" "}
          <select value={videoModel} onChange={(e) => setVideoModel(e.target.value as FlowBatchVideoModel)} className="rounded border border-line bg-surface px-2 py-1">
            {FLOW_BATCH_VIDEO_MODELS.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </label>
        <label>
          Duration{" "}
          <select value={videoSeconds} onChange={(e) => setVideoSeconds(Number(e.target.value))} className="rounded border border-line bg-surface px-2 py-1">
            {[4, 6, 8, 10].map((seconds) => (
              <option key={seconds} value={seconds}>{seconds}s</option>
            ))}
          </select>
        </label>
        <label>
          Resolution{" "}
          <select value={videoResolution} onChange={(e) => setVideoResolution(e.target.value)} className="rounded border border-line bg-surface px-2 py-1">
            <option value="360p">360p</option>
            <option value="720p">720p</option>
          </select>
        </label>
        <span className="text-muted">
          {perVideo === null
            ? "Cost for this model/duration is not known, so the batch will be refused (never guessed)."
            : `${perVideo} credits per video · ${estimated ?? 0} credits estimated for ${items.length} videos · cap 20 per video`}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void run()} disabled={busy || items.length === 0 || perVideo === null}>
          Run Batch Flow Studio ({items.length} {items.length === 1 ? "video" : "videos"})
        </Button>
      </div>
      {report && <p role="status" className="text-sm">{report}</p>}
      {error && <ErrorNotice error={error} />}
    </div>
  );
}
