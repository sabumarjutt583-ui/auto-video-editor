import { create } from "zustand";

import { toAppError } from "../lib/errors";
import { loadSettings, saveSettings } from "../lib/settings";
import type { AppError, AppSettings } from "../types";

/** Edits are saved this long after the last change, so typing does not save on every key press. */
const SAVE_DELAY_MS = 250;

export type SaveState = "idle" | "saving" | "saved" | "error";

interface SettingsState {
  /** null until the settings have been loaded from disk. */
  settings: AppSettings | null;
  loading: boolean;
  loadError: AppError | null;
  saveState: SaveState;
  saveError: AppError | null;
  load: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saveChain: Promise<void> = Promise.resolve();
let revision = 0;

export const useSettingsStore = create<SettingsState>((set, get) => {
  async function persist(): Promise<void> {
    const current = get().settings;
    if (!current) return;
    const savedRevision = revision;
    try {
      await saveSettings(current);
      // If something was edited while saving, another save is already on its way.
      if (savedRevision === revision) set({ saveState: "saved", saveError: null });
    } catch (error) {
      set({
        saveState: "error",
        saveError: toAppError(error, "Your settings could not be saved."),
      });
    }
  }

  function scheduleSave(): void {
    clearTimeout(saveTimer);
    set({ saveState: "saving" });
    saveTimer = setTimeout(() => {
      // Saves run one after another so an older save can never overwrite a newer one.
      saveChain = saveChain.then(persist);
    }, SAVE_DELAY_MS);
  }

  return {
    settings: null,
    loading: false,
    loadError: null,
    saveState: "idle",
    saveError: null,

    load: async () => {
      set({ loading: true, loadError: null });
      try {
        const settings = await loadSettings();
        set({ settings, loading: false });
      } catch (error) {
        set({
          loading: false,
          loadError: toAppError(error, "Your settings could not be loaded."),
        });
      }
    },

    update: (patch) => {
      const current = get().settings;
      if (!current) return;
      revision += 1;
      set({ settings: { ...current, ...patch } });
      scheduleSave();
    },
  };
});
