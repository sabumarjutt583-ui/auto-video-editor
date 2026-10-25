import type { StageId } from "../stages.ts";
import { audioStage } from "./audio.ts";
import { castStage } from "./cast.ts";
import type { StageContext } from "./context.ts";
import { imagesStage } from "./images.ts";
import { promptsStage } from "./prompts.ts";
import { renderStage } from "./render.ts";
import { scenesStage } from "./scenes.ts";
import { timingStage } from "./timing.ts";
import { voiceStage } from "./voice.ts";

export type { StageContext } from "./context.ts";

const IMPLS: Record<StageId, (ctx: StageContext) => Promise<void>> = {
  voice: voiceStage,
  timing: timingStage,
  scenes: scenesStage,
  cast: castStage,
  prompts: promptsStage,
  images: imagesStage,
  audio: audioStage,
  render: renderStage,
};

export function runStage(stage: StageId, ctx: StageContext): Promise<void> {
  return IMPLS[stage](ctx);
}
