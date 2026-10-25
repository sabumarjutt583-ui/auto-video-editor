import { AlertTriangle, Check, CircleDashed, Loader2, Pause, SkipForward } from "lucide-react";

import { STAGES } from "../../lib/pipeline/stages";
import { percentDone, type RowState, type RunView } from "../../lib/pipeline/view";
import { selectJob, useJobStore } from "../../store/jobStore";
import { Card } from "../ui";
import { JobBar } from "../voice/JobBar";

const ICONS: Record<RowState, JSX.Element> = {
  pending: <CircleDashed size={16} className="text-muted" aria-hidden />,
  skipped: <SkipForward size={16} className="text-muted" aria-hidden />,
  waiting: <Pause size={16} className="text-warning" aria-hidden />,
  running: <Loader2 size={16} className="animate-spin text-accent" aria-hidden />,
  done: <Check size={16} className="text-success" aria-hidden />,
  error: <AlertTriangle size={16} className="text-danger" aria-hidden />,
};

/** One row per step with its state, and the progress bar of the work that is running. */
export function RunPanel({ view }: { view: RunView }) {
  const job = useJobStore(selectJob(["tts", "transcribe", "ai", "audio", "render", "silence-apply", "silence-skip"]));
  const percent = percentDone(view);
  return (
    <Card title="Making your video" description={`${percent}% of the steps are finished.`}>
      <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percent}%` }} />
      </div>
      <ol className="flex flex-col gap-2">
        {view.rows.map((row) => {
          const info = STAGES.find((s) => s.id === row.id);
          return (
            <li key={row.id} className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3" data-state={row.state}>
              <span className="mt-0.5">{ICONS[row.state]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{info?.label ?? row.id}</p>
                <p className="text-xs text-muted">{row.detail || (row.state === "pending" ? info?.hint : "")}</p>
              </div>
            </li>
          );
        })}
      </ol>
      {job && view.status === "running" && <JobBar job={job} />}
    </Card>
  );
}
