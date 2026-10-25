import { useCallback, useEffect, useRef, useState } from "react";

import { toAppError } from "../../lib/errors";
import { imagegenMakeVideo, imagegenVideoStatus } from "../../lib/imagegen/api";
import { registerVideo, runVideoQueue, type VideoItem } from "../../lib/imagegen/video";
import { useProjectStore } from "../../store/projectStore";
import type { AppError } from "../../types";
import type { VideoStatus } from "../../types/imagegen";

export type SceneVideoState = { kind: "queued" } | { kind: "making" } | { kind: "done" } | { kind: "failed"; error: AppError };

export interface VideoMaker {
  status: VideoStatus | null;
  states: Readonly<Record<string, SceneVideoState>>;
  running: boolean;
  /** Epoch ms the queue waits for (every account is out of videos), or null. */
  waitingFor: number | null;
  summary: string;
  start: (items: VideoItem[], autoContinue: boolean) => Promise<void>;
  stop: () => void;
}

/** Runs the video queue of the open project: one video per ready Google account at a time. */
export function useVideoMaker(projectId: string, ensureConsent: () => Promise<boolean>): VideoMaker {
  const [status, setStatus] = useState<VideoStatus | null>(null);
  const [states, setStates] = useState<Record<string, SceneVideoState>>({});
  const [running, setRunning] = useState(false);
  const [waitingFor, setWaitingFor] = useState<number | null>(null);
  const [summary, setSummary] = useState("");
  const stopped = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await imagegenVideoStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const set = (sceneId: string, state: SceneVideoState) => setStates((current) => ({ ...current, [sceneId]: state }));

  const start = useCallback(
    async (items: VideoItem[], autoContinue: boolean) => {
      if (items.length === 0 || !(await ensureConsent())) return;
      stopped.current = false;
      setRunning(true);
      setSummary("");
      setStates(Object.fromEntries(items.map((item) => [item.sceneId, { kind: "queued" } as SceneVideoState])));
      let ready = (await imagegenVideoStatus().catch(() => null))?.ready ?? 1;
      try {
        const report = await runVideoQueue(items, {
          make: async (item) => {
            set(item.sceneId, { kind: "making" });
            ready = (await imagegenVideoStatus().catch(() => null))?.ready ?? ready;
            try {
              return await imagegenMakeVideo(projectId, item.prompt, item.image, item.fileName, `video-${item.sceneId}-${Date.now()}`);
            } catch (caught) {
              const error = toAppError(caught, "The video could not be made.");
              // A scene that only waits for an account goes back to the line.
              set(item.sceneId, /video_wait|video_busy/.test(error.details) ? { kind: "queued" } : { kind: "failed", error });
              throw error;
            } finally {
              void refresh();
            }
          },
          onMade: (item, video) => {
            const project = useProjectStore.getState().project;
            const patch = project && project.id === projectId ? registerVideo(project, item.sceneId, video) : null;
            if (patch) useProjectStore.getState().update(patch);
            set(item.sceneId, { kind: "done" });
          },
          onFailed: () => undefined,
          onWaiting: setWaitingFor,
          concurrency: () => Math.max(1, ready),
          isStopped: () => stopped.current,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: () => Date.now(),
          autoContinue,
        });
        const parts = [`${report.made} made`];
        if (report.failed > 0) parts.push(`${report.failed} failed`);
        if (report.left.length > 0) parts.push(`${report.left.length} not made yet (press the button again when accounts have videos)`);
        setSummary(parts.join(", ") + ".");
      } finally {
        setRunning(false);
        setWaitingFor(null);
        void refresh();
      }
    },
    [projectId, ensureConsent, refresh],
  );

  const stop = useCallback(() => {
    stopped.current = true;
  }, []);

  return { status, states, running, waitingFor, summary, start, stop };
}
