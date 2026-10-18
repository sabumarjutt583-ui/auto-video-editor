import { useEffect } from "react";

import { cn } from "../lib/cn";
import { useEngineStore, type EngineStatus as Status } from "../store/engineStore";
import { ErrorNotice } from "./ErrorNotice";

const LABELS: Record<Status, string> = {
  checking: "Engine: checking…",
  ready: "Engine: ready",
  missing: "Engine: missing",
};

const DOT_CLASSES: Record<Status, string> = {
  checking: "bg-muted animate-pulse",
  ready: "bg-success",
  missing: "bg-danger",
};

const TEXT_CLASSES: Record<Status, string> = {
  checking: "text-muted",
  ready: "text-success",
  missing: "text-danger",
};

/** Small status line at the bottom of the sidebar showing whether FFmpeg works. */
export function EngineStatus() {
  const status = useEngineStore((state) => state.status);
  const version = useEngineStore((state) => state.version);
  const error = useEngineStore((state) => state.error);
  const check = useEngineStore((state) => state.check);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
      <div
        className="flex items-center gap-2 text-xs font-medium"
        title={version ? `FFmpeg ${version}` : undefined}
        aria-live="polite"
      >
        <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", DOT_CLASSES[status])} />
        <span className={TEXT_CLASSES[status]}>{LABELS[status]}</span>
      </div>
      {status === "missing" && error && <ErrorNotice error={error} />}
    </div>
  );
}
