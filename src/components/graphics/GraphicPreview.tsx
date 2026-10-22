import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { loadGraphicFonts, previewContext, previewSize } from "../../lib/graphics/render/browser";
import { FPS, frameCount, renderFrame, type RenderNote } from "../../lib/graphics/render";
import type { GraphicSpec } from "../../lib/graphics/spec";
import { Button } from "../ui";

interface GraphicPreviewProps {
  spec: GraphicSpec;
  aspect: "16:9" | "9:16" | "1:1";
  /** A picture of the scene to show behind the graphic (optional). */
  backgroundUrl?: string | null;
}

/** Plays a graphic in real time over the scene picture, with play/pause and a scrub bar. Uses the same renderer as the export. */
export function GraphicPreview({ spec, aspect, backgroundUrl }: GraphicPreviewProps) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const total = frameCount(spec.duration);
  const size = useMemo(() => previewSize(aspect), [aspect]);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [fontsReady, setFontsReady] = useState(false);
  const [notes, setNotes] = useState<RenderNote[]>([]);
  const images = useMemo(() => new Map<string, CanvasImageSource>(), []);

  useEffect(() => {
    let alive = true;
    void loadGraphicFonts().then(() => alive && setFontsReady(true));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    setFrame(0);
  }, [spec]);

  // The clock: the frame follows real time (30 fps) while playing; a late browser skips frames instead of slowing down.
  useEffect(() => {
    if (!playing) return;
    const startedAt = performance.now() - (frame / FPS) * 1000;
    let handle = 0;
    const tick = (now: number) => {
      setFrame(Math.floor(((now - startedAt) / 1000) * FPS) % total);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
    // `frame` is read once at the start of playing on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, total, spec]);

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx || !fontsReady) return;
    const report = renderFrame(spec, frame, ctx, previewContext(size.width, size.height, images));
    setNotes((old) => (old.length === report.notes.length && old.every((n, i) => n.message === report.notes[i]?.message) ? old : report.notes));
  }, [spec, frame, size, images, fontsReady]);

  const seconds = (frame / FPS).toFixed(2);
  return (
    <div className="flex flex-col gap-2">
      <div
        className="w-full overflow-hidden rounded-lg border border-line bg-[conic-gradient(#2a2a35_25%,#1c1c25_0_50%,#2a2a35_0_75%,#1c1c25_0)] [background-size:16px_16px]"
        style={{ aspectRatio: `${size.width} / ${size.height}`, ...(backgroundUrl ? { backgroundImage: `url("${backgroundUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : {}) }}
      >
        <canvas ref={canvas} width={size.width} height={size.height} className="h-full w-full" aria-label="Graphic preview" />
      </div>
      <div className="flex items-center gap-2">
        <Button icon={playing ? Pause : Play} onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>{playing ? "Pause" : "Play"}</Button>
        <input
          type="range"
          min={0}
          max={total - 1}
          step={1}
          value={frame}
          aria-label="Scrub the graphic"
          onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }}
          className="min-w-0 flex-1 accent-[var(--accent)]"
        />
        <span className="w-24 text-right text-xs tabular-nums text-muted">{seconds} s · {frame + 1}/{total}</span>
      </div>
      {notes.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-muted" role="status">
          {notes.map((n) => <li key={`${n.layerId}-${n.kind}`}>{n.layerId}: {n.message}</li>)}
        </ul>
      )}
    </div>
  );
}
