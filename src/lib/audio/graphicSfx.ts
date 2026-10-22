import type { Layer } from "../graphics/spec/schema.ts";
import type { MotionGraphic } from "../../types/editor.ts";
import type { SfxCategory, SfxCue, SfxIntensity, SfxSound } from "../../types/editor.ts";

/** Sounds for motion graphics (phase 11): a soft pop or whoosh when one comes in, light ticks for a counter, a swoosh for a map route. Nothing when it goes out. */
const SCALE: Record<SfxIntensity, number> = { low: 0.6, normal: 0.85, high: 1 };
const MAX_TICKS: Record<SfxIntensity, number> = { low: 3, normal: 6, high: 8 };
const TICK_GAP = 0.25;
/** A graphic sound this close to another automatic effect is dropped (the louder one wins). */
export const NEAR = 0.3;

export interface GraphicSfxInput {
  graphics: readonly Pick<MotionGraphic, "id" | "start" | "duration" | "enabled" | "kind" | "spec">[];
  sounds: readonly SfxSound[];
  intensity: SfxIntensity;
}

const SLIDING = new Set(["slideUp", "slideDown", "slideLeft", "slideRight", "wipe"]);

function sound(sounds: readonly SfxSound[], ids: readonly string[], category: SfxCategory): SfxSound | null {
  for (const id of ids) { const s = sounds.find((x) => x.id === id); if (s) return s; }
  return sounds.find((s) => s.category === category) ?? null;
}

/** The first layer that is not a full-screen decoration decides the entrance sound. */
function mainLayer(layers: readonly Layer[]): Layer | undefined {
  return layers.find((l) => l.type !== "particles" && l.box.w * l.box.h < 0.85) ?? layers[0];
}

/** Cues for the graphics of a project. Pure: same graphics, same cues. Ids are set by `withGraphicSfx`. */
export function planGraphicSfx(input: GraphicSfxInput): Omit<SfxCue, "id">[] {
  const { sounds, intensity } = input;
  const scale = SCALE[intensity];
  const out: Omit<SfxCue, "id">[] = [];
  const push = (s: SfxSound | null, time: number, factor: number) => {
    if (s && time >= 0) out.push({ soundId: s.id, time: Math.round(time * 100) / 100, gain: Math.min(1, s.defaultGain * scale * factor), reason: "graphic" });
  };
  const pop = sound(sounds, ["pop_bubble", "pop_high"], "pop");
  const whoosh = sound(sounds, ["whoosh_soft"], "whoosh");
  const tick = sound(sounds, ["click_tick", "click_soft"], "click");
  const sweep = sound(sounds, ["whoosh_long", "transition_sweep"], "whoosh");

  for (const g of input.graphics) {
    if (!g.enabled || g.kind !== "spec" || !g.spec) continue;
    const layers = g.spec.layers as readonly Layer[];
    const main = mainLayer(layers);
    const preset = main?.enter?.preset ?? "fade";
    if (preset !== "none") push(SLIDING.has(preset) ? whoosh : pop, g.start, SLIDING.has(preset) ? 0.7 : 0.6);

    for (const layer of layers) {
      const begin = g.start + layer.start;
      if (layer.type === "counter") {
        const run = Math.max(0.5, Math.min(2, (layer.duration ?? g.duration - layer.start) - 0.8));
        const n = Math.min(MAX_TICKS[intensity], Math.floor(run / TICK_GAP));
        for (let i = 0; i < n; i++) push(tick, begin + 0.2 + i * TICK_GAP, 0.35);
      } else if (layer.type === "map" && layer.routes.length > 0) {
        push(sweep, begin + 0.3, 0.6);
      }
    }
  }
  return out;
}

/** Joins the rule cues and the graphic cues (a graphic sound next to another automatic effect is dropped) and numbers them again. */
export function withGraphicSfx(rules: readonly SfxCue[], graphic: readonly Omit<SfxCue, "id">[]): SfxCue[] {
  const spot = rules.filter((r) => r.reason !== "ambience");
  const kept = graphic.filter((c) => spot.every((r) => Math.abs(r.time - c.time) >= NEAR));
  return [...rules, ...kept.map((c) => ({ ...c, id: "" }))]
    .sort((a, b) => a.time - b.time)
    .map((cue, i) => ({ ...cue, id: `X${String(i + 1).padStart(3, "0")}` }));
}
