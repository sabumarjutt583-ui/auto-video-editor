import { useMemo } from "react";

import { musicSegments } from "../../../lib/audio/segments";
import type { AudioData } from "../../../types";
import { useTimelineScale } from "./scale";

/** The music as blocks: tracks in order, repeated until the end of the video (loop) or played once. */
export function MusicTrack({ audio }: { audio: AudioData }) {
  const { pixelsPerSecond, duration } = useTimelineScale();
  const segments = useMemo(() => musicSegments(audio.tracks, duration, audio.mode), [audio.tracks, audio.mode, duration]);
  return (
    <div className="relative h-full" data-testid="music-track">
      {segments.length === 0 && <span className="absolute inset-y-0 left-2 flex items-center text-[10px] text-muted">No music. Add some in the Audio tab.</span>}
      {segments.map((s, i) => (
        <div
          key={`${s.trackId}-${i}`}
          title={s.name}
          data-testid="music-block"
          className="absolute top-1 bottom-1 overflow-hidden rounded border border-success/40 bg-success/15 px-1 text-[10px] whitespace-nowrap text-fg"
          style={{ left: s.start * pixelsPerSecond, width: Math.max(2, (s.end - s.start) * pixelsPerSecond - 1) }}
        >
          {s.name}
        </div>
      ))}
    </div>
  );
}
