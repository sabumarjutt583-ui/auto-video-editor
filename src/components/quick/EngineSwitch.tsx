import { useEffect } from "react";

import { useSettingsStore } from "../../store/settingsStore";
import { SegmentedControl } from "../ui";

type Engine = "api" | "chat" | "manual";

/** API key or Gemini web chat for the writing (same setting as Settings > Text engine). */
export function EngineSwitch() {
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  useEffect(() => {
    if (!settings) void useSettingsStore.getState().load();
  }, [settings]);
  const value: Engine = settings?.textManual ? "manual" : settings?.textViaChat ? "chat" : "api";
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <span>Engine</span>
      <SegmentedControl<Engine>
        label="Text engine"
        value={value}
        onChange={(engine) => update({ textViaChat: engine === "chat", textManual: engine === "manual" })}
        options={[{ value: "api", label: "API key" }, { value: "chat", label: "Gemini web chat (automatic)" }, { value: "manual", label: "Manual (copy & paste)" }]}
      />
    </div>
  );
}
