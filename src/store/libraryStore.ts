import { create } from "zustand";

import { resetSfxCache } from "../components/audio/useSfxLibrary";
import { toAppError, isCancelled } from "../lib/errors";
import { libraryStatus, rollbackLibrary, updateLibraries, type LibraryKind, type LibraryStatus } from "../lib/library/api";
import { describeReport } from "../lib/library/text";
import { runJob } from "./jobStore";
import type { AppError } from "../types";

interface LibraryState {
  status: LibraryStatus[];
  checking: boolean;
  message: string | null;
  error: AppError | null;
  refresh: () => Promise<void>;
  /** `quiet` is for the check at startup: no error is shown when the internet is down. */
  check: (quiet: boolean) => Promise<void>;
  rollback: (kind: LibraryKind) => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  status: [],
  checking: false,
  message: null,
  error: null,
  refresh: async () => {
    try {
      set({ status: await libraryStatus() });
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },
  check: async (quiet) => {
    if (get().checking) return;
    set({ checking: true, error: quiet ? get().error : null, message: quiet ? get().message : null });
    try {
      const report = await runJob("library", "Checking for updates", (id) => updateLibraries(id));
      resetSfxCache();
      set({ status: report.status, message: quiet && report.outcomes.every((o) => o.result !== "updated") ? null : describeReport(report) });
    } catch (e) {
      if (!quiet && !isCancelled(e)) set({ error: toAppError(e) });
    } finally {
      set({ checking: false });
    }
  },
  rollback: async (kind) => {
    set({ error: null, message: null });
    try {
      const status = await rollbackLibrary(kind);
      resetSfxCache();
      set({ status, message: "Went back to the version before." });
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },
}));
