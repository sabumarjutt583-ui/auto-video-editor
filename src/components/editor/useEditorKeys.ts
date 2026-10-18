import { useEffect } from "react";

import { sceneIndexAt } from "../../lib/editor/timeline";
import { redo, undo } from "../../store/historyStore";
import { usePlaybackStore } from "../../store/playbackStore";
import type { Scene } from "../../types";
import type { PlaybackControls } from "./usePlayback";

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) && !(target instanceof HTMLInputElement && ["range", "checkbox", "radio"].includes(target.type));
}

/** Space = play/pause, arrows = previous/next scene, Ctrl+Z / Ctrl+Y = undo / redo. */
export function useEditorKeys(scenes: readonly Scene[], controls: PlaybackControls, voiceDuration: number, onScene: (index: number) => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (mod && key === "y") {
        event.preventDefault();
        redo();
      } else if (!mod && event.key === " ") {
        event.preventDefault();
        controls.toggle();
      } else if (!mod && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
        event.preventDefault();
        const time = usePlaybackStore.getState().time;
        const index = sceneIndexAt(scenes, time);
        const next = event.key === "ArrowRight" ? index + 1 : time - (scenes[index]?.start ?? 0) > 0.5 ? index : index - 1;
        const target = scenes[next];
        if (target) {
          controls.seek(target.start);
          onScene(next);
        } else if (event.key === "ArrowRight") controls.seek(voiceDuration);
        else controls.seek(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scenes, controls, voiceDuration, onScene]);
}
