import { isCancelled } from "../../errors.ts";
import { repairSpec } from "../spec/index.ts";
import type { GraphicSpec } from "../spec/schema.ts";
import { acceptGraphic, parseAnswer } from "./answer.ts";
import { selectScenes, type Selection } from "./density.ts";
import { bestFallbackTrigger, fallbackLayers } from "./fallback.ts";
import { MAIN_TYPES } from "./guide.ts";
import { buildBatchPrompt, buildSystem, type DirectorScene, type DirectorSettings } from "./prompt.ts";
import type { TriggerKind } from "./types.ts";
import { graphicWindow } from "./window.ts";

/** Scenes asked about in one request. */
export const DIRECTOR_BATCH = 20;

/** A graphic the director made for a scene. */
export interface Placed {
  sceneId: string;
  spec: GraphicSpec;
  /** Seconds from the start of the voice-over. */
  start: number;
  duration: number;
  /** "ai" = written by the AI, "fallback" = the simple graphic made by rules because the AI's answer could not be used. */
  source: "ai" | "fallback";
  /** The kind of moment it shows. */
  trigger: TriggerKind | null;
  repairs: string[];
}

export interface DirectorArgs {
  scenes: readonly DirectorScene[];
  settings: DirectorSettings;
  /** One request to the AI (system instruction, prompt) -> its text. Throws on failure; a cancel must throw a cancel error. */
  call: (system: string, prompt: string) => Promise<string>;
  /** Icon names ("lucide:users") that fit a scene, best first. */
  icons: (scene: DirectorScene) => Promise<string[]>;
  /** Short JSON examples of the person's saved graphics (presets), shown to the AI. */
  examples?: readonly string[];
  /** Only these scenes (a per-scene request: the density limit does not apply). Missing = the whole project. */
  only?: ReadonlySet<string>;
  /** Types of graphics that stay in the project, to vary the new ones. */
  earlier?: ReadonlyArray<{ id: string; type: string }>;
  onBatch?: (number: number, total: number) => void;
  /** Called after every batch with what was made so far, so finished batches can be saved. */
  onPlaced?: (placed: readonly Placed[]) => void;
}

export interface DirectorResult {
  placed: Placed[];
  /** Why a scene has no graphic. */
  skipped: Array<{ id: string; reason: string }>;
  /** Set when a request to the AI failed (not an unusable answer): the earlier batches are kept. */
  failed: { batch: number; error: unknown } | null;
}

const REASONS: Record<Selection["skipped"][number]["reason"], string> = {
  clean: "nothing in the narration to show",
  "too-short": "the scene is too short",
  density: "kept clean because of the graphic density",
  neighbours: "kept clean so graphics do not follow each other too closely",
};

export function primaryType(spec: GraphicSpec): string {
  return (spec.layers.find((l) => (MAIN_TYPES as readonly string[]).includes(l.type)) ?? spec.layers[0])?.type ?? "text";
}

export function fallbackFor(scene: DirectorScene): Placed | null {
  const trigger = bestFallbackTrigger(scene.triggers);
  const layers = trigger ? fallbackLayers(trigger) : null;
  if (!trigger || !layers) return null;
  const window = graphicWindow(scene, trigger.time, trigger.endTime);
  if (!window) return null;
  const made = repairSpec({ schemaVersion: 1, id: `g-${scene.id}`, duration: window.duration, layers });
  return made.ok ? { sceneId: scene.id, spec: made.spec, start: window.start, duration: window.duration, source: "fallback", trigger: trigger.kind, repairs: [] } : null;
}

/**
 * The AI graphics director. Step 1 (rules) already found the triggers; this picks the scenes (density), asks the AI in batches of
 * 20 for a GraphicSpec per scene, checks every answer, asks once more for the scenes whose graphic was unusable, and for the
 * rest makes a simple safe graphic from the trigger or none. A bad answer never throws.
 */
export async function directGraphics(args: DirectorArgs): Promise<DirectorResult> {
  const { scenes, settings, call } = args;
  const result: DirectorResult = { placed: [], skipped: [], failed: null };
  const byId = new Map(scenes.map((s) => [s.id, s]));

  let chosen: string[];
  if (args.only) {
    chosen = scenes.filter((s) => args.only?.has(s.id)).map((s) => s.id);
  } else {
    const selection = selectScenes(scenes.map((s) => ({ id: s.id, index: s.index, duration: s.end - s.start, triggers: s.triggers })), settings.density);
    chosen = selection.chosen;
    for (const s of selection.skipped) result.skipped.push({ id: s.id, reason: REASONS[s.reason] });
  }

  const system = buildSystem(settings);
  const earlier: Array<{ id: string; type: string }> = [...(args.earlier ?? [])];
  const batches: string[][] = [];
  for (let i = 0; i < chosen.length; i += DIRECTOR_BATCH) batches.push(chosen.slice(i, i + DIRECTOR_BATCH));

  for (let b = 0; b < batches.length; b++) {
    args.onBatch?.(b + 1, batches.length);
    const batch = (batches[b] as string[]).map((id) => byId.get(id)).filter((s): s is DirectorScene => s !== undefined);
    const icons = new Set<string>();
    for (const scene of batch) for (const name of await args.icons(scene)) if (icons.size < 30) icons.add(name);

    const accepted = new Map<string, Placed | "none">();
    let problems: Record<string, string> = {};
    let pending = batch;
    try {
      for (let attempt = 0; attempt < 2 && pending.length > 0; attempt++) {
        const prompt = buildBatchPrompt({ scenes: pending, icons: [...icons], earlier, ...(args.examples ? { examples: args.examples } : {}), ...(attempt > 0 ? { problems } : {}) });
        const text = await call(system, prompt);
        const parsed = parseAnswer(text, pending.map((s) => s.id));
        const failing: DirectorScene[] = [];
        problems = {};
        if (!parsed.ok) {
          for (const scene of pending) problems[scene.id] = parsed.error;
          failing.push(...pending);
        } else {
          for (const scene of pending) {
            const entry = parsed.entries.get(scene.id);
            if (!entry || entry.graphic === null) {
              accepted.set(scene.id, "none");
              continue;
            }
            const checked = acceptGraphic(entry.graphic, scene, entry.trigger);
            if (checked.ok) {
              const trigger = scene.triggers[checked.value.trigger];
              accepted.set(scene.id, { sceneId: scene.id, spec: checked.value.spec, start: checked.value.window.start, duration: checked.value.window.duration, source: "ai", trigger: trigger?.kind ?? null, repairs: checked.value.repairs });
            } else {
              problems[scene.id] = checked.problems;
              failing.push(scene);
            }
          }
        }
        pending = failing;
      }
    } catch (error) {
      if (isCancelled(error)) throw error;
      result.failed = { batch: b + 1, error };
      args.onPlaced?.(result.placed);
      return result;
    }

    for (const scene of batch) {
      const got = accepted.get(scene.id);
      if (got && got !== "none") {
        result.placed.push(got);
        earlier.push({ id: scene.id, type: primaryType(got.spec) });
      } else if (got === "none") {
        result.skipped.push({ id: scene.id, reason: "the AI saw nothing worth a graphic" });
      } else {
        const safe = fallbackFor(scene);
        if (safe) {
          result.placed.push(safe);
          earlier.push({ id: scene.id, type: primaryType(safe.spec) });
        } else result.skipped.push({ id: scene.id, reason: "the AI's graphic could not be used and nothing simple fits" });
      }
    }
    args.onPlaced?.(result.placed);
  }
  result.placed.sort((a, b) => a.start - b.start);
  return result;
}
