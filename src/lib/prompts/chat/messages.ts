/** The messages sent to a chat: ONE setup message per thread, then batch messages that each start with a reminder block. */

import type { Character, Location, Scene } from "../../../types/project.ts";
import { needsMotion } from "../assemble.ts";
import { DETAIL_WORDS } from "../gemini.ts";
import { storySoFar } from "../batches.ts";
import type { PromptContext } from "../generate.ts";

export const TEXT_ONLY = "This is a text-only writing task. Do not generate, draw or create any images or files. Reply with text only.";
export const SHORT_TEXT_ONLY = "This is a text-only writing task. Reply with text only.";
/** A message must stay below this many characters (the chat page refuses very long text). */
export const MAX_MESSAGE_CHARS = 6000;
export const DEFAULT_BATCH = 20;

export interface CastedScene {
  scene: Scene;
  characters: readonly Character[];
  location: Location | null;
}

export function castOf(scene: Scene, context: PromptContext): CastedScene {
  return {
    scene,
    characters: scene.characterIds.map((id) => context.characters.find((c) => c.id === id)).filter((c): c is Character => c !== undefined),
    location: context.locations.find((l) => l.id === scene.locationId) ?? null,
  };
}

function ratioText(aspect: string): string {
  return aspect === "9:16" ? "portrait 9:16" : aspect === "1:1" ? "square 1:1" : `landscape ${aspect}`;
}

/** Message 1 of a thread. Ends with the single word READY. */
export function buildSetupMessage(context: PromptContext): string {
  const { style, characters, locations, settings, aspect } = context;
  const words = DETAIL_WORDS[settings.detail];
  const profile = [
    ["Name", style.name],
    ["Category", style.category],
    ["Core identity", style.core_identity],
    ["Medium", style.medium],
    ["Lighting", style.lighting],
    ["Color palette", style.color_palette],
    ["Camera", style.camera],
    ["Composition", style.composition],
    ["Texture", style.texture],
    ["Characters", style.characters],
    ["Mood", style.mood],
    ["Never show", style.negative],
    ["Motion rules", style.motion_rules],
    ["Style lock", style.style_lock],
    ["Example description", style.example_prompt],
  ]
    .map(([label, value]) => `- ${label}: ${value}`)
    .join("\n");
  const people = characters.length === 0 ? "(no named characters)" : characters.map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ""}: ${c.appearance}`).join("\n");
  const places = locations.length === 0 ? "(no fixed locations)" : locations.map((l) => `- ${l.name}: ${l.description}`).join("\n");
  const motion = settings.outputType === "image" ? '"motion" only for video scenes, otherwise an empty string.' : '"motion": one camera move plus the subject movement, following the motion rules, ending with the duration in seconds.';
  return [
    TEXT_ONLY,
    "",
    "TASK: I will send you the shots of a video, in batches. For every shot write ONE complete English description for an AI picture tool, based on the narration line of that shot. Keep the story and the look consistent from shot to shot.",
    "",
    "STYLE PROFILE (the look of every shot):",
    profile,
    "",
    "CHARACTER BIBLE (exact appearance texts):",
    people,
    "",
    "LOCATION BIBLE:",
    places,
    "",
    "RULES:",
    `- About ${words} words per description, English, ${ratioText(aspect)}. Target tool: ${settings.tool}.`,
    "- Every description must END with exactly the style lock of the style profile, word for word.",
    "- Include the exact appearance text of every character in the shot (copy it word for word), and the location text when a location is given.",
    "- No text, letters, numbers, logos, brand, artist or studio names in the picture.",
    `- Each shot must visually match its narration line and continue the story. ${motion}`,
    '- Output only JSON inside one ```json code block: [{"id":"S01","prompt":"...","motion":"..."}] with exactly the IDs given, in the same order.',
    "",
    "Reply with the single word READY.",
  ].join("\n");
}

/** The short block that starts EVERY batch message. */
export function buildReminder(batchId: string, context: PromptContext, group: readonly CastedScene[]): string {
  const { style, settings, aspect } = context;
  const seen = new Map<string, string>();
  for (const { characters } of group) for (const c of characters) if (!seen.has(c.id)) seen.set(c.id, `${c.name || c.id}: ${c.appearance}`);
  const cast = seen.size === 0 ? "(no named characters in this batch)" : [...seen.values()].join(" | ");
  return [
    SHORT_TEXT_ONLY,
    `BATCH_ID: ${batchId}`,
    "REMINDER: Follow exactly the same rules, style and output format as in the first message.",
    `- Style: ${style.name}. Every prompt must END with exactly this style lock: "${style.style_lock}"`,
    `- Include the exact appearance text of every character in the scene: ${cast}`,
    `- About ${DETAIL_WORDS[settings.detail]} words per prompt, English, ${ratioText(aspect)}.`,
    "- No text, letters, numbers, logos, brand, artist or studio names in the picture.",
    '- Output only JSON inside one ```json code block: [{"id":"...","prompt":"...","motion":"..."}], exactly these IDs, same order. \'motion\' only for video scenes, else "".',
  ].join("\n");
}

function sceneLine({ scene, characters, location }: CastedScene, context: PromptContext): string {
  const cast = characters.map((c) => c.name || c.id).join(", ") || "none";
  const media = needsMotion(scene, context.settings.outputType) ? "video" : "image";
  const length = scene.duration > 0 ? `${scene.duration.toFixed(1)} s | ` : "";
  return `${scene.id} | ${length}${media} | cast: ${cast} | place: ${location?.name || "unspecified"} | narration: ${scene.text.replace(/\s+/g, " ").trim()}`;
}

/** One batch message: reminder, short story summary, the scene lines. */
export function buildBatchMessage(batchId: string, context: PromptContext, group: readonly Scene[], before: readonly Scene[]): string {
  const casted = group.map((scene) => castOf(scene, context));
  return [buildReminder(batchId, context, casted), `Story so far: ${storySoFar(before)}`, "SCENES:", ...casted.map((c) => sceneLine(c, context))].join("\n");
}

/** Asks again for scenes the answer left out (same thread, reminder block included). */
export function buildMissingMessage(batchId: string, context: PromptContext, missing: readonly Scene[], before: readonly Scene[]): string {
  return buildBatchMessage(batchId, context, missing, before).replace("SCENES:", "These scenes were missing from your last answer. Write only these:\nSCENES:");
}

/** Groups of scenes (at most `size`), each small enough for one message. */
export function planChatGroups(scenes: readonly Scene[], context: PromptContext, all: readonly Scene[], size = DEFAULT_BATCH, maxChars = MAX_MESSAGE_CHARS): Scene[][] {
  const groups: Scene[][] = [];
  let index = 0;
  while (index < scenes.length) {
    let count = Math.min(Math.max(1, size), scenes.length - index);
    const first = scenes[index];
    const before = all.slice(0, Math.max(0, all.findIndex((s) => s.id === first?.id)));
    while (count > 1 && buildBatchMessage("X-B00", context, scenes.slice(index, index + count), before).length > maxChars) count -= 1;
    groups.push(scenes.slice(index, index + count));
    index += count;
  }
  return groups;
}
