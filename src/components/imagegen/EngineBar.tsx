import { AlertTriangle } from "lucide-react";
import { useId } from "react";
import { useNavigate } from "react-router-dom";

import { clock } from "../../lib/imagegen/format";
import type { ImageGenSnapshot } from "../../types/imagegen";
import type { GenEngine } from "../../types/imagegen";
import { Checkbox, Field, NumberField, SegmentedControl, Select } from "../ui";
import type { ImageGenSettings } from "../../types/imagegen";

interface EngineBarProps {
  snapshot: ImageGenSnapshot;
  onChange: (patch: Partial<ImageGenSettings>) => void;
}

/** Which engine makes the pictures, the fallback, the parallel limit and what the engine is waiting for. */
export function EngineBar({ snapshot, onChange }: EngineBarProps) {
  const navigate = useNavigate();
  const parallelId = useId();
  const providerId = useId();
  const { settings, notice, accounts } = snapshot;
  const ready = accounts.filter((a) => a.status === "ready" || a.status === "busy").length;

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Field label="Engine">
          <SegmentedControl<GenEngine>
            label="Engine"
            value={settings.engine}
            onChange={(engine) => onChange({ engine })}
            options={[
              { value: "free", label: "Free (Google account)" },
              { value: "api", label: "API (your key)" },
            ]}
          />
        </Field>
        {(settings.engine === "api" || settings.fallbackToApi) && (
          <Field label="API service" htmlFor={providerId}>
            <Select id={providerId} value={settings.apiProvider} onChange={(event) => onChange({ apiProvider: event.target.value === "cloudflare" ? "cloudflare" : "gemini" })}>
              <option value="gemini">Gemini image model</option>
              <option value="cloudflare">Cloudflare FLUX</option>
            </Select>
          </Field>
        )}
        <Field label="Pictures at the same time" htmlFor={parallelId}>
          <div className="w-24">
            <NumberField id={parallelId} value={settings.parallel} min={1} max={8} onChange={(parallel) => onChange({ parallel })} />
          </div>
        </Field>
        {settings.engine === "free" && (
          <Checkbox label="If Free fails or all accounts hit their limit, continue with API" checked={settings.fallbackToApi} onChange={(event) => onChange({ fallbackToApi: event.target.checked })} />
        )}
      </div>
      <p className="text-xs text-muted">
        {settings.engine === "free" ? `${ready} of ${accounts.length} account${accounts.length === 1 ? "" : "s"} ready.` : "Using your API key."}{" "}
        <button type="button" onClick={() => navigate("/settings")} className="cursor-pointer font-medium text-accent-fg hover:underline">
          Engine settings
        </button>
      </p>
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
