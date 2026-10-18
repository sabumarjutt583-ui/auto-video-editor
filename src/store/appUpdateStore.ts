import { create } from "zustand";

import { checkAppUpdate, installAppUpdate, type AppUpdateInfo } from "../lib/appUpdate/api";
import { isCancelled, toAppError } from "../lib/errors";
import type { AppError } from "../types";
import { runJob } from "./jobStore";

interface AppUpdateState {
  available: AppUpdateInfo | null;
  checking: boolean;
  installing: boolean;
  /** Said after a manual check that found nothing. */
  message: string | null;
  error: AppError | null;
  dismissed: boolean;
  /** `quiet` is for the check at startup: no message when nothing is found or the internet is down. */
  check: (quiet: boolean) => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  available: null,
  checking: false,
  installing: false,
  message: null,
  error: null,
  dismissed: false,
  check: async (quiet) => {
    if (get().checking || get().installing) return;
    set({ checking: true, message: null, error: quiet ? get().error : null });
    try {
      const found = await checkAppUpdate();
      set({ available: found, dismissed: false, message: found || quiet ? null : "You have the newest version." });
    } catch (e) {
      if (!quiet) set({ error: toAppError(e) });
    } finally {
      set({ checking: false });
    }
  },
  install: async () => {
    if (get().installing) return;
    set({ installing: true, error: null });
    try {
      await runJob("app-update", "Downloading the update", (id) => installAppUpdate(id));
    } catch (e) {
      if (!isCancelled(e)) set({ error: toAppError(e) });
    } finally {
      set({ installing: false });
    }
  },
  dismiss: () => set({ dismissed: true }),
}));
