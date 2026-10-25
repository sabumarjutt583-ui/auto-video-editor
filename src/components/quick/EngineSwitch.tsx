import { useEffect } from "react";

import { useSettingsStore } from "../../store/settingsStore";
import type { TextProvider } from "../../types/settings";
import { SegmentedControl } from "../ui";

/** Gemini or Groq writes the prompts (same setting as Settings > Who writes the texts). */
export function EngineSwitch() {
  const settings = useSettingsStore((state) => state.settings);
  const update = useSettingsStore((state) => state.update);
  useEffect(() => {
    if (!settings) void useSettingsStore.getState().load();
  }, [settings]);
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <span>Written by</span>
      <SegmentedControl<TextProvider>
        label="Who writes the texts"
        value={settings?.textProvider ?? "gemini"}
        onChange={(textProvider) => update({ textProvider })}
        options={[{ value: "gemini", label: "Gemini" }, { value: "groq", label: "Groq" }]}
      />
    </div>
  );
}
