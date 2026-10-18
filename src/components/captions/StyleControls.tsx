import { FONTS } from "../../lib/captions/fonts";
import type { CaptionFont, CaptionPosition, CaptionStyle } from "../../types";
import { Checkbox, Field, SegmentedControl, Select } from "../ui";

interface StyleControlsProps {
  style: CaptionStyle;
  autoFont: string;
  uppercaseOk: boolean;
  onChange: (patch: Partial<CaptionStyle>) => void;
}

function Slider({ id, label, value, min, max, step, unit, onChange }: { id: string; label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (value: number) => void }) {
  return (
    <Field label={`${label}: ${value}${unit ?? ""}`} htmlFor={id}>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-[var(--accent)]" />
    </Field>
  );
}

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label} htmlFor={id}>
      <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-9 w-full cursor-pointer rounded-lg border border-line bg-surface-2 p-1" />
    </Field>
  );
}

/** Size, colors, outline, position, font. */
export function StyleControls({ style, autoFont, uppercaseOk, onChange }: StyleControlsProps) {
  return (
    <div className="flex flex-col gap-3">
      <Slider id="cap-size" label="Text size" value={style.fontSize} min={2} max={12} step={0.2} onChange={(fontSize) => onChange({ fontSize })} />
      <div className="grid grid-cols-2 gap-3">
        <ColorField id="cap-primary" label="Text color" value={style.primary} onChange={(primary) => onChange({ primary })} />
        <ColorField id="cap-highlight" label="Highlight color" value={style.highlight} onChange={(highlight) => onChange({ highlight })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Slider id="cap-outline" label="Outline" value={style.outline} min={0} max={8} step={0.5} onChange={(outline) => onChange({ outline })} />
        <Slider id="cap-shadow" label="Shadow" value={style.shadow} min={0} max={8} step={0.5} onChange={(shadow) => onChange({ shadow })} />
      </div>
      <Field label="Position">
        <SegmentedControl<CaptionPosition> label="Caption position" value={style.position} onChange={(position) => onChange({ position })} options={[{ value: "bottom", label: "Bottom" }, { value: "middle", label: "Middle" }, { value: "top", label: "Top" }]} />
      </Field>
      <Field label="Font" htmlFor="cap-font" hint="Automatic picks the font that matches the language of your script.">
        <Select id="cap-font" value={style.font} onChange={(e) => onChange({ font: e.target.value as CaptionFont })}>
          <option value="auto">Automatic ({autoFont})</option>
          {FONTS.map((font) => (
            <option key={font.id} value={font.id}>
              {font.label}
            </option>
          ))}
        </Select>
      </Field>
      <Checkbox label={uppercaseOk ? "UPPERCASE letters" : "UPPERCASE letters (only for Latin scripts)"} checked={style.uppercase && uppercaseOk} disabled={!uppercaseOk} onChange={(e) => onChange({ uppercase: e.target.checked })} />
    </div>
  );
}
