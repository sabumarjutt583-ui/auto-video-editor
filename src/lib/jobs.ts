import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { JobProgress } from "../types";

/** Calls `handler` for every progress update from a background job. */
export function listenJobProgress(handler: (progress: JobProgress) => void): Promise<UnlistenFn> {
  return listen<JobProgress>("job-progress", (event) => handler(event.payload));
}
