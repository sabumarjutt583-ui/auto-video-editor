/**
 * Batch Flow Studio (the shared tool link only): the frontend mirror of
 * `src-tauri/src/imagegen/flow_batch.rs`. The Rust side is the authority
 * for a batch that is actually sent; these helpers are for the preview the
 * person sees before opening the tool, and for the rename preview.
 *
 * Prompt format (user-corrected): one paragraph per prompt, no blank line
 * inside a prompt, exactly one blank line between prompts. The Gemini
 * Canvas format ("Prompt N: ...") must never be sent to this tool.
 */

export const FLOW_BATCH_URL =
  "https://flow.google.com/shared/tool/74a00ce5-db5d-4ac4-8ae8-96e3e9b3b099";

export const FLOW_BATCH_DEFAULTS = {
  imagesModel: "Nano Banana 2.1",
  videosModel: "Veo 3.1 Flash",
  aspect: "16:9",
  videoSeconds: 4,
  videoResolution: "720p",
  videoCreditsPerVideo: 7,
  maxCreditsPerVideo: 20,
  batchSize: 8,
} as const;

export type FlowBatchGeneration = "images" | "videos";

export function flowBatchExtension(generation: FlowBatchGeneration): "png" | "mp4" {
  return generation === "videos" ? "mp4" : "png";
}

/** One paragraph: internal newlines/whitespace collapsed to single spaces. */
export function oneParagraph(prompt: string): string {
  return prompt.split(/\s+/).filter((word) => word !== "").join(" ");
}

/**
 * Formats prompts for the Batch Prompt Box. Throws (never a half-formatted
 * batch) when the list is empty, any prompt is empty after trimming, or
 * the paragraph count would differ from the prompt count.
 */
export function formatFlowBatchPrompts(prompts: readonly string[]): string {
  if (prompts.length === 0) throw new Error("There are no prompts to send to Batch Flow Studio.");
  const paragraphs = prompts.map((prompt, index) => {
    const paragraph = oneParagraph(prompt);
    if (paragraph === "") throw new Error(`Prompt ${index + 1} is empty after trimming, so it was not sent.`);
    return paragraph;
  });
  const text = paragraphs.join("\n\n");
  const counted = text.split("\n\n").filter((paragraph) => paragraph.trim() !== "").length;
  if (counted !== prompts.length) {
    throw new Error(`The formatted batch has ${counted} paragraphs for ${prompts.length} prompts, so it was not sent.`);
  }
  return text;
}

/**
 * Parses a Flow download name (`S01.png`, `S100.mp4`, `S05b.png`) into
 * [sceneId, extension], or null. `S001.png` parses as its own id `S001`
 * and is NOT rewritten to `S01`; `renameFlowFile` then refuses it when
 * the project scene is `S01`.
 */
export function parseFlowFilename(name: string): [string, string] | null {
  if (name.includes("/") || name.includes("\\")) return null;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const stem = name.slice(0, dot);
  const ext = name.slice(dot + 1);
  if (ext !== "png" && ext !== "mp4") return null;
  const match = /^S(\d{2,6})([a-z]?)$/.exec(stem);
  if (!match) return null;
  return [stem, ext];
}

/** Seconds as `000.0`: one decimal, at least three digits before the dot. */
export function formatFlowSeconds(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return safe.toFixed(1).padStart(5, "0");
}

/**
 * Builds the Auto Editor name for a Flow file from the project scene
 * record (`S01.png` -> `S01_000.0-008.0.png`). Returns null (fail the
 * file, do not guess a scene) when the Flow name's scene id does not
 * match the scene record or the extension does not match the type.
 */
export function renameFlowFile(
  flowName: string,
  sceneId: string,
  start: number,
  end: number,
  generation: FlowBatchGeneration,
): string | null {
  const parsed = parseFlowFilename(flowName);
  if (!parsed || parsed[0] !== sceneId || parsed[1] !== flowBatchExtension(generation)) return null;
  return `${sceneId}_${formatFlowSeconds(start)}-${formatFlowSeconds(end)}.${parsed[1]}`;
}

/** Credit guard for a video batch: the per-video cost must not exceed the cap. */
export function checkFlowVideoCredits(videos: number, perVideo: number, maxPerVideo: number): number {
  if (perVideo > maxPerVideo) {
    throw new Error(`One video would cost ${perVideo} credits, over the cap of ${maxPerVideo} credits, so the batch was not started.`);
  }
  return videos * perVideo;
}

/** Veo clips from this tool are 4 seconds: how many a scene needs, rounded up. */
export function flowClipsNeeded(sceneSeconds: number, clipSeconds: number): number {
  if (sceneSeconds <= 0 || clipSeconds === 0) return 0;
  return Math.ceil(sceneSeconds / clipSeconds);
}
