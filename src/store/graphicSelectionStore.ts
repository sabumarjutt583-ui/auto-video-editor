import { create } from "zustand";

interface GraphicSelection {
  /** The graphic chosen on the timeline or in the list, or null. */
  selectedId: string | null;
  select: (id: string | null) => void;
}

export const useGraphicSelection = create<GraphicSelection>((set) => ({ selectedId: null, select: (selectedId) => set({ selectedId }) }));
