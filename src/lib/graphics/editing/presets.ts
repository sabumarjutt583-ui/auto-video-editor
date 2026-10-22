import { describeIssues, repairSpec, validateSpec } from "../spec/index.ts";
import type { GraphicSpec } from "../spec/schema.ts";
import { fieldsOf, setField } from "./fields.ts";

/** A graphic the person saved to use again. The texts are placeholders `{{1}}`, `{{2}}` ...; `samples` are the words it had. */
export interface GraphicPreset {
  id: string;
  name: string;
  spec: GraphicSpec;
  samples: string[];
}

export const MAX_PRESETS = 100;
const TOKEN = /\{\{(\d{1,2})\}\}/g;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Letters, digits and "_" only; a taken id gets a number. */
export function presetId(name: string, taken: readonly string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "preset";
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 1000; n++) if (!taken.includes(`${base}_${n}`)) return `${base}_${n}`;
  return `${base}_${taken.length + 1}`;
}

/** The text fields of a spec, in reading order (the ones that become placeholders). */
function textFields(spec: GraphicSpec): ReturnType<typeof fieldsOf> {
  return fieldsOf(spec).filter((f) => f.kind === "text" && !/(^|\.)(prefix|suffix|unit|date)$/.test(f.id));
}

/** Turns a graphic into a preset: every text becomes a placeholder and the old texts are kept as samples. */
export function makePreset(name: string, spec: GraphicSpec, taken: readonly string[]): GraphicPreset | null {
  const fields = textFields(spec);
  let current = spec;
  const samples: string[] = [];
  for (const field of fields) {
    samples.push(String(field.value));
    const next = setField(current, field, `{{${samples.length}}}`);
    if (!next.ok) return null;
    current = next.spec;
  }
  const clean = name.trim().slice(0, 40);
  return clean === "" ? null : { id: presetId(clean, taken), name: clean, spec: { ...current, id: "preset" }, samples };
}

/** How many texts a preset has. */
export const placeholderCount = (preset: GraphicPreset): number => preset.samples.length;

/** A graphic from a preset: `texts[i]` replaces `{{i+1}}` (the sample text when missing or empty). Always passes the strict check, or returns null. */
export function fillPreset(preset: GraphicPreset, texts: readonly string[] = []): GraphicSpec | null {
  const json = JSON.stringify(preset.spec).replace(TOKEN, (_all, n: string) => {
    const index = Number(n) - 1;
    const wanted = (texts[index] ?? "").trim();
    return JSON.stringify(wanted !== "" ? wanted : preset.samples[index] ?? "").slice(1, -1);
  });
  const made = repairSpec(JSON.parse(json));
  return made.ok ? made.spec : null;
}

/** A preset read from the settings file: anything unusable is dropped (the settings are not trusted). */
export function readPreset(value: unknown): GraphicPreset | null {
  if (!isRecord(value) || typeof value.id !== "string" || !/^[a-z0-9_]{1,40}$/.test(value.id) || typeof value.name !== "string" || value.name.trim() === "") return null;
  const checked = validateSpec(value.spec);
  if (!checked.ok) return null;
  const samples = Array.isArray(value.samples) ? value.samples.filter((s): s is string => typeof s === "string").slice(0, 40) : [];
  return { id: value.id, name: value.name.trim().slice(0, 40), spec: checked.spec, samples };
}

export function readPresets(values: readonly unknown[]): GraphicPreset[] {
  return values.map(readPreset).filter((p): p is GraphicPreset => p !== null).slice(0, MAX_PRESETS);
}

/** Up to `limit` of the person's own graphics, as short JSON examples for the AI director (with their sample texts filled in). */
export function presetExamples(presets: readonly GraphicPreset[], limit = 3): string[] {
  return presets.slice(0, limit).flatMap((p) => {
    const spec = fillPreset(p);
    return spec ? [`${p.name}: ${JSON.stringify({ ...spec, id: "example" })}`.slice(0, 1800)] : [];
  });
}

export { describeIssues };
