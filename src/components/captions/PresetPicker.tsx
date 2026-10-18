import { cn } from "../../lib/cn";
import { PRESETS } from "../../lib/captions/presets";
import type { CaptionPreset } from "../../types";

/** The caption looks to choose from. */
export function PresetPicker({ value, onChange }: { value: CaptionPreset; onChange: (preset: CaptionPreset) => void }) {
  return (
    <div role="radiogroup" aria-label="Caption style" className="grid grid-cols-2 gap-2">
      {PRESETS.map((preset) => {
        const selected = preset.id === value;
        return (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(preset.id)}
            className={cn("cursor-pointer rounded-xl border p-2.5 text-left transition-colors", selected ? "border-accent bg-accent-soft" : "border-line bg-surface-2 hover:border-muted")}
          >
            <span className="block text-sm font-medium">{preset.label}</span>
            <span className="block text-xs text-muted">{preset.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
