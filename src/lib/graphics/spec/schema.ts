/**
 * GraphicSpec v1: the JSON the AI writes to say WHAT a graphic shows. The renderer (phase 2+) decides HOW it looks.
 * All positions are fractions (0..1) of the video frame, all times are seconds from the start of the graphic.
 * Frame rate is fixed at 30 fps and is not part of the spec.
 */
import { LIMITS, SCHEMA_VERSION } from "./limits.ts";
import {
  FAIL, arr, bool, fail, lit, map, note, num, obj, oneOf, opt, refine, str, variant,
  type Ctx, type Fail, type Infer, type Parser,
} from "./parse.ts";

const COLOR = /^(primary|secondary|accent|text|muted|background|#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?)$/;
const color = opt(str({ max: 10, pattern: COLOR, expects: "must be a colour name (primary, secondary, accent, text, muted, background) or #RRGGBB" }));
const text = (max: number = LIMITS.maxTextChars) => str({ min: 1, max });
const optText = (max: number = LIMITS.maxTextChars) => opt(str({ min: 1, max }));
const unit = (def: number) => num({ min: 0, max: 1, def });
const big = (def?: number) => num({ min: -LIMITS.maxNumber, max: LIMITS.maxNumber, def });

export const ENTER_PRESETS = ["none", "fade", "slideUp", "slideDown", "slideLeft", "slideRight", "scale", "pop", "wipe", "typewriter"] as const;
export const EXIT_PRESETS = ["none", "fade", "slideUp", "slideDown", "slideLeft", "slideRight", "scale", "wipe"] as const;
export const EASINGS = ["linear", "easeOut", "easeInOut", "easeOutBack", "easeOutExpo", "spring"] as const;
export const CHART_KINDS = ["bar", "line", "pie", "donut"] as const;
export const MAP_PROJECTIONS = ["naturalEarth", "mercator", "equirectangular", "orthographic"] as const;
export const MAP_REGIONS = ["world", "europe", "asia", "africa", "northAmerica", "southAmerica", "oceania", "middleEast"] as const;
export const PARTICLE_KINDS = ["confetti", "sparks", "dust", "snow", "bubbles"] as const;
export const LAYER_TYPES = [
  "text", "richText", "image", "icon", "shape", "counter", "chart", "timeline", "map", "lowerThird",
  "quoteCard", "list", "progressBar", "particles", "kineticText", "flag",
] as const;

const box = refine(
  obj({
    x: unit(0.1),
    y: unit(0.1),
    w: num({ min: 0.02, max: 1, def: 0.8 }),
    h: num({ min: 0.02, max: 1, def: 0.2 }),
  }),
  (b, path, ctx) => {
    const EPS = 1e-6;
    if (b.x + b.w <= 1 + EPS && b.y + b.h <= 1 + EPS) return b;
    if (!ctx.repair) return fail(ctx, path, "goes outside the picture (x+w and y+h must be at most 1)");
    note(ctx, path, "went outside the picture and was moved inside");
    const w = Math.min(b.w, 1);
    const h = Math.min(b.h, 1);
    return { x: Math.min(b.x, 1 - w), y: Math.min(b.y, 1 - h), w, h };
  },
);

const animation = obj({
  preset: oneOf(ENTER_PRESETS, "fade"),
  duration: num({ min: 0, max: 3, def: 0.4 }),
  delay: num({ min: 0, max: 10, def: 0 }),
  easing: oneOf(EASINGS, "easeOut"),
});
const exitAnimation = obj({
  preset: oneOf(EXIT_PRESETS, "fade"),
  duration: num({ min: 0, max: 3, def: 0.3 }),
  easing: oneOf(EASINGS, "easeInOut"),
});

/** Fields every layer has (the `type` field is added per layer). */
const base = {
  id: str({ min: 1, max: 40, pattern: /^[A-Za-z0-9_-]+$/, expects: "may only have letters, numbers, _ and -" }),
  box,
  start: num({ min: 0, max: LIMITS.maxDuration, def: 0 }),
  duration: opt(num({ min: LIMITS.minDuration, max: LIMITS.maxDuration })),
  enter: opt(animation),
  exit: opt(exitAnimation),
  opacity: unit(1),
};

const iconRef: Parser<{ set: "lucide" | "tabler"; name: string }> = (value, path, ctx) => {
  const parsed = obj({ set: oneOf(["lucide", "tabler"] as const, "lucide"), name: str({ min: 1, max: 64 }) })(value, path, ctx);
  if (parsed === FAIL) return FAIL;
  return ctx.catalog.hasIcon(parsed.set, parsed.name) ? parsed : fail(ctx, path, `icon "${parsed.set}:${parsed.name}" does not exist`);
};

const countryCode: Parser<string> = (value, path, ctx) => {
  const code = map(str({ min: 2, max: 2, pattern: /^[A-Za-z]{2}$/, expects: "must be a 2-letter country code" }), (s) => s.toUpperCase())(value, path, ctx);
  if (code === FAIL) return FAIL;
  return ctx.catalog.hasCountry(code) ? code : fail(ctx, path, `country code "${code}" is not known`);
};

const latitude = num({ min: -90, max: 90 });
const longitude = num({ min: -180, max: 180 });
const point = obj({ lat: latitude, lon: longitude });

const textLayer = obj({
  ...base, type: lit("text"),
  text: text(),
  size: num({ min: 0.01, max: 0.3, def: 0.06 }),
  weight: oneOf(["regular", "semibold", "bold"] as const, "bold"),
  align: oneOf(["left", "center", "right"] as const, "center"),
  maxLines: num({ min: 1, max: 4, int: true, def: 2 }),
  color,
});
/** Runs are written one after the other with a space between them (the spec trims every text). */
const richTextLayer = obj({
  ...base, type: lit("richText"),
  runs: arr(
    obj({ text: str({ min: 1, max: 80 }), weight: opt(oneOf(["regular", "semibold", "bold"] as const)), color }),
    { min: 1, max: 8 },
  ),
  size: num({ min: 0.01, max: 0.3, def: 0.06 }),
  align: oneOf(["left", "center", "right"] as const, "center"),
  maxLines: num({ min: 1, max: 4, int: true, def: 2 }),
});
/** `src` is a media file of the project or a bundled asset, never a web address or a path that leaves the project. */
const assetPath = str({
  min: 1, max: 200,
  pattern: /^(?!.*\.\.)(?![\\/])[A-Za-z0-9_./ -]+$/,
  expects: "must be a relative file path inside the project (no .., no web address)",
});
const imageLayer = obj({
  ...base, type: lit("image"),
  src: assetPath,
  fit: oneOf(["cover", "contain"] as const, "contain"),
  radius: num({ min: 0, max: 0.5, def: 0 }),
});
const iconLayer = obj({ ...base, type: lit("icon"), icon: iconRef, color });
const shapeLayer = obj({
  ...base, type: lit("shape"),
  shape: oneOf(["rect", "roundRect", "circle", "line"] as const, "roundRect"),
  fill: color,
  stroke: color,
  strokeWidth: num({ min: 0, max: 0.05, def: 0 }),
  radius: num({ min: 0, max: 0.5, def: 0.2 }),
});
const counterLayer = obj({
  ...base, type: lit("counter"),
  from: big(0),
  to: big(),
  decimals: num({ min: 0, max: 4, int: true, def: 0 }),
  prefix: opt(str({ max: 6 })),
  suffix: opt(str({ max: 12 })),
  format: oneOf(["plain", "grouped", "compact"] as const, "grouped"),
  label: optText(60),
  size: num({ min: 0.02, max: 0.4, def: 0.12 }),
  color,
});
const chartLayer = obj({
  ...base, type: lit("chart"),
  kind: oneOf(CHART_KINDS, "bar"),
  title: optText(60),
  unit: opt(str({ max: 12 })),
  rows: arr(obj({ label: text(30), value: big() }), { min: 1, max: LIMITS.maxChartRows }),
  highlight: opt(num({ min: 0, max: LIMITS.maxChartRows - 1, int: true })),
});
const timelineLayer = obj({
  ...base, type: lit("timeline"),
  orientation: oneOf(["horizontal", "vertical"] as const, "horizontal"),
  events: arr(obj({ label: text(40), date: opt(str({ min: 1, max: 20 })) }), { min: 2, max: LIMITS.maxTimelineEvents }),
});
const mapLayer = refine(
  obj({
    ...base, type: lit("map"),
    region: oneOf(MAP_REGIONS, "world"),
    projection: oneOf(MAP_PROJECTIONS, "naturalEarth"),
    countries: arr(obj({ code: countryCode, label: optText(30) }), { min: 0, max: LIMITS.maxCountries, def: true }),
    pins: arr(obj({ name: text(30), lat: latitude, lon: longitude }), { min: 0, max: LIMITS.maxPins, def: true }),
    routes: arr(obj({ from: point, to: point }), { min: 0, max: LIMITS.maxRoutes, def: true }),
    /** Camera moves: at second `t` the view has this zoom (1 = the whole region) and pan (in box widths/heights). Smooth in between. */
    camera: arr(
      obj({ t: num({ min: 0, max: LIMITS.maxDuration }), zoom: num({ min: 0.5, max: 8, def: 1 }), panX: num({ min: -2, max: 2, def: 0 }), panY: num({ min: -2, max: 2, def: 0 }) }),
      { min: 0, max: LIMITS.maxCameraKeys, def: true },
    ),
  }),
  (layer, path, ctx) =>
    layer.countries.length + layer.pins.length + layer.routes.length > 0 ? layer : fail(ctx, path, "a map needs at least one country, pin or route"),
);
const lowerThirdLayer = obj({
  ...base, type: lit("lowerThird"),
  title: text(60),
  subtitle: optText(80),
  icon: opt(iconRef),
});
const quoteLayer = obj({
  ...base, type: lit("quoteCard"),
  quote: text(200),
  author: optText(60),
});
const listLayer = obj({
  ...base, type: lit("list"),
  style: oneOf(["bullets", "numbered", "checks"] as const, "bullets"),
  items: arr(obj({ text: text(60), icon: opt(iconRef) }), { min: 1, max: LIMITS.maxListItems }),
});
const progressLayer = obj({
  ...base, type: lit("progressBar"),
  from: unit(0),
  to: num({ min: 0, max: 1 }),
  label: optText(40),
  showPercent: bool(true),
  color,
});
const particlesLayer = obj({
  ...base, type: lit("particles"),
  kind: oneOf(PARTICLE_KINDS, "dust"),
  count: num({ min: 1, max: LIMITS.maxParticles, int: true, def: 60 }),
  color,
});
const kineticLayer = obj({
  ...base, type: lit("kineticText"),
  words: arr(str({ min: 1, max: 30 }), { min: 1, max: LIMITS.maxKineticWords }),
  style: oneOf(["pop", "slide", "highlight"] as const, "pop"),
  size: num({ min: 0.02, max: 0.3, def: 0.09 }),
  color,
});
const flagLayer = obj({
  ...base, type: lit("flag"),
  country: countryCode,
  shape: oneOf(["rect", "circle"] as const, "rect"),
  label: optText(30),
});

export const layerParser = variant("type", {
  text: textLayer, richText: richTextLayer, image: imageLayer, icon: iconLayer, shape: shapeLayer, counter: counterLayer, chart: chartLayer,
  timeline: timelineLayer, map: mapLayer, lowerThird: lowerThirdLayer, quoteCard: quoteLayer, list: listLayer,
  progressBar: progressLayer, particles: particlesLayer, kineticText: kineticLayer, flag: flagLayer,
});
export type Layer = Infer<typeof layerParser>;
export type LayerType = Layer["type"];

const EPS = 1e-6;

/** Cross-layer rules: unique ids, and every layer lives inside the graphic's time. */
function checkLayers(spec: { duration: number; layers: Layer[] }, path: string, ctx: Ctx): Layer[] | Fail {
  const seen = new Set<string>();
  const out: Layer[] = [];
  for (let i = 0; i < spec.layers.length; i++) {
    let layer = spec.layers[i];
    if (!layer) continue;
    const here = `${path}.layers[${i}]`;
    if (seen.has(layer.id)) {
      if (!ctx.repair) return fail(ctx, `${here}.id`, `"${layer.id}" is used twice`);
      let n = 2;
      while (seen.has(`${layer.id}-${n}`)) n++;
      note(ctx, `${here}.id`, `"${layer.id}" was used twice and was renamed`);
      layer = { ...layer, id: `${layer.id}-${n}`.slice(0, 40) };
    }
    seen.add(layer.id);
    if (layer.start >= spec.duration - EPS) {
      if (!ctx.repair) return fail(ctx, `${here}.start`, "starts after the graphic has ended");
      note(ctx, here, "started after the graphic ended and was removed");
      continue;
    }
    const length = layer.duration ?? spec.duration - layer.start;
    if (layer.start + length > spec.duration + EPS) {
      if (!ctx.repair) return fail(ctx, `${here}.duration`, "ends after the graphic has ended");
      const fixed = Math.max(LIMITS.minDuration, spec.duration - layer.start);
      note(ctx, `${here}.duration`, `was shortened to ${fixed.toFixed(2)} s to fit`);
      layer = { ...layer, duration: Math.min(fixed, spec.duration - layer.start) };
    }
    out.push(layer);
  }
  if (out.length === 0) return fail(ctx, `${path}.layers`, "needs at least one layer");
  return out;
}

const specShape = obj({
  schemaVersion: lit(SCHEMA_VERSION),
  id: str({ min: 1, max: 40, pattern: /^[A-Za-z0-9_-]+$/, expects: "may only have letters, numbers, _ and -" }),
  name: optText(60),
  duration: num({ min: LIMITS.minDuration, max: LIMITS.maxDuration }),
  seed: num({ min: 0, max: 2147483647, int: true, def: 1 }),
  brand: str({ min: 1, max: 40, pattern: /^[A-Za-z0-9_-]+$/, def: "default" }),
  layers: arr(layerParser, { min: 1, max: LIMITS.maxLayers }),
});

export const specParser: Parser<Infer<typeof specShape>> = (value, path, ctx) => {
  const spec = specShape(value, path, ctx);
  if (spec === FAIL) return FAIL;
  const layers = checkLayers(spec, path, ctx);
  return layers === FAIL ? FAIL : { ...spec, layers };
};

export type GraphicSpec = Infer<typeof specParser>;
