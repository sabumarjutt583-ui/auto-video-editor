import { AlertTriangle } from "lucide-react";

import { LONG_IMAGE_SECONDS, type SceneTotals } from "../../lib/scenes/edit";

/** Number of scenes, average and longest length, and a warning for very long image scenes. */
export function TotalsBar({ totals }: { totals: SceneTotals }) {
  return (
    <div className="flex flex-col gap-2">
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted">Scenes</dt>
          <dd className="font-semibold tabular-nums">{totals.count}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Average length</dt>
          <dd className="font-semibold tabular-nums">{totals.averageSeconds.toFixed(1)} s</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Longest scene</dt>
          <dd className="font-semibold tabular-nums">
            {totals.longestSeconds.toFixed(1)} s <span className="font-normal text-muted">({totals.longestId})</span>
          </dd>
        </div>
      </dl>
      {totals.longImages.length > 0 && (
        <p className="flex items-start gap-2 text-sm text-warning" role="alert">
          <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0" />
          {totals.longImages.length === 1 ? "1 image scene is" : `${totals.longImages.length} image scenes are`} longer than {LONG_IMAGE_SECONDS} seconds ({totals.longImages.slice(0, 6).join(", ")}
          {totals.longImages.length > 6 ? "…" : ""}). A picture that stays this long can feel static. Split it or switch it to video.
        </p>
      )}
    </div>
  );
}
