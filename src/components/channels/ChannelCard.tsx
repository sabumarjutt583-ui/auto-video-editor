import { Link } from "react-router-dom";

import type { Counts } from "../../lib/pipeline/dashboard";

interface Props {
  to: string;
  name: string;
  detail: string;
  counts: Counts;
}

/** One channel on the all-channels dashboard. */
export function ChannelCard({ to, name, detail, counts }: Props) {
  const attention = counts.waiting + counts.failed;
  return (
    <Link to={to} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
      <div>
        <h3 className="truncate text-base font-semibold tracking-tight">{name}</h3>
        <p className="truncate text-xs text-muted">{detail}</p>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div>
          <dd className="text-xl font-semibold text-accent">{counts.running}</dd>
          <dt className="text-xs text-muted">In progress</dt>
        </div>
        <div>
          <dd className={`text-xl font-semibold ${attention > 0 ? "text-warning" : ""}`}>{attention + counts.stopped}</dd>
          <dt className="text-xs text-muted">Waiting</dt>
        </div>
        <div>
          <dd className="text-xl font-semibold text-success">{counts.finished}</dd>
          <dt className="text-xs text-muted">Finished</dt>
        </div>
      </dl>
    </Link>
  );
}
