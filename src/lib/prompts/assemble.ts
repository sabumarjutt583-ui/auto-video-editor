import type { AspectRatio } from "../../types/settings.ts";
import type { Character, Location, Scene, TargetTool } from "../../types/project.ts";
import type { StyleProfile } from "../../types/style.ts";
import { positiveNegatives, shortNegativeLine, splitNegatives } from "./negatives.ts";

export interface AssembleInput {
  /** The English scene description written by the AI. */
  description: string;
  characters: readonly Character[];
  location: Location | null;
  style: StyleProfile;
  aspect: AspectRatio;
  tool: TargetTool;
}

export interface AssembledPrompt {
  prompt: string;
  /** The negative that goes with the prompt (a separate field for Stable Diffusion, a --no list for Midjourney...). */
  negative: string;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return trimmed === "" || /[.!?…。]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Layer 3, done by code and not by the AI: description + the exact appearance text of every
 * character in the scene + the location text + the aspect ratio + the style lock (always last).
 */
export function assemblePrompt(input: AssembleInput): AssembledPrompt {
  const { description, characters, location, style, aspect, tool } = input;
  const negatives = splitNegatives(style.negative);

  const body: string[] = [sentence(description)];
  for (const character of characters) {
    const appearance = character.appearance.trim();
    if (appearance !== "") body.push(`${character.name.trim() === "" ? "Character" : character.name.trim()}: ${appearance}`);
  }
  if (location && location.description.trim() !== "") body.push(`Setting: ${location.description.trim()}`);

  const lock = style.style_lock.trim();
  const join = (parts: string[]) => parts.filter((part) => part !== "").join(" ");

  switch (tool) {
    case "midjourney": {
      const prompt = `${join([...body, lock])} --ar ${aspect}${negatives.length > 0 ? ` --no ${negatives.join(", ")}` : ""}`;
      return { prompt, negative: negatives.join(", ") };
    }
    case "stable_diffusion":
      return { prompt: join([...body, `Aspect ratio ${aspect}.`, lock]), negative: negatives.join(", ") };
    case "flux":
    case "dalle_gemini":
      return { prompt: join([...body, positiveNegatives(negatives), `Aspect ratio ${aspect}.`, lock]), negative: "" };
    case "video": {
      const line = shortNegativeLine(negatives);
      return { prompt: join([...body, `Aspect ratio ${aspect}.`, lock]), negative: line };
    }
    case "generic":
    default:
      return { prompt: join([...body, `Aspect ratio ${aspect}.`, lock]), negative: negatives.join(", ") };
  }
}

/** Adds "Duration: N seconds." when the AI did not say how long the motion lasts. */
export function finishMotion(motion: string, durationSeconds: number): string {
  const text = motion.trim();
  if (text === "") return "";
  if (/\bseconds?\b|\b\d+\s?s\b/i.test(text)) return text;
  if (!(durationSeconds > 0)) return sentence(text);
  return `${sentence(text)} Duration: ${Math.max(1, Math.round(durationSeconds))} seconds.`;
}

/** Whether a scene needs a motion prompt. */
export function needsMotion(scene: Pick<Scene, "mediaType">, outputType: "image" | "video" | "image_motion"): boolean {
  return outputType !== "image" || scene.mediaType === "video";
}
