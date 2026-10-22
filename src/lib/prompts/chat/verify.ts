import type { Character, DetailLevel, Location } from "../../../types/project.ts";
import type { StyleProfile } from "../../../types/style.ts";
import { BANNED_NAMES } from "../../styleChecks.ts";
import { DETAIL_WORDS } from "../gemini.ts";

export interface VerifyInput {
  prompt: string;
  style: StyleProfile;
  characters: readonly Character[];
  location: Location | null;
  detail: DetailLevel;
}

export interface Verified {
  prompt: string;
  /** What the app changed, in plain words. */
  fixes: string[];
  /** Things that look off but were not changed. */
  checks: string[];
}

const norm = (text: string) => text.replace(/\s+/g, " ").trim();
const lowerNorm = (text: string) => norm(text).toLowerCase();
const wordsOf = (text: string) => norm(text).split(" ").filter((w) => w !== "");
const bare = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Removes a style lock (or a partly written one) from the end of a prompt. Returns the body and whether anything was cut. */
function stripLock(body: string, lock: string): { body: string; cut: boolean } {
  let text = norm(body);
  const lockText = norm(lock);
  let cut = false;
  const at = text.toLowerCase().lastIndexOf(lockText.toLowerCase());
  if (lockText !== "" && at >= 0) {
    text = norm(text.slice(0, at) + text.slice(at + lockText.length));
    cut = true;
  }
  // Trailing words that belong to the lock (a partly written lock).
  const lockWords = new Set(wordsOf(lockText).map(bare).filter((w) => w !== ""));
  const words = wordsOf(text);
  let end = words.length;
  while (!cut && end > 0 && lockWords.has(bare(words[end - 1] ?? ""))) end -= 1;
  const run = words.length - end;
  if (run >= 2) {
    text = words.slice(0, end).join(" ");
    cut = true;
  }
  return { body: text.replace(/[\s,;:–-]+$/u, ""), cut };
}

const BANNED_PHRASE = /\b(?:with|showing|displaying|bearing|reading|labelled|labeled|captioned)?\s*(?:a |an |the )?(?:text|letters|words|writing|caption|subtitle|logo|watermark|signature)s?\s+(?:saying|reading|that reads|that says|of)\b[^.;]*/gi;

function removeBanned(text: string): { text: string; found: string[] } {
  const found: string[] = [];
  let out = text;
  for (const name of BANNED_NAMES) {
    const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    if (pattern.test(out)) {
      found.push(name);
      out = out.replace(pattern, "");
    }
  }
  if (BANNED_PHRASE.test(out)) {
    found.push("text request");
    out = out.replace(BANNED_PHRASE, "");
  }
  BANNED_PHRASE.lastIndex = 0;
  return { text: norm(out).replace(/\s+([.,;])/g, "$1"), found };
}

/** Checks one finished prompt from the chat and repairs what is safe: style lock last, exact character and location text, banned words. */
export function verifyPrompt(input: VerifyInput): Verified {
  const { style, characters, location, detail } = input;
  const lock = norm(style.style_lock);
  const fixes: string[] = [];
  const checks: string[] = [];

  const stripped = stripLock(input.prompt, lock);
  let body = stripped.body;

  const cleaned = removeBanned(body);
  if (cleaned.found.length > 0) {
    body = cleaned.text;
    fixes.push(`removed banned words (${cleaned.found.join(", ")})`);
  }

  const addons: string[] = [];
  for (const c of characters) {
    const appearance = norm(c.appearance);
    if (appearance !== "" && !lowerNorm(body).includes(appearance.toLowerCase())) {
      addons.push(`${norm(c.name) === "" ? "Character" : norm(c.name)}: ${appearance}`);
      fixes.push(`added the exact looks of ${c.name || "a character"}`);
    }
  }
  const place = location ? norm(location.description) : "";
  if (location && place !== "" && !lowerNorm(body).includes(place.toLowerCase())) {
    addons.push(`Setting: ${place}`);
    fixes.push("added the location text");
  }
  const sentence = (t: string) => (t === "" || /[.!?…。]$/.test(t) ? t : `${t}.`);
  let finalPrompt = [sentence(body), ...addons.map(sentence), lock].filter((p) => p !== "").join(" ");
  if (lock !== "" && !norm(input.prompt).toLowerCase().endsWith(lock.toLowerCase())) {
    fixes.push(stripped.cut ? "replaced a partly written style lock" : "added the style lock");
  }
  finalPrompt = norm(finalPrompt);

  const expected = DETAIL_WORDS[detail] + characters.reduce((n, c) => n + wordsOf(c.appearance).length, 0) + wordsOf(place).length;
  const count = wordsOf(body).length + addons.reduce((n, a) => n + wordsOf(a).length, 0);
  if (count < expected * 0.6 || count > expected * 1.4) checks.push(`length: ${count} words, expected about ${expected}`);

  return { prompt: finalPrompt, fixes: [...new Set(fixes)], checks };
}
