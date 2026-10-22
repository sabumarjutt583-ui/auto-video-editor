import { describeIssues, repairSpec } from "../spec/index.ts";
import type { GraphicSpec } from "../spec/schema.ts";
import { addedBrandName } from "./names.ts";
import type { DirectorScene } from "./prompt.ts";
import { graphicWindow, type Window } from "./window.ts";

export interface ParsedEntry {
  trigger: number | null;
  graphic: unknown;
}

export type Parsed = { ok: true; entries: Map<string, ParsedEntry> } | { ok: false; error: string };

/** The first JSON value in a text (the AI may add a code fence or a sentence around it). */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const open = cleaned.search(/[{[]/);
  if (open < 0) throw new Error("There is no JSON in the answer.");
  const close = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (close <= open) throw new Error("The JSON in the answer is cut off.");
  return JSON.parse(cleaned.slice(open, close + 1)) as unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads the AI's answer into one entry per scene id (`graphic` is still untrusted). Ids that were not asked for are dropped. */
export function parseAnswer(text: string, ids: readonly string[]): Parsed {
  let data: unknown;
  try {
    data = extractJson(text);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The answer is not JSON." };
  }
  const list = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.scenes) ? data.scenes : null;
  if (!list) return { ok: false, error: 'The answer must be {"scenes": [...]}.' };
  const entries = new Map<string, ParsedEntry>();
  for (const item of list) {
    if (!isRecord(item) || typeof item.id !== "string" || !ids.includes(item.id) || entries.has(item.id)) continue;
    const trigger = typeof item.trigger === "number" && Number.isInteger(item.trigger) && item.trigger >= 0 ? item.trigger : null;
    const raw = item.graphic;
    const none = raw === null || raw === undefined || raw === "none" || raw === false || (isRecord(raw) && Object.keys(raw).length === 0);
    entries.set(item.id, { trigger, graphic: none ? null : raw });
  }
  return { ok: true, entries };
}

export interface Accepted {
  spec: GraphicSpec;
  window: Window;
  /** The trigger the graphic starts on (index into the scene's triggers), or -1. */
  trigger: number;
  /** What was repaired on the way, in plain English. */
  repairs: string[];
}

export type Accept = { ok: true; value: Accepted } | { ok: false; problems: string };

function textsOf(spec: GraphicSpec): string[] {
  const out: string[] = [];
  for (const l of spec.layers) {
    switch (l.type) {
      case "text": out.push(l.text); break;
      case "richText": out.push(...l.runs.map((r) => r.text)); break;
      case "counter": out.push(l.label ?? "", l.prefix ?? "", l.suffix ?? ""); break;
      case "chart": out.push(l.title ?? "", ...l.rows.map((r) => r.label)); break;
      case "timeline": out.push(...l.events.flatMap((e) => [e.label, e.date ?? ""])); break;
      case "lowerThird": out.push(l.title, l.subtitle ?? ""); break;
      case "quoteCard": out.push(l.quote, l.author ?? ""); break;
      case "list": out.push(...l.items.map((i) => i.text)); break;
      case "progressBar": case "flag": out.push(l.label ?? ""); break;
      case "kineticText": out.push(...l.words); break;
      case "map": out.push(...l.countries.map((c) => c.label ?? ""), ...l.pins.map((p) => p.name)); break;
      default: break;
    }
  }
  return out;
}

/**
 * Checks one graphic of the AI against the schema and the rules of the director, and fits it into its scene: it starts on the chosen
 * trigger and ends before the scene ends. Everything unknown is dropped, numbers are clamped (repairSpec). Never throws.
 */
export function acceptGraphic(raw: unknown, scene: DirectorScene, triggerIndex: number | null): Accept {
  const body = isRecord(raw) && isRecord(raw.spec) ? raw.spec : raw;
  if (!isRecord(body)) return { ok: false, problems: "The graphic must be a JSON object." };
  // The AI cannot know project files: picture layers are removed. The id is ours.
  const layers = Array.isArray(body.layers) ? body.layers.filter((l) => !(isRecord(l) && l.type === "image")) : body.layers;
  const first = repairSpec({ ...body, layers, schemaVersion: 1, id: `g-${scene.id}`, ...(typeof body.duration === "number" ? {} : { duration: 3.5 }) });
  if (!first.ok) return { ok: false, problems: describeIssues(first.issues) };
  const banned = addedBrandName(textsOf(first.spec), scene.text);
  if (banned !== null) return { ok: false, problems: `The graphic uses the brand or artist name "${banned}", which the narration does not say. Do not add brand, studio or artist names.` };

  const picked = triggerIndex !== null ? scene.triggers[triggerIndex] : undefined;
  const anchor = picked ?? scene.triggers[0];
  const window = graphicWindow(scene, anchor?.time ?? scene.start, anchor?.endTime ?? scene.start + 1, first.spec.duration);
  if (!window) return { ok: false, problems: "The scene is too short for a graphic." };
  const fitted = repairSpec({ ...first.spec, duration: window.duration });
  if (!fitted.ok) return { ok: false, problems: describeIssues(fitted.issues) };
  return { ok: true, value: { spec: fitted.spec, window, trigger: picked ? (triggerIndex as number) : anchor ? 0 : -1, repairs: [...first.issues, ...fitted.issues].map((i) => `${i.path} ${i.message}`) } };
}
