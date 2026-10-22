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
      {value === "chat" && (
        <label className="flex items-center gap-2 text-sm">
          Scenes per message
          <NumberField id="chat-batch-size" value={settings.chatBatchSize ?? 20} min={5} max={25} onChange={(n) => onChange({ chatBatchSize: n })} />
        </label>
      )}
    </Card>
  );
}
