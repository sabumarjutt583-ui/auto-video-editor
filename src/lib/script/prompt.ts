/** The question sent to Claude to write a script, and the cleaning of its answer (pure). */

export const MAX_MASTER_PROMPT = 8000;
export const MAX_TOPIC = 2000;

const ENDING = [
  "Write the complete script now.",
  "Answer with the finished script only: the exact words to be spoken, as plain paragraphs.",
  "No title, no headings, no scene numbers, no stage directions, no notes before or after, and no markdown.",
].join(" ");

/** The channel's master prompt, the topic of this video, and the rule for the answer. */
export function buildScriptQuestion(masterPrompt: string, topic: string): string {
  const master = masterPrompt.trim();
  const subject = topic.trim();
  return `${master}\n\nTOPIC OF THIS VIDEO:\n${subject}\n\n${ENDING}`;
}

const INTRO = /^(here(?:'s| is| are)\b|sure[,!. ]|certainly[,!. ]|of course[,!. ]|okay[,!. ]|below is\b)/i;
const OUTRO = /^(let me know\b|i hope\b|feel free\b|would you like\b|want me to\b|note:)/i;

/** Takes the spoken words out of an answer: no markdown, no headings, no "Here is your script:" or closing offers, no stage directions. */
export function cleanScript(answer: string): string {
  let text = answer.replace(/\r\n?/g, "\n").trim();
  const fence = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fence?.[1] !== undefined) text = fence[1];
  const lines = text.split("\n");
  while (lines.length > 0 && (lines[0]?.trim() === "" || INTRO.test(lines[0]?.trim() ?? ""))) lines.shift();
  while (lines.length > 0 && (lines[lines.length - 1]?.trim() === "" || OUTRO.test(lines[lines.length - 1]?.trim() ?? ""))) lines.pop();
  const cleaned = lines
    .filter((line) => !/^\s*#{1,6}\s/.test(line))
    .filter((line) => !/^\s*[-*_]{3,}\s*$/.test(line))
    .filter((line) => !/^\s*[[(][^\])]{1,60}[\])]\s*$/.test(line))
    .map((line) => line.replace(/\*\*|__/g, "").replace(/(^|\s)\*(?=\S)|(?<=\S)\*(?=\s|$)/g, "$1"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned;
}

/** Problems that make a written script unusable, in simple words (empty = fine). */
export function scriptProblem(script: string, minWords = 30): string | null {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return "Claude's answer was empty.";
  if (words < minWords) return `Claude's script is very short (${words} words). Check the master prompt, or write the script again.`;
  return null;
}
