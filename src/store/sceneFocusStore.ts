import { create } from "zustand";

/** The scene that is selected in the Auto Editor, so other pages (the SFX Library) can act on it. */
interface SceneFocusState {
  projectId: string | null;
  sceneId: string | null;
  set: (projectId: string | null, sceneId: string | null) => void;
}

export const useSceneFocusStore = create<SceneFocusState>((set) => ({
  projectId: null,
  sceneId: null,
  set: (projectId, sceneId) => set({ projectId, sceneId }),
}));
