import { useCallback, useEffect, useMemo, useState } from "react";

import { toAppError } from "../../lib/errors";
import type { ActiveRun } from "../../lib/pipeline/dashboard";
import { listProjects } from "../../lib/projects";
import { usePipelineStore } from "../../store/pipelineStore";
import type { AppError, ProjectSummary } from "../../types";

/** The videos on disk and the run that is going on, for the Channels pages. Reloads while a run is going. */
export function useChannelData() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const run = usePipelineStore();

  const reload = useCallback(async () => {
    try {
      setProjects((await listProjects()).projects);
      setError(null);
    } catch (caught) {
      setError(toAppError(caught, "Your videos could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, run.running, run.waiting, run.projectId, run.finished]);

  useEffect(() => {
    if (!run.running) return;
    const timer = window.setInterval(() => void reload(), 4000);
    return () => window.clearInterval(timer);
  }, [run.running, reload]);

  const active: ActiveRun = useMemo(
    () => ({ projectId: run.projectId, running: run.running, waiting: run.waiting, failed: run.error !== null }),
    [run.projectId, run.running, run.waiting, run.error],
  );
  return { projects, loading, error, reload, active, run };
}
