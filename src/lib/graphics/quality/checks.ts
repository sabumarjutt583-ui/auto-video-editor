import { resolveColor } from "../render/theme.ts";
import { detectScript, type Script } from "../render/script.ts";
import { textsOf } from "../export/fonts.ts";
import { FONT_CHOICES } from "../brand/model.ts";
import { inflate, touches, type Box } from "../placement/geometry.ts";
import { MIN_SCALE, isClear, mainExtent, placeGraphic } from "../placement/solver.ts";
import { repairSpec } from "../spec/index.ts";
import type { GraphicSpec, Layer } from "../spec/schema.ts";
import { LIMITS } from "../spec/limits.ts";
import { contrastRatio, MIN_CONTRAST, mix, readableOn, rgbOf, type RGB } from "./color.ts";
import { familiesOf, missingCharacters } from "./glyphs.ts";
import { readingSeconds } from "./reading.ts";
import type { Check, Found, GraphicItem } from "./types.ts";

/** A graphic ends this long before its scene ends (the next picture arrives). */
const END_MARGIN = 0.1;
const MIN_SECONDS = 1.2;
const EPS = 1e-6;
const r2 = (n: number): number => Math.round(n * 100) / 100;

function withSpec(item: GraphicItem, spec: GraphicSpec | null, patch: Partial<GraphicItem> = {}): GraphicItem | null {
  return spec ? { ...item, ...patch, spec, duration: patch.duration ?? spec.duration } : null;
}

function respec(spec: GraphicSpec, change: Partial<GraphicSpec>, layers?: Layer[]): GraphicSpec | null {
  const made = repairSpec({ ...spec, ...change, layers: layers ?? spec.layers });
  return made.ok ? made.spec : null;
}

/** All the texts of one layer, for reading time. */
function layerTexts(layer: Layer): string[] {
  const probe: GraphicSpec = { schemaVersion: 1, id: "probe", duration: 1, layers: [layer] } as GraphicSpec;
  return textsOf(probe);
}

const layerEnd = (layer: Layer, spec: GraphicSpec): number => layer.start + (layer.duration ?? Math.max(0, spec.duration - layer.start));

// ---------------------------------------------------------------- timing: inside the scene
export const timingCheck: Check = {
  id: "timing",
  run: (item, env) => {
    const scene = env.scene(item.sceneId);
    if (!scene) return [];
    const room = scene.end - END_MARGIN - scene.start;
    const late = item.start + item.duration > scene.end - END_MARGIN + EPS;
    const early = item.start < scene.start - EPS;
    if (!late && !early) return [];
    const message = early ? `Starts ${r2(scene.start - item.start)} s before its scene.` : `Runs ${r2(item.start + item.duration - (scene.end - END_MARGIN))} s past the end of its scene.`;
    if (room < MIN_SECONDS) return [{ message: `${message} The scene is too short for a graphic.`, severity: "error" }];
    return [{
      message, severity: "warning",
      fix: () => {
        const start = Math.min(Math.max(item.start, scene.start), scene.end - END_MARGIN - MIN_SECONDS);
        const duration = r2(Math.min(item.duration, scene.end - END_MARGIN - start));
        return duration >= MIN_SECONDS - EPS ? withSpec(item, respec(item.spec, { duration }), { start: r2(start), duration }) : null;
      },
    }];
  },
};

// ---------------------------------------------------------------- two graphics at the same time
export const overlapCheck: Check = {
  id: "overlap",
  run: (item, _env, all) => {
    const mine = mainExtent(item.spec);
    const found: Found[] = [];
    for (const other of all) {
      if (other.id === item.id || other.start < item.start - EPS || (other.start === item.start && other.id < item.id)) continue;
      if (item.start + item.duration <= other.start + EPS) continue;
      // Two graphics in different places on the screen can be there on purpose; only graphics that cover each other are flagged.
      const theirs = mainExtent(other.spec);
      if (mine && theirs && !touches(mine, theirs)) continue;
      const room = other.start - 0.05 - item.start;
      found.push({
        message: `Shows at the same time as the graphic of ${other.sceneId} and covers it.`, severity: "warning",
        ...(room >= MIN_SECONDS ? { fix: () => withSpec(item, respec(item.spec, { duration: r2(room) }), { duration: r2(room) }) } : {}),
      });
    }
    return found;
  },
};

// ---------------------------------------------------------------- reading time
export const readingCheck: Check = {
  id: "reading",
  run: (item, env) => {
    const scene = env.scene(item.sceneId);
    const latest = scene ? scene.end - END_MARGIN - item.start : item.duration;
    let needed = 0;
    const found: Found[] = [];
    for (const layer of item.spec.layers) {
      const seconds = readingSeconds(layerTexts(layer).join(" "));
      if (seconds <= 0) continue;
      const visible = layerEnd(layer, item.spec) - layer.start;
      if (visible + EPS < seconds) {
        needed = Math.max(needed, layer.start + seconds);
        found.push({ message: `The text of "${layer.id}" is on screen for ${r2(visible)} s but needs ${r2(seconds)} s to read.`, severity: "warning" });
      }
    }
    if (found.length === 0) return [];
    const total = Math.min(needed, latest);
    const canFix = total > item.duration - EPS && total >= needed - EPS;
    const fix = (): GraphicItem | null => {
      const duration = r2(Math.max(item.duration, needed));
      const layers = item.spec.layers.map((l) => {
        const seconds = readingSeconds(layerTexts(l).join(" "));
        return seconds > 0 && l.duration !== undefined && l.duration < seconds ? ({ ...l, duration: r2(seconds) } as Layer) : l;
      });
      return withSpec(item, respec(item.spec, { duration }, layers), { duration });
    };
    return found.map((f) => ({ ...f, ...(canFix ? { fix } : {}) }));
  },
};

// ---------------------------------------------------------------- text fit (cut or shrunk text)
export const fitCheck: Check = {
  id: "fit",
  run: (item, env) => {
    const notes = env.notes(item.spec).filter((n) => n.kind === "truncated");
    if (notes.length === 0) return [];
    const ids = [...new Set(notes.map((n) => n.layerId))];
    return ids.map((id) => ({
      message: `The text of "${id}" is cut off because it does not fit its box.`, severity: "warning" as const,
      fix: () => {
        // Smaller letters in 10 % steps (at most 3 times) until the renderer cuts nothing.
        let spec: GraphicSpec | null = item.spec;
        for (let step = 0; step < 3 && spec; step++) {
          const layers = spec.layers.map((l) => (l.id === id && "size" in l && typeof l.size === "number" ? ({ ...l, size: l.size * 0.9 } as Layer) : l));
          spec = respec(spec, {}, layers);
          if (spec && !env.notes(spec).some((n) => n.kind === "truncated" && n.layerId === id)) return withSpec(item, spec);
        }
        return null;
      },
    }));
  },
};

// ---------------------------------------------------------------- contrast against the real background
const BARE: ReadonlySet<string> = new Set(["text", "richText", "kineticText", "counter"]);

function textColorOf(layer: Layer): string | undefined {
  if (layer.type === "richText") return layer.runs[0]?.color;
  return "color" in layer ? (layer as { color?: string }).color : undefined;
}

/** The colour behind a text layer: a plate of the graphic under it (over the picture), else the picture. */
function backgroundBehind(item: GraphicItem, index: number, env: Parameters<Check["run"]>[1]): RGB | null {
  const layer = item.spec.layers[index] as Layer;
  const picture = env.pictureColor(item, layer.box);
  let colour: RGB | null = picture;
  for (let i = 0; i < index; i++) {
    const below = item.spec.layers[i] as Layer;
    if (below.type !== "shape" || below.shape === "line") continue;
    const covers = below.box.x <= layer.box.x + EPS && below.box.y <= layer.box.y + EPS && below.box.x + below.box.w >= layer.box.x + layer.box.w - EPS && below.box.y + below.box.h >= layer.box.y + layer.box.h - EPS;
    if (!covers) continue;
    const plate = rgbOf(below.fill, env.theme, "background");
    colour = mix(plate, colour ?? plate, below.opacity);
  }
  return colour;
}

export const contrastCheck: Check = {
  id: "contrast",
  run: (item, env) => {
    const found: Found[] = [];
    item.spec.layers.forEach((layer, index) => {
      if (!BARE.has(layer.type)) return;
      if (layerTexts(layer).join("").trim() === "" && layer.type !== "counter") return;
      const background = backgroundBehind(item, index, env);
      if (!background) return;
      const ink = rgbOf(textColorOf(layer), env.theme, "text");
      const ratio = contrastRatio(ink, background);
      if (ratio >= MIN_CONTRAST) return;
      found.push({
        message: `"${layer.id}" has a contrast of ${r2(ratio)}:1 against the picture behind it (at least ${MIN_CONTRAST}:1 is needed).`, severity: "warning",
        fix: () => {
          if (item.spec.layers.length >= LIMITS.maxLayers) return null;
          const plateColor = rgbOf("background", env.theme, "background");
          const behind = mix(plateColor, background, 0.82);
          const wanted = contrastRatio(ink, behind) >= MIN_CONTRAST ? undefined : readableOn(behind);
          const pad = inflate(layer.box, 0.012);
          const plate = {
            type: "shape", id: `plate-${layer.id}`.slice(0, 40), shape: "roundRect", fill: "background", opacity: 0.82, radius: 0.25,
            box: pad, start: layer.start, ...(layer.duration !== undefined ? { duration: layer.duration } : {}),
            ...(layer.enter ? { enter: layer.enter } : {}), ...(layer.exit ? { exit: layer.exit } : {}),
          } as unknown as Layer;
          const layers = item.spec.layers.flatMap((l, i) => {
            if (i !== index) return [l];
            const recoloured = wanted ? ({ ...l, ...(l.type === "richText" ? { runs: l.runs.map((run) => ({ ...run, color: wanted })) } : { color: wanted }) } as Layer) : l;
            return [plate, recoloured];
          });
          const spec = respec(item.spec, {}, layers);
          if (!spec) return null;
          const fixed = spec.layers.findIndex((l) => l.id === layer.id);
          const again = backgroundBehind({ ...item, spec }, fixed, env);
          return again && contrastRatio(rgbOf(textColorOf(spec.layers[fixed] as Layer), env.theme, "text"), again) >= MIN_CONTRAST ? withSpec(item, spec) : null;
        },
      });
    });
    // Cards, lists and charts draw their own plates in the kit colours: the kit itself must read well.
    return found;
  },
};

// ---------------------------------------------------------------- fonts, scripts, glyphs
export const fontCheck: Check = {
  id: "font",
  run: (item, env) => {
    const found: Found[] = [];
    const seen = new Set<Script>();
    for (const text of textsOf(item.spec)) {
      const script = detectScript(text);
      if (seen.has(script)) continue;
      seen.add(script);
      const families = familiesOf(env.theme.fonts[script]);
      const suited = FONT_CHOICES[script];
      if (!families.some((f) => suited.includes(f))) {
        found.push({ message: `The font for ${script} text (${families[0] ?? "none"}) cannot draw this writing system. Pick one of: ${suited.join(", ")}.`, severity: "error" });
      }
    }
    return found;
  },
};

export const glyphCheck: Check = {
  id: "glyph",
  run: (item, env) => {
    const found: Found[] = [];
    for (const text of new Set(textsOf(item.spec))) {
      const families = familiesOf(env.theme.fonts[detectScript(text)]);
      const missing = missingCharacters(text, families, env.hasGlyph);
      if (missing.length > 0) found.push({ message: `The font cannot draw ${missing.slice(0, 6).map((c) => `"${c}"`).join(" ")}${missing.length > 6 ? " and more" : ""} in "${text.slice(0, 30)}", so empty boxes would show.`, severity: "error" });
    }
    return found;
  },
};

// ---------------------------------------------------------------- not over the subject, the captions or the margins
export const placementCheck: Check = {
  id: "placement",
  run: (item, env) => {
    const input = { subjects: env.subjectsFor(item), caption: env.caption, safe: env.safe };
    if (isClear(item.spec, input)) return [];
    return [{
      message: "Covers the subject, the captions or the safe margins.", severity: "warning",
      fix: () => {
        const placed = placeGraphic({ spec: item.spec, ...input });
        return placed.spec && placed.scale >= MIN_SCALE ? withSpec(item, placed.spec) : null;
      },
    }];
  },
};

/** Order matters: timing and placement first (they change the size and the time that the others look at). */
export const CHECKS: readonly Check[] = [timingCheck, placementCheck, fitCheck, readingCheck, contrastCheck, overlapCheck, fontCheck, glyphCheck];

export { resolveColor };
export type { Box };
