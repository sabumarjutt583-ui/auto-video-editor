import { AlertTriangle, Check, FolderOpen, Loader2, Pause, Play, RotateCw, Square, Video } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { toAppError } from "../../lib/errors";
import { currentStage, percentOf, stageProgress, type VideoState } from "../../lib/pipeline/dashboard";
import type { ChannelProfile } from "../../lib/pipeline/profile";
import { stageLabel } from "../../lib/pipeline/stages";
import { latestVideo, openProjectFolder, playVideo, showInFolder } from "../../lib/render/api";
import type { AppError, ProjectSummary } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button } from "../ui";
import { useProjectStore } from "../../store/projectStore";

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
  /** The channel name, shown when videos of several channels are listed together. */
  channelName?: string;
  /** The profile used to continue the video, or null when its channel is gone. */
  profile: ChannelProfile | null;
  busy: boolean;
  onContinue: (video: ProjectSummary, profile: ChannelProfile) => void;
  onCancel: () => void;
  onAnswer: (go: boolean) => void;
}

/** One video: its steps with progress and the buttons that fit its state. */
export function VideoRow({ video, state, channelName, profile, busy, onContinue, onCancel, onAnswer }: Props) {
  const navigate = useNavigate();
  const [error, setError] = useState<AppError | null>(null);
  const rows = stageProgress(video);
  const now = currentStage(video);
  const percent = percentOf(video);

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
            {now ? `Now: ${stageLabel(now)}` : "All steps finished"}
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

      <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${video.name} progress`}>
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percent}%` }} />
      </div>
      <ol className="grid grid-cols-4 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-8">
        {rows.map((row) => (
          <li key={row.id} className={row.done ? "text-success" : row.id === now ? "text-fg" : "text-muted"}>
            <span className="flex items-center gap-1">
              {row.done ? <Check size={12} aria-hidden /> : <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
              {stageLabel(row.id)}
            </span>
            {row.detail && <span className="block pl-4 text-muted">{row.detail}</span>}
          </li>
        ))}
      </ol>

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
            <Button variant="primary" icon={Play} onClick={() => onAnswer(true)}>
              Continue
            </Button>
            <Button onClick={() => onAnswer(false)}>Stop here</Button>
          </>
        )}
        {state === "running" && (
          <Button variant="danger" icon={Square} onClick={onCancel}>
            Cancel
          </Button>
        )}
        {(state === "stopped" || state === "failed") && profile && (
          <Button variant="primary" icon={RotateCw} disabled={busy} onClick={() => onContinue(video, profile)}>
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
