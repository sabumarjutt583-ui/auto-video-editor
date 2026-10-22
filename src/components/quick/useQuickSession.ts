import { useCallback, useState } from "react";

import { toAppError } from "../../lib/errors";
import { quickOpen, quickReset, quickSaveAsProject } from "../../lib/quick/api";
import { QUICK_ID } from "../../lib/quick/textScenes";
import { useProjectStore } from "../../store/projectStore";
import { useQuickStore } from "../../store/quickStore";
import type { AppError } from "../../types";

export interface QuickSession {
  error: AppError | null;
  busy: boolean;
  /** Opens the quick session (saving the open project first). */
  enter: () => Promise<void>;
  /** Goes back to the project that was open before, or closes the session when there was none. */
  leave: () => Promise<void>;
  /** Asks nothing: the caller confirms first. Clears the session and its temporary files. */
  startNew: () => Promise<void>;
  /** Turns the session into a normal project and opens it. Resolves to the new project id. */
  saveAsProject: (name: string) => Promise<string | null>;
}

/** Opening, leaving, clearing and saving the quick session. */
export function useQuickSession(): QuickSession {
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async <T,>(failure: string, work: () => Promise<T>): Promise<T | null> => {
    setError(null);
    setBusy(true);
    try {
      return await work();
    } catch (caught) {
      setError(toAppError(caught, failure));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const enter = useCallback(async () => {
    await run("The quick session could not be opened.", async () => {
      const store = useProjectStore.getState();
      const current = store.project;
      if (current && current.id !== QUICK_ID) useQuickStore.getState().setLastProject({ id: current.id, name: current.name });
      await store.flush();
      const opened = await quickOpen();
      await useProjectStore.getState().open(QUICK_ID);
      useQuickStore.getState().setRestoredNote(opened.restored);
    });
  }, [run]);

  const leave = useCallback(async () => {
    await run("The project could not be opened.", async () => {
      const last = useQuickStore.getState().lastProject;
      await useProjectStore.getState().flush();
      if (last) await useProjectStore.getState().open(last.id);
      else await useProjectStore.getState().close();
      useQuickStore.getState().setRestoredNote(false);
    });
  }, [run]);

  const startNew = useCallback(async () => {
    await run("A new quick session could not be started.", async () => {
      // Save what is pending first, so a late autosave cannot hit the folder that is about to be deleted.
      await useProjectStore.getState().flush();
      await quickReset();
      await useProjectStore.getState().open(QUICK_ID);
      useQuickStore.getState().setRestoredNote(false);
    });
  }, [run]);

  const saveAsProject = useCallback(
    async (name: string) =>
      run("The project could not be saved.", async () => {
        await useProjectStore.getState().flush();
        const summary = await quickSaveAsProject(name);
        await useProjectStore.getState().open(summary.id);
        useQuickStore.getState().setLastProject(null);
        useQuickStore.getState().setRestoredNote(false);
        return summary.id;
      }),
    [run],
  );

  return { error, busy, enter, leave, startNew, saveAsProject };
}
