import { clampBox, type Box } from "./geometry.ts";
import type { Subject } from "./saliency.ts";

export const SUBJECT_SYSTEM = `You look at small pictures from a video and say where the main subject is, so on-screen graphics can be kept away from it.
For each picture give the bounding box of the main subject (a person, an animal, a main object) and of each face. Boxes are fractions of the picture: x and y of the top-left corner, w and h, all between 0 and 1. If a picture has no clear subject (an empty landscape, a texture), answer "subject": null.
Answer only JSON: {"pictures":[{"n":1,"subject":{"x":0.2,"y":0.1,"w":0.4,"h":0.7},"faces":[{"x":0.3,"y":0.12,"w":0.1,"h":0.15}]}]} with one entry per picture, "n" is the number of the picture (1, 2, ...).`;

export function subjectQuestion(labels: readonly string[]): string {
  return `${labels.length} picture${labels.length === 1 ? "" : "s"} follow${labels.length === 1 ? "s" : ""}, in this order: ${labels.map((l, i) => `${i + 1} = ${l}`).join(", ")}. Give the main subject box and the face boxes of each.`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function toBox(value: unknown): Box | null {
  if (!isRecord(value)) return null;
  const { x, y, w, h } = value;
  if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const box = clampBox({ x: x as number, y: y as number, w: w as number, h: h as number });
  return box.w >= 0.02 && box.h >= 0.02 ? box : null;
}

/** The AI's answer -> one subject (the main box, grown to hold the faces) per picture number. Unusable entries are left out. */
export function parseSubjects(text: string, count: number): Map<number, Subject> {
  const out = new Map<number, Subject>();
  let data: unknown;
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    data = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
  } catch {
    return out;
  }
  const list = isRecord(data) && Array.isArray(data.pictures) ? data.pictures : [];
  for (const item of list) {
    if (!isRecord(item) || typeof item.n !== "number" || !Number.isInteger(item.n) || item.n < 1 || item.n > count) continue;
    const boxes: Box[] = [];
    const main = toBox(item.subject);
    if (main) boxes.push(main);
    if (Array.isArray(item.faces)) for (const f of item.faces.slice(0, 8)) { const b = toBox(f); if (b) boxes.push(b); }
    if (boxes.length === 0) continue;
    const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
    out.set(item.n, { box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, confidence: 0.9, source: "ai" });
  }
  return out;
}
