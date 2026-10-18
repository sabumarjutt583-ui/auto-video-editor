// Text helpers shared by the timing parsers, the aligner and the sentence splitter.
// Plain functions with no imports from the app, so they can be unit tested.

/** Scripts written without spaces between words: every character is treated as one word. */
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const LETTER = /[\p{L}\p{N}\p{M}]/u;

export function isNoSpaceChar(character: string): boolean {
  return NO_SPACE_SCRIPT.test(character);
}

/**
 * Splits text into words. Words are separated by spaces; in scripts without spaces (Chinese,
 * Japanese, Thai...) every character is a word. Punctuation stays attached to the word before
 * it (an opening quote or bracket to the word after it), so no text is lost.
 */
export function splitWords(text: string): string[] {
  const tokens: string[] = [];
  for (const chunk of text.split(/\s+/)) {
    if (chunk === "") continue;
    const chunkStart = tokens.length;
    let current = "";
    let prefix = "";
    for (const character of chunk) {
      if (isNoSpaceChar(character)) {
        if (current !== "") tokens.push(current);
        current = "";
        tokens.push(prefix + character);
        prefix = "";
      } else if (PUNCTUATION.test(character) && !LETTER.test(character)) {
        if (current !== "") current += character;
        else if (tokens.length > chunkStart) tokens[tokens.length - 1] += character;
        else prefix += character;
      } else {
        current = (current === "" ? prefix : current) + character;
        prefix = "";
      }
    }
    if (current !== "") tokens.push(current);
    // A chunk of only punctuation or symbols ("-", "&") stays with the word before it.
    if (prefix !== "") {
      if (tokens.length > 0) tokens[tokens.length - 1] += tokens.length > chunkStart ? prefix : ` ${prefix}`;
      else tokens.push(prefix);
    }
  }
  return tokens;
}

function lastLetter(token: string): string {
  const letters = [...token].filter((c) => LETTER.test(c));
  return letters[letters.length - 1] ?? "";
}

function firstLetter(token: string): string {
  return [...token].find((c) => LETTER.test(c)) ?? "";
}

/** Joins words back into text: with spaces, except between two characters of a no-space script. */
export function joinWords(tokens: readonly string[]): string {
  let text = "";
  tokens.forEach((token, index) => {
    if (index > 0) {
      const left = lastLetter(tokens[index - 1] ?? "");
      const right = firstLetter(token);
      const joined = left !== "" && right !== "" && isNoSpaceChar(left) && isNoSpaceChar(right);
      if (!joined) text += " ";
    }
    text += token;
  });
  return text;
}

/** A word reduced to what it sounds like: no case, no punctuation. Used to compare script and speech. */
export function normalizeKey(token: string): string {
  return token.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, "");
}

/** Number of letters or digits in the text (punctuation and spaces do not count). */
export function letterCount(text: string): number {
  return [...text].filter((c) => LETTER.test(c)).length;
}
