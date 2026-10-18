/** Gemini grouping of sentences into scenes: the question, and a strict check of the answer. */

export const AI_SYSTEM_INSTRUCTION =
  "You are a film editor. You receive the numbered sentences of a narration. Group consecutive " +
  "sentences into visual scenes: start a new scene where the picture should change (new place, " +
  "new person, new action, new idea). Use every sentence exactly once, in order. " +
  'Answer with JSON only, no other text, in this form: [{"scene":1,"sentences":[1,2]},{"scene":2,"sentences":[3]}]';

/** The numbered sentence list sent to Gemini (numbers start at 1). */
export function aiPrompt(sentences: readonly string[]): string {
  return sentences.map((text, i) => `${i + 1}. ${text.replace(/\s+/g, " ").trim()}`).join("\n");
}

/** Pulls JSON out of an answer that may be wrapped in code fences or extra words. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    // Look for the first complete array or object inside the text.
    const start = trimmed.search(/[[{]/);
    if (start === -1) return null;
    const open = trimmed[start];
    const close = open === "[" ? "]" : "}";
    const end = trimmed.lastIndexOf(close);
    if (end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Checks Gemini's answer. Every sentence must be used once, in order, in groups that follow each
 * other. Returns groups as [first, last] (0-based), or null when the answer cannot be used.
 */
export function parseAiGroups(answer: string, sentenceCount: number): [number, number][] | null {
  let data = extractJson(answer);
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const inner = Object.values(data as Record<string, unknown>).find(Array.isArray);
    data = inner ?? null;
  }
  if (!Array.isArray(data) || data.length === 0) return null;

  const groups: [number, number][] = [];
  let expected = 1;
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) return null;
    const list = (entry as Record<string, unknown>).sentences;
    if (!Array.isArray(list) || list.length === 0) return null;
    const numbers = list.map((n) => (typeof n === "number" ? n : Number.NaN));
    for (const n of numbers) {
      if (n !== expected) return null;
      expected += 1;
    }
    groups.push([(numbers[0] ?? 1) - 1, (numbers[numbers.length - 1] ?? 1) - 1]);
  }
  return expected === sentenceCount + 1 ? groups : null;
}
