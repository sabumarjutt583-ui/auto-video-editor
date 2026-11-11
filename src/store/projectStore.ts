import { create } from "zustand";
import { assertProjectAvailable, isProjectActive } from "../lib/pipeline/activity.ts";
import { invalidateProject } from "../lib/pipeline/invalidate.ts";

import { toAppError } from "../lib/errors";
import { openProject, saveProject } from "../lib/projects";
import type { AppError, Project, ProjectPatch } from "../types";

/** Changes are saved this long after the last edit. */
export const AUTOSAVE_DELAY_MS = 2000;

export type ProjectSaveState = "idle" | "saving" | "saved" | "error";

interface ProjectState {
  /** The project that is open, or null. */
  project: Project | null;
  saveState: ProjectSaveState;
  saveError: AppError | null;
  /** Opens a project (saving the current one first). Throws an AppError if it cannot be opened. */
  open: (id: string) => Promise<void>;
  /** Saves any pending change, then closes the project. */
  close: () => Promise<void>;
  /** Closes without saving. Use after the project's folder was deleted. */
  discard: () => void;
  /** Changes the open project. It is saved automatically a moment later. */
  update: (patch: ProjectPatch) => void;
  /** Saves right now if there is a pending change. */
  flush: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveChain: Promise<void> = Promise.resolve();
let revision = 0;
let dirty = false;

export const useProjectStore = create<ProjectState>((set, get) => {
  async function persist(): Promise<void> {
    const snapshot = get().project;
    if (!snapshot || !dirty) return;
    const savedRevision = revision;
    try {
      const updatedAt = await saveProject(snapshot);
      const current = get().project;
      if (current && current.id === snapshot.id) set({ project: { ...current, updatedAt } });
      // If something was edited while saving, another save is already on its way.
      if (savedRevision === revision) {
        dirty = false;
        set({ saveState: "saved", saveError: null });
      }
    } catch (error) {
      set({ saveState: "error", saveError: toAppError(error, "Your project could not be saved.") });
    }
  }

  /** Saves run one after another so an older save can never overwrite a newer one. */
  function enqueueSave(): Promise<void> {
    saveChain = saveChain.then(persist);
    return saveChain;
  }

  function scheduleSave(): void {
    clearTimeout(saveTimer);
    set({ saveState: "saving" });
    saveTimer = setTimeout(() => void enqueueSave(), AUTOSAVE_DELAY_MS);
  }

  function reset(project: Project | null): void {
    clearTimeout(saveTimer);
    revision += 1;
    dirty = false;
    set({ project, saveState: "idle", saveError: null });
  }

  return {
    project: null,
    saveState: "idle",
    saveError: null,

    open: async (id) => {
      assertProjectAvailable(id);
      if (get().project?.id === id && isProjectActive(id)) return;
      await get().flush();
      if (dirty) throw get().saveError ?? new Error("Please save your changes before opening another project.");
      const project = await openProject(id);
      // Edits may arrive while the next project is loading.
      await get().flush();
      if (dirty) throw get().saveError ?? new Error("Please save your changes before opening another project.");
      assertProjectAvailable(id);
      reset(project);
    },

    close: async () => {
      assertProjectAvailable(null);
      await get().flush();
      if (dirty) throw get().saveError ?? new Error("Please save your changes before closing the project.");
      assertProjectAvailable(null);
      reset(null);
    },

    discard: () => { assertProjectAvailable(null); reset(null); },

    update: (patch) => {
      const current = get().project;
      if (!current) return;
      if (patch.activePartId !== undefined && patch.activePartId !== current.activePartId) assertProjectAvailable(null);
      revision += 1;
      dirty = true;
      set({ project: { ...current, ...invalidateProject(current, patch) } });
      scheduleSave();
    },

    flush: async () => {
      clearTimeout(saveTimer);
      if (dirty) await enqueueSave();
      else await saveChain;
      // Edits received during the write must be durable before a checkpoint or
      // navigation completes. A failed write stays dirty for an explicit retry.
      while (dirty && get().saveState !== "error") await enqueueSave();
      clearTimeout(saveTimer);
      if (dirty) throw get().saveError ?? new Error("The project could not be saved. Please try again before continuing.");
    },
  };
});
