import { AlertTriangle } from "lucide-react";
import { useId } from "react";
import { useNavigate } from "react-router-dom";

import { clock } from "../../lib/imagegen/format";
import type { ImageGenSettings, ImageGenSnapshot } from "../../types/imagegen";
import { Field, NumberField } from "../ui";

interface EngineBarProps {
  snapshot: ImageGenSnapshot;
  onChange: (patch: Partial<ImageGenSettings>) => void;
}

/** How many accounts are ready, how many pictures are made at the same time, and what the engine is waiting for. */
export function EngineBar({ snapshot, onChange }: EngineBarProps) {
  const navigate = useNavigate();
  const parallelId = useId();
  const { settings, notice, accounts } = snapshot;
  const ready = accounts.filter((a) => a.status === "ready" || a.status === "busy").length;

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Field label="Pictures at the same time" htmlFor={parallelId}>
          <div className="w-24">
            <NumberField id={parallelId} value={settings.parallel} min={1} max={8} onChange={(parallel) => onChange({ parallel })} />
          </div>
        </Field>
        <p className="pb-2 text-sm text-muted">
          {ready} of {accounts.length} Google account{accounts.length === 1 ? "" : "s"} ready.{" "}
          <button type="button" onClick={() => navigate("/settings")} className="cursor-pointer font-medium text-accent-fg hover:underline">
            Add or change accounts in Settings
          </button>
        </p>
      </div>
      {notice && (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent-soft p-2.5 text-sm">
          <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-accent-fg" />
          <span>
            {notice.text}
            {notice.until > 0 ? ` (until ${clock(notice.until)})` : ""}
          </span>
        </p>
      )}
    </section>
  );
}
