import { AlertTriangle, Check, Loader2, Pause } from "lucide-react";
import { sevenStepPercent, type SevenStepRow } from "../../lib/pipeline/sevenSteps";

export function SevenStepBar({ rows, label }: { rows: SevenStepRow[]; label: string }) {
  const percent = sevenStepPercent(rows);
  const names = { done: "Completed", running: "Generating", waiting: "Waiting", error: "Needs a look", pending: "Pending" };
  return <div className="flex flex-col gap-4">
    <div className="flex items-center justify-between text-xs text-muted"><span>{rows.filter(row => row.done).length} of {rows.length} stages completed</span><strong className="text-lg tabular-nums text-fg">{percent}%</strong></div>
    <div className="h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-gradient-to-r from-accent to-emerald-400 transition-all" style={{ width: `${percent}%` }} />
    </div>
    <ol className="grid grid-cols-2 gap-y-4 sm:grid-cols-7">
      {rows.map((row, index) => <li key={row.id} className={`min-w-0 pr-3 text-xs ${row.state === "done" ? "text-success" : row.state === "error" ? "text-danger" : row.state === "waiting" ? "text-warning" : row.state === "running" ? "text-accent" : "text-muted"}`}>
        <div className="mb-2 flex items-center"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-semibold ${row.state === "done" ? "border-success bg-success/10" : row.state === "running" ? "border-accent bg-accent/15" : "border-line bg-surface"}`}>
          {row.state === "done" ? <Check size={15} /> : row.state === "running" ? <Loader2 size={15} className="animate-spin" /> : row.state === "waiting" ? <Pause size={13} /> : row.state === "error" ? <AlertTriangle size={14} /> : index + 1}
        </span>{index < rows.length - 1 && <span aria-hidden className={`ml-2 h-px flex-1 ${row.done ? "bg-success" : "bg-line"}`} />}</div>
        <p className="font-semibold">{row.label}</p><span className="mt-1 inline-block rounded-full border border-current px-2 py-0.5 text-[10px]">{names[row.state]}</span>
        {row.detail && <p className="mt-1 break-words text-muted">{row.detail}</p>}
      </li>)}
    </ol>
  </div>;
}
