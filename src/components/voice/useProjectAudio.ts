import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { getWaveform, projectFilePath } from "../../lib/audio";
import { toAppError } from "../../lib/errors";
import type { AppError, Waveform } from "../../types";

interface ProjectAudio {
  /** URL the player can load, or null while loading or when it failed. */
  url: string | null;
  waveform: Waveform | null;
  error: AppError | null;
}

/** Loads the waveform peaks and the playable URL of a project audio file. */
export function useProjectAudio(projectId: string, path: string | null, version: number): ProjectAudio {
  const [state, setState] = useState<ProjectAudio>({ url: null, waveform: null, error: null });

  useEffect(() => {
    if (path === null) {
      setState({ url: null, waveform: null, error: null });
      return;
    }
    let stale = false;
    setState({ url: null, waveform: null, error: null });
    Promise.all([projectFilePath(projectId, path), getWaveform(projectId, path)])
      .then(([absolute, waveform]) => {
        // `version` in the address makes the player load the new file after it was rebuilt.
        if (!stale) setState({ url: `${convertFileSrc(absolute)}?v=${version}`, waveform, error: null });
      })
      .catch((error: unknown) => {
        if (!stale) setState({ url: null, waveform: null, error: toAppError(error, "The audio could not be loaded.") });
      });
    return () => {
      stale = true;
    };
  }, [projectId, path, version]);

  return state;
}
