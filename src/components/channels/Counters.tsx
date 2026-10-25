import type { Counts } from "../../lib/pipeline/dashboard";

interface Props {
  counts: Counts;
}

const ITEMS: { key: "running" | "waiting" | "finished"; label: string; tone: string }[] = [
  { key: "running", label: "In progress", tone: "text-accent" },
  { key: "waiting", label: "Waiting for you", tone: "text-warning" },
  { key: "finished", label: "Videos finished", tone: "text-success" },
];

/** The three big numbers at the top of a dashboard. Stopped and failed videos count as "waiting for you". */
export function Counters({ counts }: Props) {
  const values = { running: counts.running, waiting: counts.waiting + counts.failed + counts.stopped, finished: counts.finished };
  return (
    <div className="grid grid-cols-3 gap-3">
      {ITEMS.map((item) => (
        <div key={item.key} className="rounded-2xl border border-line bg-surface px-5 py-4">
          <p className={`text-3xl font-semibold tracking-tight ${item.tone}`}>{values[item.key]}</p>
          <p className="text-sm text-muted">{item.label}</p>
        </div>
      ))}
    </div>
  );
}
