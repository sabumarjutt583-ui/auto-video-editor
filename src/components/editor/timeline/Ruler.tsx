import { rulerStep } from "../../../lib/editor/timeline";
import { formatClock } from "../../../lib/time";

interface RulerProps {
  duration: number;
  pixelsPerSecond: number;
}

/** Time marks above the tracks. */
export function Ruler({ duration, pixelsPerSecond }: RulerProps) {
  const step = rulerStep(pixelsPerSecond);
  const marks: number[] = [];
  for (let t = 0; t <= duration + 1e-6; t += step) marks.push(t);
  return (
    <div className="relative h-6 border-b border-line text-[10px] text-muted" aria-hidden>
      {marks.map((t) => (
        <span key={t} className="absolute top-0 h-full border-l border-line pl-1 leading-6" style={{ left: t * pixelsPerSecond }}>
          {formatClock(t, step < 1 ? 1 : 0)}
        </span>
      ))}
    </div>
  );
}
