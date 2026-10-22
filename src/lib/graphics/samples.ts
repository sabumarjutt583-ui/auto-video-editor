import { repairSpec } from "./spec/index.ts";
import type { GraphicSpec } from "./spec/schema.ts";

function sample(raw: unknown): GraphicSpec {
  const result = repairSpec(raw);
  if (!result.ok) throw new Error("A built-in sample graphic is not valid.");
  return result.spec;
}

/** Ready-made graphics to try the preview with (the AI director of phase 7 writes these for real scenes). */
export const SAMPLE_GRAPHICS: ReadonlyArray<{ id: string; label: string; spec: GraphicSpec }> = [
  {
    id: "stat",
    label: "Big number",
    spec: sample({
      schemaVersion: 1, id: "sample-stat", duration: 4,
      layers: [
        { id: "card", type: "shape", box: { x: 0.06, y: 0.08, w: 0.42, h: 0.22 }, shape: "roundRect", fill: "secondary", opacity: 0.85, radius: 0.25, enter: { preset: "slideLeft", duration: 0.5 }, exit: { preset: "fade", duration: 0.4 } },
        { id: "icon", type: "icon", box: { x: 0.08, y: 0.11, w: 0.07, h: 0.16 }, icon: { set: "lucide", name: "users" }, color: "accent", enter: { preset: "pop", duration: 0.5, delay: 0.2 }, exit: { preset: "fade", duration: 0.4 } },
        { id: "label", type: "richText", box: { x: 0.17, y: 0.11, w: 0.29, h: 0.16 }, size: 0.06, align: "left", maxLines: 2, runs: [{ text: "People on Earth:" }, { text: "8 billion", weight: "bold", color: "accent" }], enter: { preset: "typewriter", duration: 0.8, delay: 0.3 }, exit: { preset: "fade", duration: 0.4 } },
      ],
    }),
  },
  {
    id: "headline",
    label: "Headline",
    spec: sample({
      schemaVersion: 1, id: "sample-headline", duration: 3.5,
      layers: [
        { id: "bar", type: "shape", box: { x: 0.08, y: 0.72, w: 0.012, h: 0.14 }, shape: "rect", fill: "accent", enter: { preset: "wipe", duration: 0.4 }, exit: { preset: "fade", duration: 0.3 } },
        { id: "title", type: "text", box: { x: 0.11, y: 0.7, w: 0.8, h: 0.18 }, text: "The price of everything changed in one year", size: 0.075, align: "left", maxLines: 2, enter: { preset: "slideUp", duration: 0.6, delay: 0.15 }, exit: { preset: "slideUp", duration: 0.4 } },
      ],
    }),
  },
  {
    id: "urdu",
    label: "Urdu text",
    spec: sample({
      schemaVersion: 1, id: "sample-urdu", duration: 3,
      layers: [
        { id: "pill", type: "shape", box: { x: 0.2, y: 0.4, w: 0.6, h: 0.2 }, shape: "roundRect", fill: "primary", opacity: 0.9, radius: 0.5, enter: { preset: "scale", duration: 0.5, easing: "easeOutBack" }, exit: { preset: "scale", duration: 0.3 } },
        { id: "text", type: "text", box: { x: 0.24, y: 0.42, w: 0.52, h: 0.16 }, text: "مہنگائی میں اضافہ", size: 0.09, maxLines: 1, enter: { preset: "fade", duration: 0.5, delay: 0.2 }, exit: { preset: "fade", duration: 0.3 } },
      ],
    }),
  },
];
