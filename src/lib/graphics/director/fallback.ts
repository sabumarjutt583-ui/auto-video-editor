import { TRIGGER_WEIGHT } from "./detect.ts";
import type { Trigger } from "./types.ts";

const SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", KRW: "₩", INR: "₹", PKR: "Rs ", CNY: "CN¥ " };

const cut = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

function counter(value: number, extra: Record<string, unknown>): Record<string, unknown>[] {
  const big = Math.abs(value) >= 1e6;
  const decimals = big ? (Number.isInteger(value / 1e6) || Math.abs(value) >= 1e9 ? 0 : 1) : Number.isInteger(value) ? 0 : 1;
  return [
    { id: "plate", type: "shape", box: { x: 0.56, y: 0.06, w: 0.38, h: 0.26 }, shape: "roundRect", fill: "secondary", opacity: 0.85, radius: 0.2 },
    { id: "value", type: "counter", box: { x: 0.57, y: 0.08, w: 0.36, h: 0.22 }, from: 0, to: value, format: big ? "compact" : "grouped", decimals, size: 0.16, color: "accent", ...extra },
  ];
}

/**
 * A simple, safe graphic for a trigger, made without the AI (used when the AI's answer cannot be used). Returns the layers of a
 * GraphicSpec, or null for kinds that need the AI to decide what to show (lists, comparisons). The result is still validated.
 */
export function fallbackLayers(trigger: Trigger): Record<string, unknown>[] | null {
  switch (trigger.kind) {
    case "percent":
      return trigger.value === undefined ? null : counter(trigger.value, { suffix: "%", format: "plain", decimals: Number.isInteger(trigger.value) ? 0 : 1 });
    case "money": {
      if (trigger.value === undefined) return null;
      const symbol = SYMBOLS[trigger.currency ?? ""] ?? (trigger.currency ? `${trigger.currency} ` : "");
      return counter(trigger.value, { prefix: symbol });
    }
    case "number":
      return trigger.value === undefined ? null : counter(trigger.value, {});
    case "date":
      return [{ id: "year", type: "text", box: { x: 0.1, y: 0.08, w: 0.8, h: 0.2 }, text: cut(trigger.text, 40), size: 0.12, weight: "bold", maxLines: 1, color: "accent" }];
    case "place": {
      if (!trigger.code) return null;
      return [{
        id: "map", type: "map", box: { x: 0.5, y: 0.06, w: 0.44, h: 0.5 }, region: "world", projection: "naturalEarth",
        countries: trigger.city ? [{ code: trigger.code }] : [{ code: trigger.code, label: cut(trigger.text, 30) }],
        pins: trigger.city && trigger.lat !== undefined && trigger.lon !== undefined ? [{ name: cut(trigger.text, 30), lat: trigger.lat, lon: trigger.lon }] : [],
        routes: [], camera: [{ t: 0, zoom: 1 }, { t: 2.5, zoom: 1.4 }],
      }];
    }
    case "person":
      return [{ id: "name", type: "lowerThird", box: { x: 0.06, y: 0.7, w: 0.5, h: 0.17 }, title: cut(trigger.text, 60), icon: { set: "lucide", name: "user" } }];
    case "quote": {
      const inner = trigger.text.replace(/^[“"«「『‘]\s*/u, "").replace(/\s*[”"»」』’]$/u, "");
      return [{ id: "quote", type: "quoteCard", box: { x: 0.1, y: 0.18, w: 0.8, h: 0.5 }, quote: cut(inner, 200) }];
    }
    default:
      return null;
  }
}

/** The best trigger of a scene that the fallback can draw: the weightiest, the earliest among equals. */
export function bestFallbackTrigger(triggers: readonly Trigger[]): Trigger | null {
  const usable = triggers.filter((t) => fallbackLayers(t) !== null);
  usable.sort((a, b) => TRIGGER_WEIGHT[b.kind] - TRIGGER_WEIGHT[a.kind] || a.time - b.time);
  return usable[0] ?? null;
}
