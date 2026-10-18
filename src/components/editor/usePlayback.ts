import { convertFileSrc } from "@tauri-apps/api/core";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";

import { projectFilePath } from "../../lib/audio";
import { usePlaybackStore } from "../../store/playbackStore";
import type { Project } from "../../types";

export interface PlaybackControls {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Jumps to a time in seconds (keeps playing if it was playing). */
  seek: (seconds: number) => void;
}

const NOOP: PlaybackControls = { play: () => undefined, pause: () => undefined, toggle: () => undefined, seek: () => undefined };
export const PlaybackContext = createContext<PlaybackControls>(NOOP);
export function usePlaybackControls(): PlaybackControls {
  return useContext(PlaybackContext);
}

/**
 * Plays the processed voice and keeps `usePlaybackStore` up to date with its position.
 * Without a voice file, a plain clock stands in so the preview still moves.
 */
export function usePlayback(project: Project): PlaybackControls {
  const { id, voicePath, voiceDuration } = project;
  const audio = useRef<HTMLAudioElement | null>(null);
  const clock = useRef<{ startedAt: number; from: number } | null>(null);
  const frame = useRef(0);
  // Set when the voice cannot be played (no sound device, say): a plain clock keeps the preview moving.
  const silent = useRef(false);
  const duration = useRef(voiceDuration);
  duration.current = voiceDuration;

  const controls = useMemo<PlaybackControls>(() => {
    const now = () => usePlaybackStore.getState().time;
    const stopLoop = () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
    const finish = () => {
      stopLoop();
      audio.current?.pause();
      clock.current = null;
      usePlaybackStore.setState({ playing: false, time: duration.current });
    };
    const tick = () => {
      const element = audio.current;
      let time: number;
      if (element && !silent.current) time = element.currentTime;
      else if (clock.current) time = clock.current.from + (performance.now() - clock.current.startedAt) / 1000;
      else return;
      if (time >= duration.current - 0.02) {
        finish();
        return;
      }
      usePlaybackStore.setState({ time });
      frame.current = requestAnimationFrame(tick);
    };
    const play = () => {
      if (usePlaybackStore.getState().playing) return;
      let from = now();
      if (from >= duration.current - 0.05) from = 0;
      usePlaybackStore.setState({ playing: true, time: from });
      const element = audio.current;
      silent.current = false;
      if (element) {
        element.currentTime = from;
        void element.play().catch(() => {
          if (!usePlaybackStore.getState().playing) return;
          silent.current = true;
          clock.current = { startedAt: performance.now(), from: usePlaybackStore.getState().time };
        });
      } else {
        clock.current = { startedAt: performance.now(), from };
      }
      stopLoop();
      frame.current = requestAnimationFrame(tick);
    };
    const pause = () => {
      stopLoop();
      audio.current?.pause();
      clock.current = null;
      usePlaybackStore.setState({ playing: false });
    };
    const seek = (seconds: number) => {
      const time = Math.min(Math.max(0, seconds), duration.current);
      if (audio.current) audio.current.currentTime = time;
      if (clock.current) clock.current = { startedAt: performance.now(), from: time };
      usePlaybackStore.setState({ time });
    };
    return { play, pause, seek, toggle: () => (usePlaybackStore.getState().playing ? pause() : play()) };
  }, []);

  // Load the voice. A new file (after the silence cut was redone) gets a new address.
  useEffect(() => {
    let stale = false;
    audio.current = null;
    if (voicePath === null) return undefined;
    void projectFilePath(id, voicePath)
      .then((absolute) => {
        if (stale) return;
        const element = new Audio(`${convertFileSrc(absolute)}?v=${voiceDuration}`);
        element.preload = "auto";
        audio.current = element;
      })
      .catch(() => undefined);
    return () => {
      stale = true;
      audio.current?.pause();
      audio.current = null;
    };
  }, [id, voicePath, voiceDuration]);

  // Start from the beginning for a new project, and stop when leaving.
  useEffect(() => {
    usePlaybackStore.setState({ time: 0, playing: false });
    return () => {
      controls.pause();
      usePlaybackStore.setState({ time: 0, playing: false });
    };
  }, [id, controls]);

  return controls;
}
