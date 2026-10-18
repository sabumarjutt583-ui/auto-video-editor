import { useEffect, useState } from "react";

import { projectDirPath } from "../media/api";

const known = new Map<string, string>();

/** The full path of the project folder (needed to build addresses of project files), or null while loading. */
export function useProjectDir(projectId: string): string | null {
  const [dir, setDir] = useState<string | null>(known.get(projectId) ?? null);
  useEffect(() => {
    const cached = known.get(projectId);
    if (cached) {
      setDir(cached);
      return undefined;
    }
    let stale = false;
    setDir(null);
    projectDirPath(projectId)
      .then((path) => {
        known.set(projectId, path);
        if (!stale) setDir(path);
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [projectId]);
  return dir;
}
