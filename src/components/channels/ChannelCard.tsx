import { Link } from "react-router-dom";

import type { Counts } from "../../lib/pipeline/dashboard";

interface Props {
  to: string;
  name: string;
  detail: string;
  counts: Counts;
}

/** One channel on the all-channels dashboard. */
export function ChannelCard({ to, name, detail }: Props) {
  return (
    <Link to={to} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
      <div>
        <h3 className="truncate text-base font-semibold tracking-tight">{name}</h3>
        <p className="truncate text-xs text-muted">{detail}</p>
      </div>

    </Link>
  );
}
