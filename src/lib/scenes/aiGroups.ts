import { generateText, type TextAnswer } from "../ai.ts";
import { AI_SYSTEM_INSTRUCTION, aiPrompt, parseAiGroups } from "./ai.ts";

/** Runs one request as a background job (the caller supplies the job wrapper). */
export type RunRequest = (start: (jobId: string) => Promise<TextAnswer>) => Promise<TextAnswer>;

/**
 * Asks Gemini to group the sentences into visual scenes. An answer that is not valid is asked
 * for once more. Returns null when both answers were unusable, so the caller can fall back to
 * "per seconds" with 5 s.
 */
export async function groupSentencesWithAi(sentences: readonly string[], run: RunRequest): Promise<[number, number][] | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const answer = await run((jobId) => generateText(aiPrompt(sentences), AI_SYSTEM_INSTRUCTION, true, jobId));
    const groups = parseAiGroups(answer.text, sentences.length);
    if (groups) return groups;
  }
  return null;
}
