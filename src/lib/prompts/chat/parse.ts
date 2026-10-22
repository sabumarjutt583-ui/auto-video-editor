import { extractJson } from "../../scenes/ai.ts";

export interface FullItem {
  id: string;
  prompt: string;
  motion: string;
}

export interface ParsedBatch {
  /** Items for the wanted ids, in the order of the wanted ids (those present). */
  items: FullItem[];
  missing: string[];
  extra: string[];
  /** False when no JSON list could be read at all. */
  readable: boolean;
}

/** Reads Gemini's answer: a JSON list (code block, plain, or with words around it). Wrong order is repaired by id. */
export function parseFullBatch(answer: string, wanted: readonly string[]): ParsedBatch {
  let data = extractJson(answer);
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    data = Object.values(data as Record<string, unknown>).find(Array.isArray) ?? null;
  }
  if (!Array.isArray(data)) return { items: [], missing: [...wanted], extra: [], readable: false };
  const byId = new Map<string, FullItem>();
  const extra: string[] = [];
  for (const entry of data as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const text = [record.prompt, record.scene, record.description].find((v): v is string => typeof v === "string" && v.trim() !== "");
    if (id === "" || text === undefined) continue;
    if (!wanted.includes(id)) {
      extra.push(id);
      continue;
    }
    if (!byId.has(id)) byId.set(id, { id, prompt: text.trim(), motion: typeof record.motion === "string" ? record.motion.trim() : "" });
  }
  const items = wanted.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  return { items, missing: wanted.filter((id) => !byId.has(id)), extra, readable: true };
}

const SOFT = ["encountering an error", "having a hard time fulfilling", "something else instead", "can't help with that", "cannot help with that", "i can't assist", "i'm unable to help"];

/** A generic error / refusal reply (not an answer). Only short replies without JSON count. */
export function isSoftFailureText(text: string): boolean {
  if (text.length > 600 || /```|\[\s*\{/.test(text)) return false;
  const lower = text.toLowerCase();
  return SOFT.some((phrase) => lower.includes(phrase));
}

export function saysReady(text: string): boolean {
  return /\bready\b/i.test(text) && text.length < 400;
}
