import { MessageSquare } from "lucide-react";

import type { AppSettings } from "../../types";
import type { TextProvider } from "../../types/settings";
import { Card, NumberField, SegmentedControl } from "../ui";

interface TextEngineCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

/** Who writes the scene groups, characters, prompts and motion graphics: Gemini or Groq (API keys). */
export function TextEngineCard({ settings, onChange }: TextEngineCardProps) {
  const value: TextProvider = settings.textProvider === "groq" ? "groq" : "gemini";
  return (
    <Card title="Who writes the texts" description="Who writes the scene groups, characters and prompts. Word timing from your voice is always done by Groq." icon={MessageSquare}>
      <SegmentedControl<TextProvider>
        label="Who writes the texts"
        value={value}
        onChange={(textProvider) => onChange({ textProvider })}
        options={[{ value: "gemini", label: "Gemini" }, { value: "groq", label: "Groq" }]}
      />
      <p className="text-xs text-muted">
        {value === "gemini"
          ? "Uses your Gemini keys. If you saved several, the next key is used when one reaches its limit."
          : "Uses your Groq keys (Settings > Groq text model). If you saved several, the next key is used when one reaches its limit."}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          Scenes per request
          <NumberField id="api-batch-size" value={settings.apiBatchSize ?? 10} min={5} max={20} onChange={(n) => onChange({ apiBatchSize: n })} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Requests at the same time
          <NumberField id="api-parallel" value={settings.apiParallel ?? 2} min={1} max={3} onChange={(n) => onChange({ apiParallel: n })} />
        </label>
        <p className="basis-full text-xs text-muted">Smaller requests come back sooner. More requests at the same time is faster, but a key allows only so many per minute: if you see "rate limit", use 1, or save more keys.</p>
      </div>
    </Card>
  );
}
