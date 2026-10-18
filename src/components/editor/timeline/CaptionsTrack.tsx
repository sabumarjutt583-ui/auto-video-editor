import type { CaptionLine } from "../../../types";
import { useTimelineScale } from "./scale";

/** The captions as small blocks. Clicking one jumps there. */
export function CaptionsTrack({ lines, onSeek }: { lines: readonly CaptionLine[]; onSeek: (time: number) => void }) {
  const { pixelsPerSecond } = useTimelineScale();
  return (
    <div className="relative h-full" data-testid="captions-track">
      {lines.map((line) => (
        <button
          key={line.id}
          type="button"
          title={line.text.replace("\n", " ")}
          data-testid="caption-block"
          onClick={() => onSeek(line.start)}
          className="absolute top-1 bottom-1 cursor-pointer overflow-hidden rounded border border-accent/40 bg-accent-soft px-1 text-left text-[10px] whitespace-nowrap text-accent-fg"
          style={{ left: line.start * pixelsPerSecond, width: Math.max(2, (line.end - line.start) * pixelsPerSecond - 1) }}
        >
          {line.text.replace("\n", " ")}
        </button>
      ))}
    </div>
  );
}
