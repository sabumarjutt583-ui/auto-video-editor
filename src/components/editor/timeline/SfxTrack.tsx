import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import type { SfxCue } from "../../../types";
import { useTimelineScale } from "./scale";

interface SfxTrackProps {
  cues: readonly SfxCue[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, time: number) => void;
  onDelete: (id: string) => void;
}

interface Dragging {
  id: string;
  startX: number;
  origin: number;
  time: number;
  moved: boolean;
}

const MIN_WIDTH = 14;

/** Each sound effect is a small block. Drag to move it, click to select, Delete removes it. */
export function SfxTrack({ cues, selectedId, onSelect, onMove, onDelete }: SfxTrackProps) {
  const { pixelsPerSecond, duration } = useTimelineScale();
  const [drag, setDrag] = useState<Dragging | null>(null);
  const ref = useRef<Dragging | null>(null);

  const begin = (cue: SfxCue, event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    ref.current = { id: cue.id, startX: event.clientX, origin: cue.time, time: cue.time, moved: false };
    setDrag(ref.current);
    onSelect(cue.id);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const d = ref.current;
    if (!d) return;
    const dx = event.clientX - d.startX;
    const time = Math.min(duration, Math.max(0, d.origin + dx / pixelsPerSecond));
    ref.current = { ...d, time, moved: d.moved || Math.abs(dx) > 3 };
    setDrag(ref.current);
  };
  const end = () => {
    const d = ref.current;
    ref.current = null;
    setDrag(null);
    if (d?.moved) onMove(d.id, Math.round(d.time * 10) / 10);
  };
  const keys = (cue: SfxCue, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onDelete(cue.id);
    }
  };

  return (
    <div className="relative h-full" data-testid="sfx-track">
      {cues.map((cue) => {
        const time = drag?.id === cue.id ? drag.time : cue.time;
        const active = cue.id === selectedId;
        return (
          <button
            key={cue.id}
            type="button"
            data-testid="sfx-block"
            title={`${cue.soundId.replace(/_/g, " ")} · ${time.toFixed(1)} s`}
            onPointerDown={(e) => begin(cue, e)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={(e) => keys(cue, e)}
            className={`absolute top-1.5 bottom-1.5 cursor-grab touch-none overflow-hidden rounded border px-1 text-left text-[10px] whitespace-nowrap ${active ? "z-10 border-accent bg-accent text-on-accent" : "border-warning/50 bg-warning/20 text-fg"}`}
            style={{ left: time * pixelsPerSecond, width: Math.max(MIN_WIDTH, 0.5 * pixelsPerSecond) }}
          >
            {cue.reason}
          </button>
        );
      })}
    </div>
  );
}
