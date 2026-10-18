import { useCallback, useEffect, useState } from "react";

import { toAppError } from "../../lib/errors";
import { listProjects } from "../../lib/projects";
import type { AppError, ProjectList } from "../../types";

const EMPTY: ProjectList = { projects: [], unreadable: [] };

/** Loads the project list from disk, and again whenever `reload` is called. */
export function useProjectList() {
  const [list, setList] = useState<ProjectList>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);

  const reload = useCallback(async () => {
    try {
      setList(await listProjects());
      setError(null);
    } catch (caught) {
      setError(toAppError(caught, "Your projects could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { list, loading, error, reload };
}
