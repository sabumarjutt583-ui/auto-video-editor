import { describeIssues, validateSpec } from "../spec/index.ts";
import type { GraphicSpec } from "../spec/schema.ts";

export type FieldKind = "text" | "number" | "icon" | "country";
export type Path = ReadonlyArray<string | number>;

export interface Field {
  /** Stable id of the field inside the graphic (the path as text). */
  id: string;
  path: Path;
  layerId: string;
  /** Short name for the form, e.g. "Title" or "Row 2 value". */
  label: string;
  kind: FieldKind;
  value: string | number;
}

const TEXT_KEYS = new Set(["text", "title", "subtitle", "quote", "author", "label", "name", "prefix", "suffix", "date", "unit"]);
const NUMBER_KEYS = new Set(["from", "to", "value"]);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const NICE: Record<string, string> = { text: "Text", title: "Title", subtitle: "Subtitle", quote: "Quote", author: "Author", label: "Label", name: "Name", prefix: "Before the number", suffix: "After the number", date: "Date", unit: "Unit", from: "Start value", to: "End value", value: "Value", code: "Country", country: "Country", icon: "Icon" };

function walk(node: unknown, path: Path, layerId: string, out: Field[], labelPrefix: string): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      const label = path[path.length - 1] === "words" ? `Word ${i + 1}` : `${labelPrefix}${labelPrefix ? " " : ""}${singular(String(path[path.length - 1] ?? ""))} ${i + 1}`.trim();
      if (typeof item === "string") out.push({ id: [...path, i].join("."), path: [...path, i], layerId, label, kind: "text", value: item });
      else walk(item, [...path, i], layerId, out, label);
    });
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const here = [...path, key];
    const label = `${labelPrefix}${labelPrefix ? ": " : ""}${NICE[key] ?? key}`;
    if (key === "box" || key === "enter" || key === "exit" || key === "camera" || key === "routes") continue;
    if (typeof value === "string" && TEXT_KEYS.has(key)) out.push({ id: here.join("."), path: here, layerId, label, kind: "text", value });
    else if (typeof value === "number" && NUMBER_KEYS.has(key)) out.push({ id: here.join("."), path: here, layerId, label, kind: "number", value });
    else if ((key === "country" || key === "code") && typeof value === "string") out.push({ id: here.join("."), path: here, layerId, label, kind: "country", value });
    else if (key === "icon" && isRecord(value) && typeof value.set === "string" && typeof value.name === "string") out.push({ id: here.join("."), path: here, layerId, label, kind: "icon", value: `${value.set}:${value.name}` });
    else if (Array.isArray(value) || isRecord(value)) {
      if (key === "runs" || key === "rows" || key === "events" || key === "items" || key === "words" || key === "countries" || key === "pins") walk(value, here, layerId, out, labelPrefix);
    }
  }
}

function singular(key: string): string {
  const map: Record<string, string> = { runs: "Part", rows: "Row", events: "Event", items: "Item", words: "Word", countries: "Country", pins: "Pin" };
  return map[key] ?? key;
}

/** Everything a person can change in a graphic: texts, numbers, icons, countries and flags. */
export function fieldsOf(spec: GraphicSpec): Field[] {
  const out: Field[] = [];
  spec.layers.forEach((layer, index) => {
    const before = out.length;
    walk(layer, ["layers", index], layer.id, out, "");
    for (let i = before; i < out.length; i++) (out[i] as Field).label = `${layer.id} · ${(out[i] as Field).label}`;
  });
  return out;
}

function setAt(root: unknown, path: Path, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path as [string | number, ...Array<string | number>];
  if (Array.isArray(root)) return root.map((item, i) => (i === head ? setAt(item, rest, value) : item));
  if (isRecord(root)) return { ...root, [head]: setAt(root[head as string], rest, value) };
  return root;
}

export type EditResult = { ok: true; spec: GraphicSpec } | { ok: false; error: string };

/** Changes one field. The result must pass the strict check (a wrong country code or icon name is refused with a plain message). */
export function setField(spec: GraphicSpec, field: Pick<Field, "path" | "kind">, value: string | number): EditResult {
  let next: unknown;
  if (field.kind === "icon") {
    const [set, name] = String(value).split(":");
    next = setAt(spec, field.path, { set: set === "tabler" ? "tabler" : "lucide", name: name ?? "" });
  } else if (field.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, error: "Please type a number." };
    next = setAt(spec, field.path, value);
  } else if (field.kind === "country") {
    next = setAt(spec, field.path, String(value).trim().toUpperCase());
  } else {
    const text = String(value).trim();
    if (text === "") return { ok: false, error: "The text cannot be empty." };
    next = setAt(spec, field.path, text);
  }
  const checked = validateSpec(next);
  return checked.ok ? { ok: true, spec: checked.spec } : { ok: false, error: describeIssues(checked.issues, 3) };
}
