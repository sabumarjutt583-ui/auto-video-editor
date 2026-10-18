import { create } from "zustand";

import { checkFfmpeg } from "../lib/engine";
import { toAppError } from "../lib/errors";
import type { AppError } from "../types";

export type EngineStatus = "checking" | "ready" | "missing";

interface EngineState {
  status: EngineStatus;
  version: string | null;
  error: AppError | null;
  check: () => Promise<void>;
}

export const useEngineStore = create<EngineState>((set) => ({
  status: "checking",
  version: null,
  error: null,
  check: async () => {
    set({ status: "checking", error: null });
    try {
      const version = await checkFfmpeg();
      set({ status: "ready", version, error: null });
    } catch (error) {
      set({
        status: "missing",
        version: null,
        error: toAppError(error, "The video engine (FFmpeg) could not be checked."),
      });
    }
  },
}));
