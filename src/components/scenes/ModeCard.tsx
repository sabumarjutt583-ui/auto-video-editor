import { Layers } from "lucide-react";
import { useState } from "react";

import type { SceneMode, SceneSettings } from "../../types";
import { Button, Card, Field, NumberField, SegmentedControl } from "../ui";

const PRESET_SECONDS = [3, 5, 8] as const;

interface ModeCardProps {
  settings: SceneSettings;
  busy: boolean;
  onChange: (settings: SceneSettings) => void;
  /** Changes only the longest video scene (does not rebuild the scenes). */
  onMaxVideo: (seconds: number) => void;
}

/** How the narration is cut into scenes. */
export function ModeCard({ settings, busy, onChange, onMaxVideo }: ModeCardProps) {
  const [custom, setCustom] = useState(!PRESET_SECONDS.some((value) => value === settings.targetSeconds));
  const [customValue, setCustomValue] = useState(settings.targetSeconds);

  return (
    <Card title="Build the scenes" description="Choose how the narration is cut. The scenes are rebuilt as soon as you change a choice." icon={Layers}>
      <SegmentedControl<SceneMode>
        label="Scene mode"
        value={settings.mode}
        onChange={(mode) => !busy && onChange({ ...settings, mode })}
        options={[
          { value: "sentence", label: "Per sentence" },
          { value: "seconds", label: "Per seconds" },
          { value: "ai", label: "Per scene (AI)" },
        ]}
      />

      {settings.mode === "sentence" && (
        <Field label="Sentences in each scene">
          <SegmentedControl<"1" | "2" | "3" | "4">
            label="Sentences per scene"
            value={String(settings.sentencesPerScene) as "1" | "2" | "3" | "4"}
            onChange={(value) => !busy && onChange({ ...settings, sentencesPerScene: Number(value) })}
            options={[
              { value: "1", label: "1" },
              { value: "2", label: "2" },
              { value: "3", label: "3" },
              { value: "4", label: "4" },
            ]}
          />
        </Field>
      )}

      {settings.mode === "seconds" && (
        <Field label="Target length of a scene" hint="Scenes are cut only at the end of a sentence. A very long sentence is cut at a comma or pause.">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl<"3" | "5" | "8" | "custom">
              label="Target seconds"
              value={custom ? "custom" : (String(settings.targetSeconds) as "3" | "5" | "8")}
              onChange={(value) => {
                if (busy) return;
                if (value === "custom") {
                  setCustom(true);
                  return;
                }
                setCustom(false);
                onChange({ ...settings, targetSeconds: Number(value) });
              }}
              options={[
                { value: "3", label: "3 s" },
                { value: "5", label: "5 s" },
                { value: "8", label: "8 s" },
                { value: "custom", label: "Custom" },
              ]}
            />
            {custom && (
              <>
                <div className="w-28">
                  <NumberField id="custom-seconds" value={customValue} min={1} max={60} step={0.5} onChange={setCustomValue} />
                </div>
                <Button disabled={busy} onClick={() => onChange({ ...settings, targetSeconds: customValue })}>
                  Apply
                </Button>
              </>
            )}
          </div>
        </Field>
      )}

      {settings.mode === "ai" && (
        <p className="text-sm text-muted">Gemini reads the sentences and starts a new scene where the picture should change. Needs a Gemini key in Settings.</p>
      )}

      <Field label="Longest video scene (seconds)" htmlFor="max-video" hint="A video scene longer than this is split into parts such as S05a and S05b.">
        <div className="w-28">
          <NumberField id="max-video" value={settings.maxVideoSeconds} min={2} max={30} step={0.5} onChange={onMaxVideo} />
        </div>
      </Field>
    </Card>
  );
}
