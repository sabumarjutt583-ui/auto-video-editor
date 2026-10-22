import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { moveBoundaryToTime } from "../../../lib/editor/boundaries";
import { clampZoom, fitZoom, MAX_PIXELS_PER_SECOND, MIN_PIXELS_PER_SECOND, sceneIndexAt } from "../../../lib/editor/timeline";
import type { Context } from "../../../lib/scenes/edit";
import { usePlaybackStore } from "../../../store/playbackStore";
import type { TimeLimits } from "../../../lib/graphics/editing";
import type { AudioData, CaptionLine, MediaFile, MotionGraphic, Scene, SfxCue } from "../../../types";
import { IconButton } from "../../ui";
import { usePlaybackControls } from "../usePlayback";
import { CaptionsTrack } from "./CaptionsTrack";
import { GraphicsTrack } from "./GraphicsTrack";
import { MusicTrack } from "./MusicTrack";
import { Playhead } from "./Playhead";
import { Ruler } from "./Ruler";
import { SfxTrack } from "./SfxTrack";
import { TimelineScaleContext } from "./scale";
import { TrackRow } from "./TrackRow";
import { useTimelineDrag, type DragState } from "./useTimelineDrag";
import { VideoTrack } from "./VideoTrack";

const LABELS = ["Video", "Graphics", "Captions", "Music", "SFX"] as const;

interface TimelineProps {
  scenes: Scene[];
  context: Context;
  files: Record<string, MediaFile | undefined>;
  captionLines: readonly CaptionLine[];
  audio: AudioData;
  cues: readonly SfxCue[];
  selectedCue: string | null;
  onSelectCue: (id: string) => void;
  onMoveCue: (id: string, time: number) => void;
  onDeleteCue: (id: string) => void;
  selectedId: string | null;
  onSelect: (sceneId: string) => void;
  onBoundary: (scenes: Scene[]) => void;
  onSwap: (fromIndex: number, toIndex: number) => void;
  graphics: readonly MotionGraphic[];
  selectedGraphic: string | null;
  limitsFor: (g: MotionGraphic) => TimeLimits | null;
  onSelectGraphic: (g: MotionGraphic) => void;
  onRetimeGraphic: (id: string, to: { start: number; duration: number }) => void;
}

/** Zoomable tracks: Video, Graphics, Captions, Music and SFX, with the playhead and draggable clip edges. */
export function Timeline({ scenes, context, files, captionLines, audio, cues, selectedCue, onSelectCue, onMoveCue, onDeleteCue, selectedId, onSelect, onBoundary, onSwap, graphics, selectedGraphic, limitsFor, onSelectGraphic, onRetimeGraphic }: TimelineProps) {
  const controls = usePlaybackControls();
  const scroller = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const duration = context.voiceDuration;
  const [pixelsPerSecond, setPixelsPerSecond] = useState(40);
  // Until the user zooms, the whole video stays fitted to the width.
  const touched = useRef(false);

  // Start zoomed out so the whole video fits (once the width is known).
  useEffect(() => {
    const element = scroller.current;
    if (!element || duration <= 0) return undefined;
    const fit = () => {
      if (touched.current || element.clientWidth < 100) return;
      setPixelsPerSecond(fitZoom(duration, element.clientWidth - 24));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [duration]);

  const timeAt = useCallback(
    (clientX: number) => {
      const rect = surface.current?.getBoundingClientRect();
      return rect ? Math.min(duration, Math.max(0, (clientX - rect.left) / pixelsPerSecond)) : 0;
    },
    [pixelsPerSecond, duration],
  );
  const sceneAt = useCallback((time: number) => sceneIndexAt(scenes, time), [scenes]);

  const handleDrop = useCallback(
    (drag: DragState) => {
      if (drag.kind === "boundary") onBoundary(moveBoundaryToTime(scenes, drag.index, drag.time, context));
      else if (drag.over >= 0 && drag.over !== drag.index) onSwap(drag.index, drag.over);
    },
    [scenes, context, onBoundary, onSwap],
  );
  const handleClick = useCallback(
    (drag: DragState) => {
      const scene = scenes[drag.index];
      if (!scene) return;
      onSelect(scene.id);
      controls.seek(scene.start);
    },
    [scenes, onSelect, controls],
  );
  const { drag, begin, move, end, cancel } = useTimelineDrag({ timeAt, sceneAt, onDrop: handleDrop, onClick: handleClick });

  // While an edge is dragged, show the scenes as they would be.
  const shown = useMemo(() => (drag?.kind === "boundary" ? moveBoundaryToTime(scenes, drag.index, drag.time, context) : scenes), [drag, scenes, context]);

  // Keep the playhead in view while playing.
  useEffect(() => {
    return usePlaybackStore.subscribe((state) => {
      const element = scroller.current;
      if (!element || !state.playing) return;
      const x = state.time * pixelsPerSecond;
      if (x < element.scrollLeft || x > element.scrollLeft + element.clientWidth - 40) element.scrollLeft = Math.max(0, x - 80);
    });
  }, [pixelsPerSecond]);

  const zoomBy = (factor: number) => {
    touched.current = true;
    setPixelsPerSecond((value) => clampZoom(value * factor));
  };

  const seekFromPointer = (event: React.PointerEvent) => {
    if (event.target === event.currentTarget || (event.target as HTMLElement).closest("[data-seek]")) controls.seek(timeAt(event.clientX));
  };

  return (
    <section className="flex min-h-0 flex-col gap-2 rounded-2xl border border-line bg-surface p-3" aria-label="Timeline">
      <div className="flex items-center gap-1">
        <h2 className="mr-2 text-sm font-semibold">Timeline</h2>
        <IconButton icon={ZoomOut} label="Zoom out" onClick={() => zoomBy(0.8)} />
        <input
          type="range"
          aria-label="Zoom"
          min={Math.log2(MIN_PIXELS_PER_SECOND)}
          max={Math.log2(MAX_PIXELS_PER_SECOND)}
          step={0.02}
          value={Math.log2(pixelsPerSecond)}
          onChange={(event) => {
            touched.current = true;
            setPixelsPerSecond(clampZoom(2 ** Number(event.target.value)));
          }}
          className="w-32 accent-[var(--accent)]"
        />
        <IconButton icon={ZoomIn} label="Zoom in" onClick={() => zoomBy(1.25)} />
        <IconButton icon={Maximize2} label="Fit the whole video" onClick={() => {
            touched.current = false;
            setPixelsPerSecond(fitZoom(duration, Math.max(300, (scroller.current?.clientWidth ?? 800) - 24)));
          }} />
        <span className="ml-2 text-xs text-muted">Drag the edge between two clips to change the scene times. Drag a clip onto another to swap them.</span>
      </div>
      <div className="flex min-h-0">
        <div className="w-16 shrink-0 pt-6 text-[11px] text-muted" aria-hidden>
          {[["Video", "4.5rem"], ["Graphics", "2.75rem"], ["Captions", "2rem"], ["Music", "2.25rem"], ["SFX", "2.25rem"]].map(([label, height]) => (
            <div key={label} className="flex items-center border-b border-transparent" style={{ height }}>
              {label}
            </div>
          ))}
        </div>
        <div
          ref={scroller}
          className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
          onWheel={(event) => {
            if (event.ctrlKey) {
              event.preventDefault();
              zoomBy(event.deltaY < 0 ? 1.15 : 0.87);
            }
          }}
        >
          <TimelineScaleContext.Provider value={{ pixelsPerSecond, duration }}>
            <div ref={surface} className="relative" style={{ width: Math.max(1, duration * pixelsPerSecond) }} data-testid="timeline-surface" onPointerDown={seekFromPointer} data-seek>
              <div data-seek className="cursor-pointer">
                <Ruler duration={duration} pixelsPerSecond={pixelsPerSecond} />
              </div>
              <TrackRow label={LABELS[0]} height="4.5rem">
                <VideoTrack
                  scenes={shown}
                  files={files}
                  pixelsPerSecond={pixelsPerSecond}
                  selectedId={selectedId}
                  dragging={drag?.kind === "clip" && drag.moved ? drag.index : null}
                  over={drag?.over ?? -1}
                  onBoundary={(index, event) => begin("boundary", index, event)}
                  onClip={(index, event) => begin("clip", index, event)}
                  onMove={move}
                  onEnd={end}
                  onCancel={cancel}
                />
              </TrackRow>
              <TrackRow label={LABELS[1]} height="2.75rem">
                <GraphicsTrack graphics={graphics} selectedId={selectedGraphic} limitsFor={limitsFor} onSelect={(g) => { onSelectGraphic(g); controls.seek(g.start); }} onRetime={onRetimeGraphic} />
              </TrackRow>
              <TrackRow label={LABELS[2]} height="2rem">
                <CaptionsTrack lines={captionLines} onSeek={controls.seek} />
              </TrackRow>
              <TrackRow label={LABELS[3]} height="2.25rem">
                <MusicTrack audio={audio} />
              </TrackRow>
              <TrackRow label={LABELS[4]} height="2.25rem">
                <SfxTrack cues={cues} selectedId={selectedCue} onSelect={onSelectCue} onMove={onMoveCue} onDelete={onDeleteCue} />
              </TrackRow>
              <Playhead pixelsPerSecond={pixelsPerSecond} />
              {drag?.kind === "boundary" && (
                <div className="pointer-events-none absolute top-6 z-30 rounded bg-black/80 px-1.5 py-0.5 text-[11px] text-white" style={{ left: (shown[drag.index]?.end ?? 0) * pixelsPerSecond + 6 }}>
                  {(shown[drag.index]?.end ?? 0).toFixed(1)} s
                </div>
              )}
            </div>
          </TimelineScaleContext.Provider>
        </div>
      </div>
    </section>
  );
}
