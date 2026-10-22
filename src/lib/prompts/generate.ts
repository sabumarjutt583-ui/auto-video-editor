import type { AspectRatio } from "../../types/settings.ts";
import type { Character, Location, PromptSettings, Scene } from "../../types/project.ts";
import type { StyleProfile } from "../../types/style.ts";
import { isCancelled } from "../errors.ts";
import { assemblePrompt, finishMotion, needsMotion } from "./assemble.ts";
import { planBatches, storySoFar } from "./batches.ts";
import { buildBatchPrompt, buildSystemInstruction, parseBatch, type BatchScene, type Described } from "./gemini.ts";

export interface PromptContext {
  style: StyleProfile;
  characters: readonly Character[];
  locations: readonly Location[];
  settings: PromptSettings;
  aspect: AspectRatio;
}

/** How many times a batch is asked again after a failure (so up to 3 tries). */
export const BATCH_RETRIES = 2;

function castOf(scene: Scene, context: PromptContext): BatchScene {
  return {
    scene,
    characters: scene.characterIds.map((id) => context.characters.find((c) => c.id === id)).filter((c): c is Character => c !== undefined),
    location: context.locations.find((l) => l.id === scene.locationId) ?? null,
  };
}

/** Builds the final prompt of one scene (layer 3) from the AI's description. */
export function withPrompt(scene: Scene, description: string, motion: string, context: PromptContext): Scene {
  const { characters, location } = castOf(scene, context);
  const assembled = assemblePrompt({ description, characters, location, style: context.style, aspect: context.aspect, tool: context.settings.tool });
  return {
    ...scene,
    description,
    prompt: assembled.prompt,
    negative: assembled.negative,
    motionPrompt: needsMotion(scene, context.settings.outputType) ? finishMotion(motion, scene.duration) : "",
    edited: false,
    status: "prompt_ready",
  };
}

/**
 * Rebuilds the prompts of all scenes that have an AI description, with new options (tool, aspect
 * ratio, style...). No AI call is needed. Rows edited by hand are left alone.
 */
export function reassemble(scenes: readonly Scene[], context: PromptContext): Scene[] {
  return scenes.map((scene) => {
    if (scene.edited || scene.description.trim() === "") return scene;
    return withPrompt(scene, scene.description, scene.motionPrompt, context);
  });
}

export interface GenerateArgs {
  scenes: readonly Scene[];
  /** Scenes to write prompts for. */
  targetIds: ReadonlySet<string>;
  context: PromptContext;
  /** Sends one request to the AI and returns its text. Throws on failure. */
  call: (system: string, prompt: string) => Promise<string>;
  /** false = a call that threw is not repeated (web chat). Default true. */
  resendOnError?: boolean;
  /** Called before each batch with (batch number from 1, total). */
  onBatch?: (number: number, total: number) => void;
  /** Called after every batch with all scenes, so finished batches can be saved. */
  onScenes?: (scenes: Scene[]) => void;
}

export interface GenerateResult {
  scenes: Scene[];
  /** Set when a batch kept failing; the earlier batches are kept. */
  failed: { batch: number; error: unknown } | null;
}

/** Layers 1 to 3: writes prompts in batches of 20, one batch after another. */
export async function generatePrompts(args: GenerateArgs): Promise<GenerateResult> {
  const { targetIds, context, call } = args;
  let scenes = [...args.scenes];
  const targets = scenes.filter((scene) => targetIds.has(scene.id));
  const batches = planBatches(targets);
  const system = buildSystemInstruction({
    style: context.style,
    characters: context.characters,
    locations: context.locations,
    detail: context.settings.detail,
    outputType: context.settings.outputType,
    aspect: context.aspect,
  });

  for (let b = 0; b < batches.length; b += 1) {
    const batch = batches[b] ?? [];
    args.onBatch?.(b + 1, batches.length);
    const firstIndex = scenes.findIndex((scene) => scene.id === batch[0]?.id);
    const prompt = buildBatchPrompt(batch.map((scene) => castOf(scene, context)), storySoFar(scenes.slice(0, Math.max(0, firstIndex))), context.settings.outputType);
    const ids = batch.map((scene) => scene.id);

    let described: Described[] | null = null;
    let lastError: unknown = new Error("The AI answer was not in the expected format.");
    for (let attempt = 0; attempt <= BATCH_RETRIES && !described; attempt += 1) {
      try {
        described = parseBatch(await call(system, prompt), ids);
        if (!described) lastError = new Error("The AI answer was not in the expected format (JSON list with the exact scene ids).");
      } catch (error) {
        if (isCancelled(error)) throw error;
        lastError = error;
        // A web chat may still be generating: a failed call is never sent again by itself.
        if (args.resendOnError === false) break;
      }
    }
    if (!described) return { scenes, failed: { batch: b + 1, error: lastError } };

    const byId = new Map(described.map((item) => [item.id, item]));
    scenes = scenes.map((scene) => {
      const item = byId.get(scene.id);
      return item ? withPrompt(scene, item.scene, item.motion, context) : scene;
    });
    args.onScenes?.(scenes);
  }
  return { scenes, failed: null };
}
