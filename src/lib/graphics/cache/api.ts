import { invoke } from "@tauri-apps/api/core";

import type { GraphicClip } from "../export/api.ts";

export interface CacheInfo {
  bytes: number;
  files: number;
  limitBytes: number;
}

export const restoreCached = (projectId: string, graphicId: string, key: string): Promise<GraphicClip | null> =>
  invoke<GraphicClip | null>("graphic_cache_restore", { projectId, graphicId, key });
export const storeCached = (projectId: string, graphicId: string, key: string, clip: GraphicClip): Promise<void> =>
  invoke("graphic_cache_store", { projectId, graphicId, key, frames: clip.frames, width: clip.width, height: clip.height });
export const cacheInfo = (): Promise<CacheInfo> => invoke<CacheInfo>("graphic_cache_info");
export const clearCache = (): Promise<void> => invoke("graphic_cache_clear");
