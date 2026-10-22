import { FONTS, type FontInfo } from "../../captions/fonts.ts";
import { DEFAULT_THEME } from "../render/theme.ts";
import { detectScript, type Script } from "../render/script.ts";
import type { GraphicSpec } from "../spec/schema.ts";

/** Every text a graphic can show (the renderer picks the font from it). */
export function textsOf(spec: GraphicSpec): string[] {
  const out: string[] = [];
  for (const layer of spec.layers) {
    switch (layer.type) {
      case "text": out.push(layer.text); break;
      case "richText": out.push(layer.runs.map((r) => r.text).join(" ")); break;
      case "counter": if (layer.label) out.push(layer.label); break;
      case "chart": out.push(layer.title ?? "", ...layer.rows.map((r) => r.label)); break;
      case "timeline": out.push(...layer.events.flatMap((e) => [e.label, e.date ?? ""])); break;
      case "lowerThird": out.push(layer.title, layer.subtitle ?? ""); break;
      case "quoteCard": out.push(layer.quote, layer.author ?? ""); break;
      case "list": out.push(...layer.items.map((i) => i.text)); break;
      case "progressBar": if (layer.label) out.push(layer.label); break;
      case "kineticText": out.push(layer.words.join(" ")); break;
      case "flag": if (layer.label) out.push(layer.label); break;
      case "map": out.push(...layer.countries.map((c) => c.label ?? ""), ...layer.pins.map((p) => p.name)); break;
      default: break;
    }
  }
  return out.filter((t) => t !== "");
}

/** The writing systems used by a graphic. */
export function scriptsOf(spec: GraphicSpec): Script[] {
  const scripts = new Set<Script>(["latin"]);
  for (const text of textsOf(spec)) scripts.add(detectScript(text));
  return [...scripts];
}

/** The bundled fonts a graphic needs: the main font of each script it uses, and Noto Sans as the fallback. */
export function fontsFor(spec: GraphicSpec): FontInfo[] {
  const wanted = new Set<string>(["Noto Sans"]);
  for (const script of scriptsOf(spec)) {
    const first = /"([^"]+)"/.exec(DEFAULT_THEME.fonts[script]);
    if (first?.[1]) wanted.add(first[1]);
  }
  return FONTS.filter((font) => wanted.has(font.family));
}
