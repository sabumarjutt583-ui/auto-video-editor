import { X } from "lucide-react";

import type { JobInfo } from "../../store/jobStore";
import { requestCancel } from "../../store/jobStore";
import { Button } from "../ui";

interface JobBarProps {
  job: JobInfo;
}

/** Progress bar with the current stage and a Cancel button. */
export function JobBar({ job }: JobBarProps) {
  const percent = Math.round(job.percent);
  return (
    <div className="flex items-center gap-4 rounded-xl border border-line bg-surface-2 p-3" role="status">
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
          <span className="font-medium">{job.stage}…</span>
          <span className="tabular-nums text-muted">{percent}%</span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={job.stage}
        >
          <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <Button icon={X} onClick={() => requestCancel(job.id)}>
        Cancel
      </Button>
    </div>
  );
}
