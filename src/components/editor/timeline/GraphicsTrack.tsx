import { useRef, useState, type PointerEvent } from "react";

import { retime, shift, type TimeLimits } from "../../../lib/graphics/editing";
import type { MotionGraphic } from "../../../types";
import { useTimelineScale } from "./scale";

interface GraphicsTrackProps {
  graphics: readonly MotionGraphic[];
  selectedId: string | null;
  /** Scene and word times for snapping; null when the scene is gone. */
  limitsFor: (g: MotionGraphic) => TimeLimits | null;
  onSelect: (g: MotionGraphic) => void;
  onRetime: (id: string, to: { start: number; duration: number }) => void;
}

type Mode = "move" | "start" | "end";
interface Dragging { id: string; mode: Mode; startX: number; from: { start: number; duration: number }; now: { start: number; duration: number }; moved: boolean }

const EDGE = 6;

/** Lane (0 or 1) for each graphic: one that overlaps an earlier one goes to the second lane. */
export function lanesOf(list: ReadonlyArray<{ id: string; start: number; duration: number }>): Map<string, number> {
  const out = new Map<string, number>();
  const ends: number[] = [-Infinity, -Infinity];
  for (const g of [...list].sort((a, b) => a.start - b.start)) {
    const lane = ends[0] !== undefined && ends[0] <= g.start + 1e-9 ? 0 : 1;
    out.set(g.id, lane);
    ends[lane] = g.start + g.duration;
  }
  return out;
}

/** The "Graphics" track: one block per graphic. Click selects, drag moves, drag an edge to change the time (it snaps to word times). */
export function GraphicsTrack({ graphics, selectedId, limitsFor, onSelect, onRetime }: GraphicsTrackProps) {
  const { pixelsPerSecond } = useTimelineScale();
  const [drag, setDrag] = useState<Dragging | null>(null);
  const ref = useRef<Dragging | null>(null);
  const lanes = lanesOf(graphics);

  const begin = (g: MotionGraphic, event: PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    const mode: Mode = x <= EDGE ? "start" : x >= box.width - EDGE ? "end" : "move";
    event.currentTarget.setPointerCapture(event.pointerId);
    const from = { start: g.start, duration: g.duration };
    ref.current = { id: g.id, mode, startX: event.clientX, from, now: from, moved: false };
    setDrag(ref.current);
    onSelect(g);
  };
  const move = (g: MotionGraphic, event: PointerEvent<HTMLElement>) => {
    const d = ref.current;
    const limits = limitsFor(g);
    if (!d || d.id !== g.id || !limits) return;
    const dx = event.clientX - d.startX;
    const delta = dx / pixelsPerSecond;
    const now = d.mode === "move" ? shift(d.from, delta, limits)
      : d.mode === "start" ? retime(d.from, "start", d.from.start + delta, limits)
      : retime(d.from, "end", d.from.start + d.from.duration + delta, limits);
    ref.current = { ...d, now, moved: d.moved || Math.abs(dx) > 3 };
    setDrag(ref.current);
  };
  const end = () => {
    const d = ref.current;
    ref.current = null;
    setDrag(null);
    if (d?.moved && (Math.abs(d.now.start - d.from.start) > 0.004 || Math.abs(d.now.duration - d.from.duration) > 0.004)) onRetime(d.id, d.now);
  };

  return (
    <div className="relative h-full" data-testid="graphics-track">
      {graphics.map((g) => {
        const shown = drag?.id === g.id ? drag.now : g;
        const active = g.id === selectedId;
        const lane = lanes.get(g.id) ?? 0;
        return (
          <div
            key={g.id}
            role="button"
            tabIndex={0}
            data-testid="graphic-block"
            title={`${g.spec?.layers[0]?.type ?? "graphic"} · ${shown.start.toFixed(1)} s, ${shown.duration.toFixed(1)} s long`}
            onPointerDown={(e) => begin(g, e)}
            onPointerMove={(e) => move(g, e)}
            onPointerUp={end}
            onPointerCancel={end}
            className={`absolute h-[1.1rem] cursor-grab touch-none overflow-hidden rounded border px-1.5 text-[10px] leading-4 whitespace-nowrap ${g.enabled ? "" : "opacity-50"} ${active ? "z-10 border-accent bg-accent text-on-accent" : "border-accent/50 bg-accent/20 text-fg"}`}
            style={{ left: shown.start * pixelsPerSecond, width: Math.max(16, shown.duration * pixelsPerSecond), top: 3 + lane * 20 }}
          >
            <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/30" />
            <span aria-hidden className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/30" />
            {g.spec?.layers[0]?.type ?? "graphic"}
          </div>
        );
      })}
    </div>
  );
}
