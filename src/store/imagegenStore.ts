import { create } from "zustand";

import { toAppError } from "../lib/errors";
import {
  imagegenMediaInfo,
  imagegenSetSettings,
  imagegenState,
  listenImageGenState,
  listenSavedImage,
} from "../lib/imagegen/api";
import { registerImage, unregisteredFiles, withScene } from "../lib/imagegen/register";
import { projectDirPath } from "../lib/media/api";
import type { AppError } from "../types";
import type { ImageGenSettings, ImageGenSnapshot, SavedImage } from "../types/imagegen";
import { useProjectStore } from "./projectStore";

interface ImageGenState {
  snapshot: ImageGenSnapshot | null;
  error: AppError | null;
  /** Reads the state once and starts listening to the engine's events. Safe to call again. */
  init: () => Promise<void>;
  /** Saves new engine settings (shown at once, then stored by Rust). */
  saveSettings: (patch: Partial<ImageGenSettings>) => Promise<void>;
  /** Puts finished pictures that are missing in the open project's media list into the project. */
  reconcile: () => Promise<void>;
  setError: (error: AppError | null) => void;
}

let started = false;
// Pictures are added to the project one after another so two events never overwrite each other.
let chain: Promise<void> = Promise.resolve();

async function register(image: SavedImage): Promise<void> {
  const project = useProjectStore.getState().project;
  if (!project) return;
  const dir = await projectDirPath(project.id);
  // Read the project again after the wait: it may have changed.
  const current = useProjectStore.getState().project;
  if (!current || current.id !== project.id || dir !== image.projectDir) return;
  const patch = registerImage(current, image);
  if (patch) useProjectStore.getState().update(patch);
}

export const useImageGenStore = create<ImageGenState>((set, get) => ({
  snapshot: null,
  error: null,

  init: async () => {
    if (started) return;
    started = true;
    try {
      await listenImageGenState((snapshot) => set({ snapshot }));
      await listenSavedImage((image) => {
        chain = chain.then(() => register(image)).catch(() => undefined);
      });
      set({ snapshot: await imagegenState(), error: null });
    } catch (error) {
      started = false;
      set({ error: toAppError(error, "The Image Generator could not be started.") });
    }
  },

  saveSettings: async (patch) => {
    const snapshot = get().snapshot;
    if (!snapshot) return;
    const settings = { ...snapshot.settings, ...patch };
    set({ snapshot: { ...snapshot, settings } });
    try {
      await imagegenSetSettings(settings);
      set({ error: null });
    } catch (error) {
      set({ error: toAppError(error, "The settings could not be saved."), snapshot: await imagegenState().catch(() => snapshot) });
    }
  },

  reconcile: async () => {
    const snapshot = get().snapshot;
    const project = useProjectStore.getState().project;
    if (!snapshot || !project || snapshot.projectDir === null) return;
    if ((await projectDirPath(project.id)) !== snapshot.projectDir) return;
    const missing = unregisteredFiles(project, snapshot.jobs);
    if (missing.length === 0) return;
    const infos = await imagegenMediaInfo(project.id, missing.map((m) => m.path));
    const dir = snapshot.projectDir;
    for (const [index, info] of infos.entries()) {
      const item = missing[index];
      if (!info || !item) continue;
      const image = { ...withScene(info, item.sceneId), projectDir: dir, regenerated: false, alreadySaved: true };
      chain = chain.then(() => register(image)).catch(() => undefined);
    }
    await chain;
  },

  setError: (error) => set({ error }),
}));
