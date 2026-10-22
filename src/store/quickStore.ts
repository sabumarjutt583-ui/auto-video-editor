import { create } from "zustand";

/** What the Prompt Generator remembers about quick mode between page visits (not saved to disk). */
interface QuickState {
  /** The project that was open before the person switched to quick mode, so the switch can go back. */
  lastProject: { id: string; name: string } | null;
  /** "Last quick session restored" is shown until the person closes it. */
  restoredNote: boolean;
  setLastProject: (project: { id: string; name: string } | null) => void;
  setRestoredNote: (on: boolean) => void;
}

export const useQuickStore = create<QuickState>((set) => ({
  lastProject: null,
  restoredNote: false,
  setLastProject: (lastProject) => set({ lastProject }),
  setRestoredNote: (restoredNote) => set({ restoredNote }),
}));
