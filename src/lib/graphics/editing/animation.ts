import { ENTER_PRESETS, EXIT_PRESETS, type Layer } from "../spec/schema.ts";
import { repairSpec } from "../spec/index.ts";
import type { GraphicSpec } from "../spec/schema.ts";
import type { EditResult } from "./fields.ts";

/** Layers that fill the whole frame (dimming plates, particles) keep their own animation. */
const isMain = (layer: Layer): boolean => layer.type !== "particles" && layer.box.w * layer.box.h < 0.85;

/** Gives every main layer of the graphic this entrance (its duration and delay stay as they are). */
export function setEnter(spec: GraphicSpec, preset: string): EditResult {
  if (!(ENTER_PRESETS as readonly string[]).includes(preset)) return { ok: false, error: "That entrance is not valid." };
  const layers = spec.layers.map((l) => (isMain(l) ? { ...l, enter: { duration: 0.4, delay: 0, easing: "easeOut", ...l.enter, preset } } : l));
  const made = repairSpec({ ...spec, layers });
  return made.ok ? { ok: true, spec: made.spec } : { ok: false, error: "That entrance is not valid." };
}

/** Gives every main layer of the graphic this exit. */
export function setExit(spec: GraphicSpec, preset: string): EditResult {
  if (!(EXIT_PRESETS as readonly string[]).includes(preset)) return { ok: false, error: "That exit is not valid." };
  const layers = spec.layers.map((l) => (isMain(l) ? { ...l, exit: { duration: 0.3, easing: "easeInOut", ...l.exit, preset } } : l));
  const made = repairSpec({ ...spec, layers });
  return made.ok ? { ok: true, spec: made.spec } : { ok: false, error: "That exit is not valid." };
}

/** The entrance and exit of the first main layer (what the form shows). */
export function animationOf(spec: GraphicSpec): { enter: string; exit: string } {
  const main = spec.layers.find(isMain);
  return { enter: main?.enter?.preset ?? "", exit: main?.exit?.preset ?? "" };
}
