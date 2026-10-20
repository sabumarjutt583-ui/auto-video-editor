import { create } from "zustand";

import { relaunch } from "@tauri-apps/plugin-process";

import { checkAppUpdate, installAppUpdate, type AppUpdateInfo } from "../lib/appUpdate/api";
import { isCancelled, toAppError } from "../lib/errors";
import type { AppError } from "../types";
import { requestCancel, runJob, useJobStore, type JobInfo } from "./jobStore";
import { useSettingsStore } from "./settingsStore";

interface AppUpdateState {
  available: AppUpdateInfo | null;
  checking: boolean;
  installing: boolean;
  /** Said after a manual check that found nothing. */
  message: string | null;
  error: AppError | null;
  dismissed: boolean;
  /** Long tasks that are running. The update waits until they are done or cancelled. */
  blockedBy: JobInfo[];
  /** `quiet` is for the check at startup: no message when nothing is found or the internet is down. */
  check: (quiet: boolean) => Promise<void>;
  install: () => Promise<void>;
  /** Stops the running tasks that block the update. */
  cancelBlocking: () => void;
  dismiss: () => void;
}

/** Jobs that must not be interrupted by an update (everything except the update itself). */
function runningTasks(): JobInfo[] {
  return Object.values(useJobStore.getState().jobs).filter((job) => job.kind !== "app-update");
}

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  available: null,
  checking: false,
  installing: false,
  message: null,
  error: null,
  dismissed: false,
  blockedBy: [],
  check: async (quiet) => {
    if (get().checking || get().installing) return;
    set({ checking: true, message: null, error: quiet ? get().error : null });
    try {
      const found = await checkAppUpdate();
      set({ available: found, dismissed: false, message: found || quiet ? null : "You have the latest version." });
      // Remember when we looked, so the automatic check runs at most once a day.
      void useSettingsStore.getState().update({ lastAppUpdateCheck: Math.floor(Date.now() / 1000) });
    } catch (e) {
      if (!quiet) set({ error: toAppError(e) });
    } finally {
      set({ checking: false });
    }
  },
  install: async () => {
    if (get().installing) return;
    const busy = runningTasks();
    if (busy.length > 0) {
      set({ blockedBy: busy, error: null });
      return;
    }
    set({ installing: true, error: null, blockedBy: [] });
    try {
      await runJob("app-update", "Downloading the update", (id) => installAppUpdate(id));
      // Windows closes the app by itself when the installer takes over; on the other systems we restart here.
      await relaunch();
    } catch (e) {
      if (!isCancelled(e)) set({ error: toAppError(e) });
    } finally {
      set({ installing: false });
    }
  },
  cancelBlocking: () => {
    for (const job of runningTasks()) requestCancel(job.id);
    set({ blockedBy: [] });
  },
  dismiss: () => set({ dismissed: true, blockedBy: [] }),
}));
