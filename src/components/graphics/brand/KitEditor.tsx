import { ImagePlus, X } from "lucide-react";
import { useState } from "react";

import { COLOR_KEYS, DENSITIES, EASINGS, ENTER_PRESETS, EXIT_PRESETS, FONT_CHOICES, KIT_LIMITS, SCRIPTS, type BrandKit, type ColorKey } from "../../../lib/graphics/brand";
import { pickFile } from "../../../lib/dialog";
import { Field, Select, SegmentedControl, TextInput } from "../../ui";

const COLOR_LABELS: Record<ColorKey, string> = { primary: "Main colour", secondary: "Cards", accent: "Highlight", text: "Text", background: "Background", success: "Good", danger: "Bad" };
const SCRIPT_LABELS: Record<(typeof SCRIPTS)[number], string> = { latin: "Latin", cyrillic: "Cyrillic", korean: "Korean", japanese: "Japanese", chinese: "Chinese", devanagari: "Devanagari (Nepali, Hindi)", arabic: "Arabic and Urdu" };

interface KitEditorProps {
  kit: BrandKit;
  onChange: (kit: BrandKit) => void;
  readOnlyName?: boolean;
}

function Slider({ id, label, value, min, max, step, format, onChange }: { id: string; label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <Field label={`${label}: ${format(value)}`} htmlFor={id}>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-[var(--accent)]" />
    </Field>
  );
}

/** The fields of a brand kit. Every change goes to `onChange`; the person saves from the panel. */
export function KitEditor({ kit, onChange, readOnlyName }: KitEditorProps) {
  const [logoError, setLogoError] = useState<string | null>(null);
  const set = (patch: Partial<BrandKit>): void => onChange({ ...kit, ...patch });
  const pickLogo = async (): Promise<void> => {
    setLogoError(null);
    try {
      const path = await pickFile("Choose your logo", "Pictures", ["png", "jpg", "jpeg", "webp"]);
      if (path) set({ logo: path });
    } catch {
      setLogoError("The picture could not be chosen.");
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <Field label="Name" htmlFor="kit-name">
        <TextInput id="kit-name" value={kit.name} maxLength={KIT_LIMITS.nameMax} disabled={readOnlyName} onChange={(e) => set({ name: e.target.value })} />
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Colours</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {COLOR_KEYS.map((key) => (
            <label key={key} className="flex items-center gap-2 text-xs">
              <input type="color" value={kit.colors[key]} aria-label={COLOR_LABELS[key]} onChange={(e) => set({ colors: { ...kit.colors, [key]: e.target.value } })} className="h-8 w-8 cursor-pointer rounded border border-line bg-transparent p-0" />
              <span className="flex flex-col"><span>{COLOR_LABELS[key]}</span><span className="font-mono text-[10px] text-muted">{kit.colors[key]}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Fonts</legend>
        <p className="text-xs text-muted">Only the fonts that come with the app can be used, so your videos look the same on every computer.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SCRIPTS.map((script) => (
            <Field key={script} label={SCRIPT_LABELS[script]} htmlFor={`kit-font-${script}`}>
              <Select id={`kit-font-${script}`} value={kit.fonts[script]} onChange={(e) => set({ fonts: { ...kit.fonts, [script]: e.target.value } })}>
                {FONT_CHOICES[script].map((family) => <option key={family} value={family}>{family}</option>)}
              </Select>
            </Field>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Slider id="kit-radius" label="Round corners" value={kit.radius} min={KIT_LIMITS.radius.min} max={KIT_LIMITS.radius.max} step={0.05} format={(v) => `${Math.round(v * 100)} %`} onChange={(radius) => set({ radius })} />
        <Slider id="kit-stroke" label="Line thickness" value={kit.strokeWidth} min={KIT_LIMITS.strokeWidth.min} max={KIT_LIMITS.strokeWidth.max} step={0.1} format={(v) => `${Math.round(v * 100)} %`} onChange={(strokeWidth) => set({ strokeWidth })} />
        <Slider id="kit-shadow" label="Text shadow" value={kit.shadow} min={KIT_LIMITS.shadow.min} max={KIT_LIMITS.shadow.max} step={0.05} format={(v) => `${Math.round(v * 100)} %`} onChange={(shadow) => set({ shadow })} />
      </div>

      <div className="flex flex-wrap gap-4">
        <Field label="Title weight">
          <SegmentedControl label="Title weight" value={String(kit.headingWeight) as "400" | "700"} options={[{ value: "400", label: "Light" }, { value: "700", label: "Bold" }]} onChange={(v) => set({ headingWeight: v === "400" ? 400 : 700 })} />
        </Field>
        <Field label="Title letters">
          <SegmentedControl label="Title letters" value={kit.headingCase} options={[{ value: "normal", label: "As written" }, { value: "upper", label: "CAPITALS" }]} onChange={(headingCase) => set({ headingCase })} />
        </Field>
        <Field label="How many graphics">
          <SegmentedControl label="Graphic density" value={kit.density} options={DENSITIES.map((d) => ({ value: d, label: d === "low" ? "Few" : d === "normal" ? "Normal" : "Many" }))} onChange={(density) => set({ density })} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Entrance" htmlFor="kit-enter">
          <Select id="kit-enter" value={kit.enter.preset} onChange={(e) => set({ enter: { ...kit.enter, preset: e.target.value as BrandKit["enter"]["preset"] } })}>
            {ENTER_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        <Slider id="kit-enter-s" label="Entrance time" value={kit.enter.duration} min={0} max={KIT_LIMITS.duration.max} step={0.05} format={(v) => `${v.toFixed(2)} s`} onChange={(duration) => set({ enter: { ...kit.enter, duration } })} />
        <Field label="Exit" htmlFor="kit-exit">
          <Select id="kit-exit" value={kit.exit.preset} onChange={(e) => set({ exit: { ...kit.exit, preset: e.target.value as BrandKit["exit"]["preset"] } })}>
            {EXIT_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        <Slider id="kit-exit-s" label="Exit time" value={kit.exit.duration} min={0} max={KIT_LIMITS.duration.max} step={0.05} format={(v) => `${v.toFixed(2)} s`} onChange={(duration) => set({ exit: { ...kit.exit, duration } })} />
        <Field label="Movement style" htmlFor="kit-easing">
          <Select id="kit-easing" value={kit.easing} onChange={(e) => set({ easing: e.target.value as BrandKit["easing"] })}>
            {EASINGS.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Slider id="kit-margin-x" label="Side margin" value={kit.safeMargins.x} min={0} max={KIT_LIMITS.safeMargin.max} step={0.01} format={(v) => `${Math.round(v * 100)} %`} onChange={(x) => set({ safeMargins: { ...kit.safeMargins, x } })} />
        <Slider id="kit-margin-y" label="Top and bottom margin" value={kit.safeMargins.y} min={0} max={KIT_LIMITS.safeMargin.max} step={0.01} format={(v) => `${Math.round(v * 100)} %`} onChange={(y) => set({ safeMargins: { ...kit.safeMargins, y } })} />
      </div>

      <Field label="Logo (optional)" hint="Saved with the kit. Graphics will use it in a later step.">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void pickLogo()} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2"><ImagePlus className="h-4 w-4" aria-hidden />Choose picture</button>
          {kit.logo && <><span className="min-w-0 truncate text-xs text-muted" title={kit.logo}>{kit.logo}</span><button type="button" aria-label="Remove the logo" onClick={() => set({ logo: "" })} className="cursor-pointer rounded p-1 hover:text-danger"><X className="h-4 w-4" /></button></>}
        </div>
        {logoError && <p className="text-xs text-danger" role="alert">{logoError}</p>}
      </Field>
    </div>
  );
}
