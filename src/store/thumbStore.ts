import { create } from "zustand";

import { makeThumbnails, projectDirPath } from "../lib/media/api";
import { projectFileUrl } from "../lib/media/urls";
import type { MediaFile } from "../types";
import { runJob } from "./jobStore";

interface ThumbState {
  projectId: string | null;
  dir: string | null;
  /** media path -> thumbnail addresses (one for a picture, a few for a clip, empty when none could be made). */
  urls: Record<string, string[]>;
  /** Makes (or finds) the thumbnails of these files. Files already known are skipped. */
  ensure: (projectId: string, files: readonly MediaFile[]) => Promise<void>;
  forget: (paths: readonly string[]) => void;
}

const WIDTH = 320;
const FRAMES = 3;
const pending = new Set<string>();

export const useThumbStore = create<ThumbState>((set, get) => ({
  projectId: null,
  dir: null,
  urls: {},
  ensure: async (projectId, files) => {
    if (get().projectId !== projectId) set({ projectId, dir: null, urls: {} });
    const todo = files.filter((f) => !(f.path in get().urls) && !pending.has(`${projectId}:${f.path}`));
    if (todo.length === 0) return;
    for (const f of todo) pending.add(`${projectId}:${f.path}`);
    try {
      let dir = get().dir;
      if (dir === null) {
        dir = await projectDirPath(projectId);
        set({ dir });
      }
      const base = dir;
      const results = await runJob("thumbs", "Making preview pictures", (jobId) =>
        makeThumbnails(projectId, todo.map((f) => ({ path: f.path, kind: f.kind, duration: f.duration })), WIDTH, FRAMES, jobId),
      );
      if (get().projectId !== projectId) return;
      const add: Record<string, string[]> = {};
      for (const result of results) add[result.path] = result.thumbs.map((t) => projectFileUrl(base, t));
      set((state) => ({ urls: { ...state.urls, ...add } }));
    } catch {
      // Without thumbnails the lists still work; they show an icon instead.
      set((state) => ({ urls: { ...state.urls, ...Object.fromEntries(todo.map((f) => [f.path, [] as string[]])) } }));
    } finally {
      for (const f of todo) pending.delete(`${projectId}:${f.path}`);
    }
  },
  forget: (paths) =>
    set((state) => {
      const urls = { ...state.urls };
      for (const p of paths) delete urls[p];
      return { urls };
    }),
}));
