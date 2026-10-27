import { AlertTriangle, Check, Loader2, Pause } from "lucide-react";

import { sevenStepPercent, type SevenStepRow } from "../../lib/pipeline/sevenSteps";

interface Props {
  rows: SevenStepRow[];
  /** A label for the progress bar, for screen readers. */
  label: string;
}

/** The brother tool's 7-step bar: one line per display step, with the share that is finished. */
export function SevenStepBar({ rows, label }: Props) {
  const percent = sevenStepPercent(rows);
  return (
    <div className="flex flex-col gap-2">
      <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percent}%` }} />
      </div>
      <ol className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-7">
        {rows.map((row) => (
          <li key={row.id} className={row.state === "done" ? "text-success" : row.state === "error" ? "text-danger" : row.state === "waiting" ? "text-warning" : row.state === "running" ? "text-fg" : "text-muted"}>
            <span className="flex items-center gap-1">
              {row.state === "done" && <Check size={12} aria-hidden />}
              {row.state === "running" && <Loader2 size={12} className="animate-spin" aria-hidden />}
              {row.state === "waiting" && <Pause size={12} aria-hidden />}
              {row.state === "error" && <AlertTriangle size={12} aria-hidden />}
              {(row.state === "pending") && <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
              {row.label}
            </span>
            {row.detail && <span className="block pl-4 text-muted">{row.detail}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
