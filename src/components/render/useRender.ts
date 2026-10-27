import { useEffect, useRef, useState } from "react";

import { listEncoders, renderVideo, type EncoderInfo, type RenderResult } from "../../lib/render/api";
import { buildRenderRequest, renderProblems, shortsAspect, todayStamp } from "../../lib/render/request";
import { applyCaptionOverrides } from "../../lib/captions/overrides";
import { isCancelled, toAppError } from "../../lib/errors";
import { useProjectStore } from "../../store/projectStore";
import { runJob, selectJob, useJobStore, type JobInfo } from "../../store/jobStore";
import type { AppError, CaptionLine, CaptionStyle, EditorData, Project, SfxCue } from "../../types";
import type { FontInfo } from "../../lib/captions/fonts";

export interface RenderView {
  job: JobInfo | null;
  /** Seconds since the render started (0 when idle). */
  elapsed: number;
  result: RenderResult | null;
  error: AppError | null;
  /** True when the last render was cancelled. */
  cancelled: boolean;
  encoders: EncoderInfo[] | null;
  problems: string[];
  start: (shorts: boolean) => Promise<void>;
}

interface Inputs {
  project: Project;
  editor: EditorData;
  exists: Readonly<Record<string, boolean>>;
  captionLines: readonly CaptionLine[];
  captionStyle: CaptionStyle;
  font: FontInfo;
  cues: readonly SfxCue[];
}

/** Starts renders and follows them. The finished video is described by `result`. */
export function useRender(inputs: Inputs): RenderView {
  const { project } = inputs;
  const job = useJobStore(selectJob(["render"]));
  const [result, setResult] = useState<RenderResult | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [encoders, setEncoders] = useState<EncoderInfo[] | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    let stale = false;
    listEncoders()
      .then((list) => {
        if (!stale) setEncoders(list);
      })
      .catch(() => {
        if (!stale) setEncoders([]);
      });
    return () => {
      stale = true;
    };
  }, []);

  useEffect(() => {
    if (!job) return undefined;
    const timer = window.setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 1000);
    return () => window.clearInterval(timer);
  }, [job]);

  const start = async (shorts: boolean) => {
    setError(null);
    setResult(null);
    setCancelled(false);
    const { aspect, suffix } = shortsAspect(project.settings.aspectRatio, shorts);
    const request = buildRenderRequest({ ...inputs, captionLines: applyCaptionOverrides(inputs.captionLines, project.scenes, project.captionOverrides), aspect, quality: project.settings.quality, suffix, date: todayStamp() });
    startedAt.current = Date.now();
    setElapsed(0);
    try {
      const done = await runJob("render", "Starting the render", (id) => renderVideo(project.id, request, id));
      setResult(done);
      // Not an edit (no Undo step): the project only remembers when it was last rendered.
      useProjectStore.getState().update({ renderedAt: new Date().toISOString(), exportDurationSeconds: done.duration, exportSizeBytes: done.sizeBytes });
    } catch (e) {
      if (isCancelled(e)) setCancelled(true);
      else setError(toAppError(e, "The video could not be rendered."));
    }
  };

  return { job, elapsed, result, error, cancelled, encoders, problems: renderProblems(project), start };
}
