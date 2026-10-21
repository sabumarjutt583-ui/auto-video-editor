import type { ImageJob, NewImageJob, PictureAspect } from "../../types/imagegen.ts";

/** One prompt the person typed or pasted in "Only images" mode. */
export interface TypedPrompt {
  text: string;
}

const HEADING = /^\s*(?:prompt\s*)?(\d+)\s*[:.)\-–—]\s*(.*)$/i;

/**
 * Reads the pasted text. Two shapes are understood:
 *  - blocks that start with `Prompt 1:` (or `1.`, `2)`), where the following lines belong to the same prompt;
 *  - otherwise one prompt per non-empty line.
 * The numbers the person wrote are only used to find where a prompt starts: the pictures are numbered by the app.
 */
export function parsePrompts(text: string): TypedPrompt[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const hasHeadings = lines.some((line) => HEADING.test(line));
  if (!hasHeadings) {
    return lines.map((line) => line.trim()).filter((line) => line !== "").map((line) => ({ text: line }));
  }
  const blocks: string[] = [];
  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push((heading[2] ?? "").trim());
    } else if (blocks.length > 0 && line.trim() !== "") {
      blocks[blocks.length - 1] = `${blocks[blocks.length - 1] ?? ""} ${line.trim()}`.trim();
    }
  }
  return blocks.filter((block) => block !== "").map((block) => ({ text: block }));
}

/** `I001`, `I012`: the job id of the Nth picture (three digits, more when needed). */
export function freeId(number: number): string {
  return `I${String(number).padStart(3, "0")}`;
}

/** `Image 001.png`. */
export function freeFileName(number: number): string {
  return `Image ${String(number).padStart(3, "0")}.png`;
}

/** The highest picture number in a folder's queue (0 when there is none). */
export function highestNumber(jobs: readonly Pick<ImageJob, "id">[]): number {
  let highest = 0;
  for (const job of jobs) {
    const match = /^I(\d{2,6})$/.exec(job.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest;
}

/** Jobs for new prompts. The numbers continue after the ones already in the folder, so nothing is overwritten. */
export function buildFolderJobs(prompts: readonly TypedPrompt[], aspect: PictureAspect, existing: readonly Pick<ImageJob, "id">[]): NewImageJob[] {
  const first = highestNumber(existing) + 1;
  return prompts.map((prompt, index) => ({ sceneId: freeId(first + index), fileName: freeFileName(first + index), prompt: prompt.text, aspect }));
}
