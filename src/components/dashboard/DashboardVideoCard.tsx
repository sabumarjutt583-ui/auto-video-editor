import { AlertTriangle, Check, FolderOpen, Loader2, Pause, Play, RotateCw, Square, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { sevenStepCurrent, sevenStepsFromSummary } from "../../lib/pipeline/sevenSteps";
import { apiMonitorList, type ApiCallEntry } from "../../lib/apiMonitor";
import { graphicsApplyOverlay, SAMPLE_SPEC, type DrawResult } from "../../lib/graphicsOverlay";
import { scriptOpenLive } from "../../lib/script/api";
import { Modal } from "../ui";
import type { VideoState } from "../../lib/pipeline/dashboard";
import type { ChannelProfile } from "../../lib/pipeline/profile";
import { latestVideo, openProjectFolder, playVideo, showInFolder } from "../../lib/render/api";
import type { AppError, ProjectSummary } from "../../types";
import { toAppError } from "../../lib/errors";
import { ErrorNotice } from "../ErrorNotice";
import { Button } from "../ui";
import { usePipelineStore } from "../../store/pipelineStore";
import { useProjectStore } from "../../store/projectStore";
import type { ConsentFn } from "../channels/types";
import { SevenStepBar } from "./SevenStepBar";

const STATE_TEXT: Record<VideoState, string> = {
  running: "In progress",
  waiting: "Waiting for you",
  failed: "Needs a look",
  stopped: "Stopped",
  finished: "Finished",
  empty: "Empty",
};

const STATE_TONE: Record<VideoState, string> = {
  running: "text-accent",
  waiting: "text-warning",
  failed: "text-danger",
  stopped: "text-muted",
  finished: "text-success",
  empty: "text-muted",
};

interface Props {
  video: ProjectSummary;
  state: VideoState;
  /** Shown when videos of several channels are listed together. */
  channelName?: string;
  /** The profile used to continue the video, or null when its channel is gone. */
  profile: ChannelProfile | null;
  busy: boolean;
  ensureConsent: ConsentFn;
}

/** One video on the Dashboard: the brother tool's 7-step bar, and the buttons that fit its state.
The buttons reuse the same store calls as the Channels list (Continue, Stop, Cancel, resume,
Play, Show video, Project folder) — nothing here runs a step on its own. */
export function DashboardVideoCard({ video, state, channelName, profile, busy, ensureConsent }: Props) {
  const navigate = useNavigate();
  const run = usePipelineStore();
  const [error, setError] = useState<AppError | null>(null);
  const rows = sevenStepsFromSummary(video);
  const now = sevenStepCurrent(rows);
  const current = now ? rows.find((row) => row.id === now) : undefined;
  const [note, setNote] = useState<string | null>(null);
  const [showMonitor, setShowMonitor] = useState(false);
  const [calls, setCalls] = useState<ApiCallEntry[]>([]);
  const [showScript, setShowScript] = useState(false);
  const [showGraphics, setShowGraphics] = useState(false);
  const [graphicsOn, setGraphicsOn] = useState(false);
  const [specText, setSpecText] = useState(SAMPLE_SPEC);
  const [graphicsResult, setGraphicsResult] = useState<DrawResult | null>(null);
  const [graphicsBusy, setGraphicsBusy] = useState(false);

  const applyGraphics = () =>
    attempt(async () => {
      setGraphicsBusy(true);
      try {
        const path = await latestVideo(video.id);
        if (!path) throw new Error("This video has no finished file yet.");
        const result = await graphicsApplyOverlay(video.id, path, specText);
        setGraphicsResult(result);
      } finally {
        setGraphicsBusy(false);
      }
    }, "The graphic overlay could not be applied.");
  const [scriptText, setScriptText] = useState("");
  const liveRow = run.projectId === video.id && run.running ? run.view.rows.find((row) => row.state === "running" || row.state === "waiting") : undefined;
  const liveLabel = liveRow ? rows.find((row) => row.id === liveRow.id)?.label ?? liveRow.id : null;
  const interrupted = state === "stopped" && video.makeVideoRun?.status === "running";
  const pausedOnDisk = state === "stopped" && video.makeVideoRun?.status === "paused";
  const formatDuration = (seconds: number) => `${seconds.toFixed(1)} s`;
  const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`);

  useEffect(() => {
    if (!showMonitor) return undefined;
    let live = true;
    const load = () => {
      void apiMonitorList().then((list) => {
        if (live) setCalls(list);
      }).catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 3000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [showMonitor]);

  const openScript = () =>
    attempt(async () => {
      await useProjectStore.getState().open(video.id);
      setScriptText(useProjectStore.getState().project?.script ?? "");
      setShowScript(true);
    }, "The script could not be opened.");

  const saveScript = async () => {
    await useProjectStore.getState().update({ script: scriptText });
    await useProjectStore.getState().flush();
    setShowScript(false);
  };

  const openDocument = () =>
    attempt(async () => {
      await openProjectFolder(video.id);
      setNote("No separate document file for this video — the project folder was opened instead.");
    }, "The folder could not be opened.");

  async function attempt(action: () => Promise<void>, fallback: string) {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(toAppError(caught, fallback));
    }
  }

  const withVideo = (use: (path: string) => Promise<void>) =>
    attempt(async () => {
      const path = await latestVideo(video.id);
      if (!path) throw new Error("This video has no finished file yet.");
      await use(path);
    }, "The video could not be opened.");

  const openProject = () =>
    attempt(async () => {
      await useProjectStore.getState().open(video.id);
      navigate("/prompt-generator");
    }, "The project could not be opened.");

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5" data-state={state}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{video.name}</h3>
          <p className="text-xs text-muted">
            {channelName ? `${channelName} · ` : ""}
            {current ? `Now: ${current.label}` : "All steps finished"}
          </p>
          {liveRow && liveLabel && (
            <p className="text-xs text-accent">
              Live: {liveLabel}
              {liveRow.detail ? ` — ${liveRow.detail}` : ""}
            </p>
          )}
          {run.paused && run.projectId === video.id && <p className="text-xs text-warning">Paused between steps — press Resume to carry on.</p>}
          {interrupted && <p className="text-xs text-warning">Last run was interrupted (the app closed or crashed) — Continue where it stopped below. Finished steps are not redone.</p>}
          {pausedOnDisk && <p className="text-xs text-warning">Paused — continue where it stopped below.</p>}
          {video.exportDurationSeconds != null && video.exportSizeBytes != null && (
            <p className="text-xs text-muted">
              Finished video: {formatDuration(video.exportDurationSeconds)} · {formatSize(video.exportSizeBytes)}
            </p>
          )}
        </div>
        <span className={`flex items-center gap-1.5 text-sm font-medium ${STATE_TONE[state]}`}>
          {state === "running" && <Loader2 size={14} className="animate-spin" aria-hidden />}
          {state === "waiting" && <Pause size={14} aria-hidden />}
          {state === "failed" && <AlertTriangle size={14} aria-hidden />}
          {state === "finished" && <Check size={14} aria-hidden />}
          {STATE_TEXT[state]}
        </span>
      </header>

      <SevenStepBar rows={rows} label={`${video.name} progress`} />

      {error && <ErrorNotice error={error} />}
      {note && <p className="text-xs text-muted">{note}</p>}

      <div className="flex flex-wrap gap-2">
        {state === "finished" && (
          <>
            <Button variant="primary" icon={Play} onClick={() => void withVideo((path) => playVideo(video.id, path))}>
              Play video
            </Button>
            <Button icon={Video} onClick={() => void withVideo((path) => showInFolder(video.id, path))}>
              Show video
            </Button>
          </>
        )}
        {state === "waiting" && (
          <>
            <Button variant="primary" icon={Play} onClick={() => run.answer(true)}>
              Continue
            </Button>
            <Button onClick={() => run.answer(false)}>Stop here</Button>
          </>
        )}
        {state === "running" && (
          <>
            {run.paused ? (
              <Button variant="primary" icon={Play} onClick={run.resumeRun}>
                Resume
              </Button>
            ) : (
              <Button icon={Pause} onClick={run.pause}>
                Pause
              </Button>
            )}
            <Button variant="danger" icon={Square} onClick={run.cancel}>
              Cancel
            </Button>
          </>
        )}
        <Button onClick={() => void attempt(() => scriptOpenLive(null), "The Claude page could not be opened.")}>Show Live Claude</Button>
        <Button onClick={() => setShowMonitor(true)}>API Monitor</Button>
        <Button onClick={() => void openScript()}>Open Script</Button>
        <Button onClick={() => void openDocument()}>Open Document</Button>
        {state === "finished" && <Button onClick={() => setShowGraphics(true)}>Motion graphics</Button>}
        {(state === "stopped" || state === "failed") && profile && (
          <Button variant="primary" icon={RotateCw} disabled={busy} onClick={() => void run.continueProject(video.id, profile, ensureConsent)}>
            Continue where it stopped
          </Button>
        )}
        <Button icon={FolderOpen} onClick={() => void attempt(() => openProjectFolder(video.id), "The folder could not be opened.")}>
          Project folder
        </Button>
        <Button onClick={() => void openProject()}>Open project</Button>
      </div>
      {showMonitor && (
        <Modal title="API Monitor — recent API calls" onClose={() => setShowMonitor(false)}>
          <p className="text-xs text-muted">Only the provider, key slot number, time and result are shown here. No key value, prompt or answer is ever recorded.</p>
          {calls.length === 0 ? (
            <p className="text-sm text-muted">No API calls yet in this session.</p>
          ) : (
            <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
              {calls.map((call, i) => (
                <li key={`${call.timeMs}-${i}`} className="flex flex-wrap gap-2 text-xs">
                  <span>{new Date(call.timeMs).toLocaleTimeString()}</span>
                  <span>{call.provider}</span>
                  <span>Key {call.slot}</span>
                  <span>{call.result}</span>
                  {call.detail && <span className="text-muted">{call.detail}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setShowMonitor(false)}>
              Close
            </Button>
          </div>
        </Modal>
      )}
      {showGraphics && (
        <Modal title="Motion graphics overlay" onClose={() => setShowGraphics(false)}>
          <p className="text-xs text-muted">
            Draws text and lower-third layers from a graphic spec over the finished video (a new file, <code>-graphics.mp4</code>, is saved in exports; the original is untouched). Other layer types (map, chart, timeline, …) are skipped — they still need the frontend graphic export.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={graphicsOn} onChange={(e) => setGraphicsOn(e.target.checked)} />
            Motion graphics on (default off — existing renders do not change unless you enable this)
          </label>
          <textarea value={specText} onChange={(e) => setSpecText(e.target.value)} rows={14} className="w-full resize-y rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs" disabled={!graphicsOn} />
          {graphicsResult && (
            <p className="text-xs text-muted">
              Applied: {graphicsResult.filters.length} filter(s).
              {graphicsResult.skipped.length > 0 ? ` Skipped layer types: ${graphicsResult.skipped.join(", ")}.` : " Nothing skipped."} The new file is in the project's exports folder.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setShowGraphics(false)}>Close</Button>
            <Button variant="primary" disabled={!graphicsOn || graphicsBusy} onClick={() => void applyGraphics()}>
              Apply to finished video
            </Button>
          </div>
        </Modal>
      )}
      {showScript && (
        <Modal title="Project script" onClose={() => setShowScript(false)}>
          <p className="text-xs text-muted">Edit the script here. It is saved back to the project; the next run uses the edited script.</p>
          <textarea value={scriptText} onChange={(e) => setScriptText(e.target.value)} rows={16} className="w-full resize-y rounded-lg border border-line bg-surface-2 p-3 text-sm" />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setShowScript(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void saveScript()}>
              Save script
            </Button>
          </div>
        </Modal>
      )}
    </article>
  );
}
