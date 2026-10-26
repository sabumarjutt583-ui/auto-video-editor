import { useCallback, useRef, useState } from "react";

import { dragMoved } from "../../../lib/editor/timeline";

/** A drag that started on the timeline: which kind, and how far it went. */
export interface DragState {
  kind: "boundary" | "clip";
  /** For "boundary": index of the scene on its left. For "clip": index of the scene being dragged. */
  index: number;
  /** Time (seconds) under the pointer. */
  time: number;
  /** For "clip": the scene index under the pointer, or -1. */
  over: number;
  /** True once the pointer moved far enough to count as a drag (not a click). */
  moved: boolean;
}

interface Handlers {
  /** Converts a pointer's horizontal position to seconds. */
  timeAt: (clientX: number) => number;
  sceneAt: (time: number) => number;
  onDrop: (drag: DragState) => void;
  onClick: (drag: DragState) => void;
}

const MOVE_THRESHOLD = 4;

/** Pointer handling for dragging clip edges and clips on the timeline. */
export function useTimelineDrag({ timeAt, sceneAt, onDrop, onClick }: Handlers) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const current = useRef<DragState | null>(null);
  const origin = useRef(0);

  const begin = useCallback(
    (kind: DragState["kind"], index: number, event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      origin.current = event.clientX;
      const time = timeAt(event.clientX);
      const state: DragState = { kind, index, time, over: sceneAt(time), moved: false };
      current.current = state;
      setDrag(state);
    },
    [timeAt, sceneAt],
  );

  const move = useCallback(
    (event: React.PointerEvent) => {
      const state = current.current;
      if (!state) return;
      const time = timeAt(event.clientX);
      const next: DragState = { ...state, time, over: sceneAt(time), moved: state.moved || dragMoved(origin.current, event.clientX, MOVE_THRESHOLD) };
      current.current = next;
      setDrag(next);
    },
    [timeAt, sceneAt],
  );

  const end = useCallback(
    (event: React.PointerEvent) => {
      const state = current.current;
      if (!state) return;
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
      current.current = null;
      setDrag(null);
      if (state.moved) onDrop(state);
      else onClick(state);
    },
    [onDrop, onClick],
  );

  const cancel = useCallback(() => {
    current.current = null;
    setDrag(null);
  }, []);

  return { drag, begin, move, end, cancel };
}
