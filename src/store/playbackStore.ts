import { create } from "zustand";

interface PlaybackState {
  /** Seconds into the video. */
  time: number;
  playing: boolean;
}

export const usePlaybackStore = create<PlaybackState>(() => ({ time: 0, playing: false }));
