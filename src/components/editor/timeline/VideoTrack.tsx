import { cn } from "../../../lib/cn";
import type { Scene, MediaFile } from "../../../types";
import { useThumbStore } from "../../../store/thumbStore";

interface VideoTrackProps {
  scenes: Scene[];
  /** The file chosen for each scene, by scene id. */
  files: Record<string, MediaFile | undefined>;
  pixelsPerSecond: number;
  selectedId: string | null;
  /** The scene being dragged and the scene it is over (for swapping). */
  dragging: number | null;
  over: number;
  onBoundary: (index: number, event: React.PointerEvent) => void;
  onClip: (index: number, event: React.PointerEvent) => void;
  onMove: (event: React.PointerEvent) => void;
  onEnd: (event: React.PointerEvent) => void;
  onCancel: () => void;
}

function Clip({ scene, file, index, ...rest }: { scene: Scene; file: MediaFile | undefined; index: number } & Pick<VideoTrackProps, "pixelsPerSecond" | "selectedId" | "dragging" | "over" | "onClip" | "onMove" | "onEnd" | "onCancel">) {
  const url = useThumbStore((state) => (file ? state.urls[file.path]?.[0] : undefined));
  const width = scene.duration * rest.pixelsPerSecond;
  const selected = rest.selectedId === scene.id;
  const target = rest.dragging !== null && rest.dragging !== index && rest.over === index;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${scene.id}${file ? "" : " (no media)"}`}
      data-testid="timeline-clip"
      data-scene={scene.id}
      onPointerDown={(event) => rest.onClip(index, event)}
      onPointerMove={rest.onMove}
      onPointerUp={rest.onEnd}
      onPointerCancel={rest.onCancel}
      className={cn(
        "absolute top-1 bottom-1 cursor-grab touch-none overflow-hidden rounded-md border text-[10px] text-white select-none",
        file ? "border-line bg-surface-2" : "border-danger/60 bg-[repeating-linear-gradient(45deg,rgba(239,68,68,0.25),rgba(239,68,68,0.25)_6px,transparent_6px,transparent_12px)]",
        selected && "ring-2 ring-accent",
        target && "ring-2 ring-warning",
        rest.dragging === index && "opacity-60",
      )}
      style={{ left: scene.start * rest.pixelsPerSecond, width: Math.max(2, width - 1), backgroundImage: url ? `url("${url}")` : undefined, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x" }}
    >
      <span className="absolute top-0.5 left-1 rounded bg-black/60 px-1">{scene.id}</span>
    </div>
  );
}

/** The picture and clip blocks. Their widths are their durations; the edges between them can be dragged. */
export function VideoTrack({ scenes, files, pixelsPerSecond, onBoundary, ...rest }: VideoTrackProps) {
  return (
    <div className="relative h-16" data-testid="video-track">
      {scenes.map((scene, index) => (
        <Clip key={scene.id} scene={scene} file={files[scene.id]} index={index} pixelsPerSecond={pixelsPerSecond} {...rest} />
      ))}
      {scenes.slice(0, -1).map((scene, index) => (
        <div
          key={`edge-${scene.id}`}
          role="separator"
          aria-label={`Move the edge between ${scene.id} and ${scenes[index + 1]?.id ?? ""}`}
          data-testid="timeline-edge"
          data-index={index}
          onPointerDown={(event) => onBoundary(index, event)}
          onPointerMove={rest.onMove}
          onPointerUp={rest.onEnd}
          onPointerCancel={rest.onCancel}
          className="absolute top-0 bottom-0 z-10 w-3 -translate-x-1.5 cursor-col-resize touch-none"
          style={{ left: scene.end * pixelsPerSecond }}
        >
          <span className="absolute inset-y-1 left-1/2 w-0.5 -translate-x-1/2 rounded bg-accent/70" />
        </div>
      ))}
    </div>
  );
}
