import { MessageSquare } from "lucide-react";

import type { AppSettings } from "../../types";
import { Card, NumberField, SegmentedControl } from "../ui";

interface TextEngineCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

type Engine = "api" | "chat" | "manual";

/** Where the writing (scene groups, characters, prompts, motion graphics) comes from. */
export function TextEngineCard({ settings, onChange }: TextEngineCardProps) {
  const value: Engine = settings.textManual ? "manual" : settings.textViaChat ? "chat" : "api";
  return (
    <Card title="Text engine" description="Who writes the scene groups, characters, prompts and motion graphics." icon={MessageSquare}>
      <SegmentedControl<Engine>
        label="Text engine"
        value={value}
        onChange={(engine) => onChange({ textViaChat: engine === "chat", textManual: engine === "manual" })}
        options={[{ value: "api", label: "Gemini API key" }, { value: "chat", label: "Web chat (free)" }, { value: "manual", label: "Manual (copy & paste)" }]}
      />
      <p className="text-xs text-muted">
        {value === "api"
          ? "Uses your Gemini key. Fast, but the key has a daily limit."
          : value === "manual"
          ? "Prompts are written by you: copy the messages into any AI chat and paste the answers back. No account or key needed."
          : "Uses Gemini in the browser with the Google accounts of the Image Generator (Settings). No key needed. More accounts mean more questions per day. A little slower."}
      </p>
      {value === "api" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-sm">
            Scenes per request
            <NumberField id="api-batch-size" value={settings.apiBatchSize ?? 10} min={5} max={20} onChange={(n) => onChange({ apiBatchSize: n })} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            Requests at the same time
            <NumberField id="api-parallel" value={settings.apiParallel ?? 2} min={1} max={3} onChange={(n) => onChange({ apiParallel: n })} />
          </label>
          <p className="basis-full text-xs text-muted">Smaller requests come back sooner. More requests at the same time is faster, but a key allows only so many per minute: if you see "rate limit", use 1.</p>
        </div>
      )}
      {value === "chat" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-sm">
            Scenes per message
            <NumberField id="chat-batch-size" value={settings.chatBatchSize ?? 10} min={5} max={25} onChange={(n) => onChange({ chatBatchSize: n })} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            Pause before the next message (seconds)
            <NumberField id="chat-pause-min" value={settings.chatPauseMinSec ?? 4} min={0} max={120} onChange={(n) => onChange({ chatPauseMinSec: n })} />
            to
            <NumberField id="chat-pause-max" value={settings.chatPauseMaxSec ?? 12} min={0} max={120} onChange={(n) => onChange({ chatPauseMaxSec: n })} />
          </label>
          <p className="basis-full text-xs text-muted">
            A short random pause keeps the number of messages per minute low, which is kinder to the account's limits. It does not guarantee that Google will never limit an account. If Gemini is slow or the page is lost, the app waits and asks again by itself (up to 3 times).
          </p>
        </div>
      )}
    </Card>
  );
}
