import { useMemo, useState } from "react";

import { openExternalLink } from "../../lib/links";
import { toAppError } from "../../lib/errors";
import {
  flowBatchConfig,
  flowBatchPrepareWith,
  flowBatchRename,
  flowBatchRun,
} from "../../lib/imagegen/api";
import { registerImage } from "../../lib/imagegen/register";
import { registerVideo } from "../../lib/imagegen/video";
import { formatTimecode } from "../../lib/scenes/timecode";
import { useProjectStore } from "../../store/projectStore";
import type { AppError } from "../../types";
import type { FlowBatchInfo, FlowBatchPrepared } from "../../lib/imagegen/api";
import {
  FLOW_BATCH_VIDEO_MODELS,
  flowVideoCreditsPerVideo,
  type FlowBatchVideoModel,
} from "../../lib/flowBatch/flowBatch";
import { Button } from "../ui";
import { ErrorNotice } from "../ErrorNotice";

/**
 * Batch Flow Studio, in Flow's place. The old one-video-at-a-time
 * Google Flow engine is no longer offered anywhere in the UI; this
 * panel is where Flow used to be for images, and the Videos section
 * uses the same run for videos (see FlowBatchVideoRun).
 *
 * The panel prepares a whole project batch (paragraph format: one
 * paragraph per prompt, one blank line between prompts — live-verified
 * with 20 prompts → 20 cards, S01–S20, all Ready, 0 credits), shows
 * the credit estimate for videos before anything is generated, runs
 * the batch in a tab of a Google account's browser, downloads per
 * card in card order, and saves each download renamed from the
 * scene record (S01.png → S01_000.0-008.0.png). A failed card keeps
 * its own scene number; no other scene is renumbered.
 *
 * Warnings that belong to the Flow tool itself, not this app: a
 * prompt with no character name gets "Jin Kun" locked in by the Flow
 * tool, and the word "Korean" in a prompt is also auto-detected as
 * an identity token (verified live). Configure the characters in the
 * Flow tool itself if only one character is wanted; this app never
 * hardcodes Jin Kun.
 */
export function FlowBatchPanel() {
  const project = useProjectStore((state) => state.project);
  const [info, setInfo] = useState<FlowBatchInfo | null>(null);
  const [generation, setGeneration] = useState<"images" | "videos">("images");
  const [videoModel, setVideoModel] = useState<FlowBatchVideoModel>("Omni 1.1 Flash");
  const [videoSeconds, setVideoSeconds] = useState(4);
  const [videoResolution, setVideoResolution] = useState("720p");
  const [prepared, setPrepared] = useState<FlowBatchPrepared | null>(null);
  const [report, setReport] = useState("");
  const [renameFlowName, setRenameFlowName] = useState("S01.png");
  const [renameSceneId, setRenameSceneId] = useState("");
  const [renameResult, setRenameResult] = useState("");
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const scenes = useMemo(
    () => (project ? [...project.scenes].sort((a, b) => a.index - b.index) : []),
    [project],
  );
  const aspect = project?.settings.aspectRatio ?? "16:9";
  const perVideo = generation === "videos" ? flowVideoCreditsPerVideo(videoModel, videoSeconds, videoResolution) : null;
  const estimated = perVideo === null ? null : perVideo * scenes.length;

  function jobs() {
    return scenes
      .filter((scene) => scene.prompt.trim() !== "")
      .map((scene) => ({
        sceneId: scene.id,
        fileName: `${formatTimecode(scene.id, scene.start, scene.end)}.${generation === "videos" ? "mp4" : "png"}`,
        prompt: generation === "videos" && scene.motionPrompt.trim() !== "" ? `${scene.prompt.trim()} ${scene.motionPrompt.trim()}` : scene.prompt,
        aspect,
      }));
  }

  async function guarded(job: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (caught) {
      setError(toAppError(caught, "Batch Flow Studio did not work."));
    } finally {
      setBusy(false);
    }
  }

  async function prepare() {
    await guarded(async () => {
      if (!project) return;
      const list = jobs();
      if (list.length === 0) throw new Error("No scene has a prompt to send.");
      const result = await flowBatchPrepareWith(list, generation, videoModel, videoSeconds, videoResolution);
      setPrepared(result);
      setReport(
        generation === "videos"
          ? `Prepared ${result.paragraphCount} prompts. Estimated cost: ${result.estimatedCredits} credits (${result.perVideoCredits} per video). Nothing has been generated yet.`
          : `Prepared ${result.paragraphCount} prompts (images are free tier). Nothing has been generated yet.`,
      );
    });
  }

  async function run() {
    await guarded(async () => {
      if (!project) return;
      const list = jobs();
      if (list.length === 0) throw new Error("No scene has a prompt to send.");
      const result = await flowBatchRun({
        projectId: project.id,
        jobs: list,
        generationType: generation,
        videoModel,
        videoSeconds,
        videoResolution,
      });
      const current = useProjectStore.getState().project;
      if (current && current.id === project.id) {
        if (generation === "images") {
          for (const saved of result.saved) {
            const fresh = useProjectStore.getState().project;
            if (!fresh || fresh.id !== project.id) break;
            const patch = registerImage(fresh, {
              sceneId: saved.sceneId,
              path: saved.path,
              name: saved.savedName,
              width: saved.width,
              height: saved.height,
              modified: saved.modified,
              regenerated: false,
            });
            if (patch) useProjectStore.getState().update(patch);
          }
        } else {
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
        }
      }
      const parts = [`${result.saved.length} saved`];
      if (result.failedSceneIds.length > 0) parts.push(`${result.failedSceneIds.length} failed (${result.failedSceneIds.join(", ")}) — their numbers were not reused`);
      if (generation === "videos") parts.push(`estimated ${result.estimatedCredits} credits`);
      setReport(parts.join(", ") + ".");
    });
  }

  async function renameOne() {
    await guarded(async () => {
      if (!project) return;
      const scene = scenes.find((s) => s.id === renameSceneId) ?? scenes[0];
      if (!scene) throw new Error("No scene to rename for.");
      const name = await flowBatchRename(renameFlowName.trim(), scene.id, scene.start, scene.end, generation);
      setRenameResult(`${renameFlowName.trim()} → ${name}`);
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5" aria-label="Batch Flow Studio">
      <h2 className="text-base font-semibold tracking-tight">Batch Flow Studio — in Flow&apos;s place</h2>
      <p className="text-sm text-muted">
        The user&apos;s own batch tool inside Google Flow, for images and videos together. It has taken the place of the old
        one-video-at-a-time Google Flow engine, which is no longer offered. The Gemini Canvas tool stays as the other image
        option. Prompts go as paragraphs — one paragraph per prompt, one blank line between prompts, never &quot;Prompt
        N:&quot; lines (live-verified: 20 prompts → 20 cards, S01–S20, all Ready, 0 credits for images) — and downloads
        arrive as <code>S01.png</code> / <code>S01.mp4</code>, which this panel renames from the scene record, e.g.{" "}
        <code>S01_000.0-008.0.png</code>. A video clip lasts only the chosen duration (4s–10s), so a longer scene needs
        more than one clip or a loop.
      </p>
      <p className="text-sm text-muted">
        Warning: a prompt with no character name gets &quot;Jin Kun&quot; locked in by the Flow tool itself, and the word
        &quot;Korean&quot; in a prompt is also auto-detected as an identity token. Configure the characters in the Flow
        tool itself if only one character is wanted — this app never sets Jin Kun.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void openExternalLink("flow_batch")}>
          Open Batch Flow Studio
        </Button>
        <Button onClick={() => void (async () => { setInfo(await flowBatchConfig()); })()}>Show defaults</Button>
      </div>
      {!project ? (
        <p className="text-sm text-muted">Open a project first to run a batch for its scenes.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Batch type">
            <Button variant={generation === "images" ? "primary" : undefined} onClick={() => { setGeneration("images"); setPrepared(null); }}>
              Images
            </Button>
            <Button variant={generation === "videos" ? "primary" : undefined} onClick={() => { setGeneration("videos"); setPrepared(null); }}>
              Videos
            </Button>
          </div>
          {generation === "videos" && (
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
                  : `${perVideo} credits per video · ${estimated ?? 0} credits estimated for ${scenes.length} videos · cap 20 per video`}
              </span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void prepare()} disabled={busy}>Prepare batch</Button>
            <Button variant="primary" onClick={() => void run()} disabled={busy || (generation === "videos" && perVideo === null)}>
              Run batch ({scenes.length} scenes)
            </Button>
          </div>
          {info && (
            <ul className="text-sm text-muted">
              <li>Tool: {info.url}</li>
              <li>
                Images: {info.imagesModel}, {info.aspect} · Videos: {info.videosModel}, Text to Video, {info.videoSeconds}s @{" "}
                {info.videoResolution}, {info.videoCreditsPerVideo} credits per video (cap {info.maxCreditsPerVideo})
              </li>
              <li>Batch size: {info.batchSize} at a time · Queue: per-card Download in card order, Download All only in batch order</li>
            </ul>
          )}
          {prepared && (
            <p className="text-sm text-muted">
              Prepared {prepared.paragraphCount} paragraphs. First downloads will be{" "}
              {prepared.renamePreview.slice(0, 3).map((item) => `${item.flowName} → ${item.timecodeName}`).join(", ")}
              {prepared.renamePreview.length > 3 ? ", …" : ""}.
            </p>
          )}
          {report && <p role="status" className="text-sm">{report}</p>}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
            <span className="text-muted">Rename a file downloaded by hand:</span>
            <input
              value={renameFlowName}
              onChange={(e) => setRenameFlowName(e.target.value)}
              className="rounded border border-line bg-surface px-2 py-1"
              aria-label="Flow file name, e.g. S01.png"
            />
            <select value={renameSceneId} onChange={(e) => setRenameSceneId(e.target.value)} className="rounded border border-line bg-surface px-2 py-1" aria-label="Scene">
              <option value="">First scene</option>
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>{scene.id}</option>
              ))}
            </select>
            <Button onClick={() => void renameOne()} disabled={busy}>Rename one Flow file</Button>
            {renameResult && <span>{renameResult}</span>}
          </div>
        </>
      )}
      {error && <ErrorNotice error={error} />}
    </section>
  );
}
