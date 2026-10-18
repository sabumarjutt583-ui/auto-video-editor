import { create } from "zustand";

import { toAppError } from "../lib/errors";
import { deleteCustomStyle, listStyles, saveCustomStyle } from "../lib/styles";
import type { AppError, StyleProfile } from "../types";

interface StyleState {
  styles: StyleProfile[];
  warnings: string[];
  loaded: boolean;
  error: AppError | null;
  load: () => Promise<void>;
  save: (style: StyleProfile) => Promise<StyleProfile>;
  remove: (id: string) => Promise<void>;
}

export const useStyleStore = create<StyleState>((set, get) => ({
  styles: [],
  warnings: [],
  loaded: false,
  error: null,
  load: async () => {
    try {
      const library = await listStyles();
      set({ styles: library.styles, warnings: library.warnings, loaded: true, error: null });
    } catch (caught) {
      set({ error: toAppError(caught, "The styles could not be loaded."), loaded: true });
    }
  },
  save: async (style) => {
    const saved = await saveCustomStyle(style);
    await get().load();
    return saved;
  },
  remove: async (id) => {
    await deleteCustomStyle(id);
    await get().load();
  },
}));
