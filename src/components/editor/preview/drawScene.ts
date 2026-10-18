import { containTarget, coverSource, kenBurnsAt, resolveMotion } from "../../../lib/editor/motion";
import { transitionFrame, type TransitionKind } from "../../../lib/editor/transitions";
import type { MediaKind, Placeholder, SceneOverride } from "../../../types";
import { isReady, sizeOf, type Element } from "./mediaCache";

/** Everything needed to draw one scene. `element` is null when the scene has no media. */
export interface Layer {
  element: Element | null;
  kind: MediaKind;
  override: SceneOverride;
  /** The scene number (1, 2, 3...). */
  number: number;
  start: number;
  duration: number;
}

export interface Placement {
  alpha: number;
  /** Offset as a fraction of the frame width. */
  x: number;
  scale: number;
}

export const FULL: Placement = { alpha: 1, x: 0, scale: 1 };

function canBlur(ctx: CanvasRenderingContext2D): boolean {
  return "filter" in ctx;
}

/** Draws a picture or clip so that it fills the frame, with the Ken Burns move for pictures. */
function drawMedia(ctx: CanvasRenderingContext2D, w: number, h: number, layer: Layer, time: number, place: Placement): void {
  const element = layer.element;
  if (!element || !isReady(element)) return;
  const size = sizeOf(element);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, place.alpha));
  ctx.translate(w / 2 + place.x * w, h / 2);
  ctx.scale(place.scale, place.scale);

  if (layer.kind === "image") {
    const progress = layer.duration > 0 ? (time - layer.start) / layer.duration : 0;
    const motion = kenBurnsAt(resolveMotion(layer.override.kenBurns, layer.number), progress);
    ctx.translate(motion.x * w, motion.y * h);
    ctx.scale(motion.scale, motion.scale);
    const source = coverSource(size.width, size.height, w, h);
    ctx.drawImage(element, source.x, source.y, source.width, source.height, -w / 2, -h / 2, w, h);
  } else if (layer.override.videoFit === "blur") {
    const source = coverSource(size.width, size.height, w, h);
    if (canBlur(ctx)) ctx.filter = "blur(24px)";
    ctx.drawImage(element, source.x, source.y, source.width, source.height, -w / 2 - 20, -h / 2 - 20, w + 40, h + 40);
    ctx.filter = "none";
    const target = containTarget(size.width, size.height, w, h);
    ctx.drawImage(element, target.x - w / 2, target.y - h / 2, target.width, target.height);
  } else {
    const source = coverSource(size.width, size.height, w, h);
    ctx.drawImage(element, source.x, source.y, source.width, source.height, -w / 2, -h / 2, w, h);
  }
  ctx.restore();
}

/** What to show for a scene without media: the previous scene held, blurred, or black. */
function drawPlaceholder(ctx: CanvasRenderingContext2D, w: number, h: number, kind: Placeholder, before: Layer | null, time: number): void {
  if (kind === "black" || !before?.element) return;
  if (kind === "blur" && canBlur(ctx)) {
    ctx.save();
    ctx.filter = "blur(28px)";
    drawMedia(ctx, w, h, before, before.start + before.duration, { alpha: 1, x: 0, scale: 1.1 });
    ctx.restore();
    return;
  }
  drawMedia(ctx, w, h, before, before.start + before.duration, FULL);
  void time;
}

export interface FrameInput {
  current: Layer;
  /** The scene before (for the transition), and the nearest earlier scene that has media (for "hold"). */
  previous: Layer | null;
  lastWithMedia: Layer | null;
  transition: TransitionKind;
  /** Seconds the transition lasts (0 for none). */
  transitionSeconds: number;
  placeholder: Placeholder;
  time: number;
}

/** Draws the whole frame for one moment: the scene, and the transition from the scene before it. */
export function drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, input: FrameInput): void {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  const { current, previous, time } = input;
  const into = time - current.start;
  const inTransition = previous !== null && input.transitionSeconds > 0 && into >= 0 && into < input.transitionSeconds;

  const drawScene = (layer: Layer, place: Placement, at: number, hold: Layer | null) => {
    if (layer.element) drawMedia(ctx, w, h, layer, at, place);
    else {
      ctx.save();
      ctx.globalAlpha = place.alpha;
      ctx.translate(place.x * w, 0);
      drawPlaceholder(ctx, w, h, input.placeholder, hold, at);
      ctx.restore();
    }
  };

  if (!inTransition || previous === null) {
    drawScene(current, FULL, time, input.lastWithMedia);
    return;
  }
  const frame = transitionFrame(input.transition, into / input.transitionSeconds);
  drawScene(previous, frame.outgoing, previous.start + previous.duration, input.lastWithMedia);
  if (frame.black > 0) {
    ctx.fillStyle = `rgba(0,0,0,${frame.black})`;
    ctx.fillRect(0, 0, w, h);
  }
  drawScene(current, frame.incoming, time, previous);
}
