import { MessageSquare } from "lucide-react";

import type { AppSettings } from "../../types";
import { Card, NumberField, SegmentedControl } from "../ui";

interface TextEngineCardProps {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

type Engine = "api" | "chat";

/** Where the writing (scene groups, characters, prompts, motion graphics) comes from. */
export function TextEngineCard({ settings, onChange }: TextEngineCardProps) {
  const value: Engine = settings.textViaChat ? "chat" : "api";
  return (
    <Card title="Text engine" description="Who writes the scene groups, characters, prompts and motion graphics." icon={MessageSquare}>
      <SegmentedControl<Engine>
        label="Text engine"
        value={value}
        onChange={(engine) => onChange({ textViaChat: engine === "chat" })}
        options={[{ value: "api", label: "Gemini API key" }, { value: "chat", label: "Web chat (free)" }]}
      />
      <p className="text-xs text-muted">
        {value === "api"
          ? "Uses your Gemini key. Fast, but the key has a daily limit."
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
