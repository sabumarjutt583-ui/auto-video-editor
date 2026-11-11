import { create } from "zustand";
import { persist } from "zustand/middleware";

type Provider = "edge" | "gemini";
interface VoiceFavorites {
  edge: string[];
  gemini: string[];
  toggle: (provider: Provider, voice: string) => void;
}
export const useVoiceFavoritesStore = create<VoiceFavorites>()(persist((set) => ({
  edge: [], gemini: [],
  toggle: (provider, voice) => {
    if (!voice.trim()) return;
    set((s) => ({ [provider]: s[provider].includes(voice) ? s[provider].filter((v) => v !== voice) : [...s[provider], voice] }));
  },
}), { name: "auto-video-editor-voice-favorites", version: 1 }));
