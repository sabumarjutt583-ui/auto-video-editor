import type { ImageJob, NewImageJob, PictureAspect } from "../../types/imagegen.ts";

/** One prompt the person typed or pasted in "Only images" mode. */
export interface TypedPrompt {
  text: string;
  /** The id written before the prompt ("S01_000.0-005.1 | ..." or "P01 | ..."), when there was one. */
  id?: string;
}

/** `S01_000.0-005.1 | prompt` or `P01 | prompt` (what Copy all writes). */
const ID_LINE = /^\s*((?:S\d{2,6}[a-z]?_\d{3,7}\.\d-\d{3,7}\.\d)|(?:P\d{2,6}))\s*\|\s*(.*)$/;
/** The motion line of "Image + Motion" copies: never a picture of its own. */
const MOTION_LINE = /^\s*MOTION\s*:/i;

const HEADING = /^\s*(?:prompt\s*)?(\d+)\s*[:.)\-–—]\s*(.*)$/i;

/**
 * Reads the pasted text. Two shapes are understood:
 *  - blocks that start with `Prompt 1:` (or `1.`, `2)`), where the following lines belong to the same prompt;
 *  - otherwise one prompt per non-empty line.
 * The numbers the person wrote are only used to find where a prompt starts: the pictures are numbered by the app.
 */
export function parsePrompts(text: string): TypedPrompt[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !MOTION_LINE.test(line));
  const withIds = lines.some((line) => ID_LINE.test(line));
  if (withIds) {
    // Every ID line starts a prompt. Other non-empty lines continue the prompt above them.
    const blocks: TypedPrompt[] = [];
    for (const line of lines) {
      const match = ID_LINE.exec(line);
      if (match) blocks.push({ id: match[1] ?? "", text: (match[2] ?? "").trim() });
      else if (blocks.length > 0 && line.trim() !== "") {
        const last = blocks[blocks.length - 1];
        if (last) last.text = `${last.text} ${line.trim()}`.trim();
      }
    }
    return blocks.filter((block) => block.text !== "");
  }
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

/** A pasted id "S01_000.0-005.1" becomes the scene id "S01" and the picture name "S01_000.0-005.1.png"; "P01" becomes "P01.png". */
function jobFromId(id: string): { sceneId: string; fileName: string } {
  return { sceneId: id.split("_")[0] ?? id, fileName: `${id}.png` };
}

/**
 * Jobs for new prompts. Prompts that came with an id keep it (unless the folder already has that id);
 * the others are numbered after the ones already in the folder, so nothing is overwritten.
 */
export function buildFolderJobs(prompts: readonly TypedPrompt[], aspect: PictureAspect, existing: readonly Pick<ImageJob, "id">[]): NewImageJob[] {
  let next = highestNumber(existing) + 1;
  const taken = new Set(existing.map((job) => job.id));
  return prompts.map((prompt) => {
    if (prompt.id) {
      const named = jobFromId(prompt.id);
      if (!taken.has(named.sceneId)) {
        taken.add(named.sceneId);
        return { ...named, prompt: prompt.text, aspect };
      }
    }
    const number = next;
    next += 1;
    taken.add(freeId(number));
    return { sceneId: freeId(number), fileName: freeFileName(number), prompt: prompt.text, aspect };
  });
}
