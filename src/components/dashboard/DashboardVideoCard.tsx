import { AlertTriangle, Check, FolderOpen, Loader2, Pause, Play, RotateCw, Square, Video } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { sevenStepCurrent, sevenStepsFromSummary } from "../../lib/pipeline/sevenSteps";
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
          <Button variant="danger" icon={Square} onClick={run.cancel}>
            Cancel
          </Button>
        )}
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
    </article>
  );
}
