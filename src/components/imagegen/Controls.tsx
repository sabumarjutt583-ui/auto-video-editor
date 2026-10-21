import { ExternalLink, Pause, Play, RefreshCw, RotateCcw, Sparkles } from "lucide-react";

import type { QueueStats } from "../../types/imagegen";
import { Button } from "../ui";

interface ControlsProps {
  stats: QueueStats;
  running: boolean;
  selected: number;
  scenesReady: number;
  busy: boolean;
  onGenerateAll: () => void;
  onPause: () => void;
  onResume: () => void;
  onRetryFailed: () => void;
  onRegenerateSelected: () => void;
  onOpenEditor: () => void;
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-line bg-surface-2 px-4 py-2">
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

export function Controls(props: ControlsProps) {
  const { stats, running } = props;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3" aria-label="Counters">
        <Counter label="Queued" value={stats.queued} />
        <Counter label="Generating" value={stats.generating} />
        <Counter label="Completed" value={stats.completed} />
        <Counter label="Failed" value={stats.failed} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={Sparkles} onClick={props.onGenerateAll} disabled={props.busy || props.scenesReady === 0 || (running && stats.queued + stats.generating > 0)}>
          Generate all scenes
        </Button>
        {running ? (
          <Button icon={Pause} onClick={props.onPause}>
            Pause
          </Button>
        ) : (
          <Button icon={Play} onClick={props.onResume} disabled={props.busy || stats.queued === 0}>
            Resume
          </Button>
        )}
        <Button icon={RotateCcw} onClick={props.onRetryFailed} disabled={props.busy || stats.failed === 0}>
          Retry failed
        </Button>
        <Button icon={RefreshCw} onClick={props.onRegenerateSelected} disabled={props.busy || props.selected === 0}>
          Regenerate selected{props.selected > 0 ? ` (${props.selected})` : ""}
        </Button>
        <Button icon={ExternalLink} onClick={props.onOpenEditor} disabled={stats.completed === 0}>
          Open in Auto Editor
        </Button>
      </div>
    </div>
  );
}
