import { usePlaybackStore } from "../../../store/playbackStore";

/** The vertical line that follows the voice. It ignores the pointer so clicks reach the tracks below. */
export function Playhead({ pixelsPerSecond }: { pixelsPerSecond: number }) {
  const time = usePlaybackStore((state) => state.time);
  return (
    <div className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-accent" style={{ left: time * pixelsPerSecond }} data-testid="playhead">
      <span className="absolute -top-0.5 -left-1 h-2 w-2 rotate-45 bg-accent" />
    </div>
  );
}
