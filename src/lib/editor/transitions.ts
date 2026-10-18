import type { Transition, TransitionMode } from "../../types/editor.ts";
import { ease } from "./motion.ts";

export type TransitionKind = Exclude<Transition, "auto">;

/** The longest a transition lasts, in seconds. */
export const TRANSITION_SECONDS = 0.5;

/** The transition into scene number `number` when the choice is "auto": mostly dissolves, with a slide and a zoom for variety. */
export function resolveTransition(choice: Transition, number: number): TransitionKind {
  if (choice !== "auto") return choice;
  if (number <= 1) return "cut";
  if (number % 4 === 2) return "slide";
  if (number % 4 === 0) return "zoom";
  return "dissolve";
}

/**
 * The transition into scene `number`. A choice made for the scene always wins. For "auto" the render
 * setting decides: no transitions, cross-fades, or mostly cuts with a few fades and slides.
 */
export function effectiveTransition(choice: Transition, number: number, mode: TransitionMode): TransitionKind {
  if (choice !== "auto") return choice;
  if (number <= 1 || mode === "cut") return "cut";
  if (mode === "fade") return "dissolve";
  if (number % 5 === 2) return "dissolve";
  if (number % 5 === 4) return "slide";
  return "cut";
}

/** Transitions that move the picture (they get a "whoosh" sound effect). */
export function isMoving(kind: TransitionKind): boolean {
  return kind === "slide" || kind === "zoom" || kind === "whip";
}

/** How long the transition into a scene lasts: never more than a third of the scene or of the one before. */
export function transitionLength(kind: TransitionKind, sceneSeconds: number, previousSeconds: number): number {
  if (kind === "cut") return 0;
  return Math.max(0, Math.min(TRANSITION_SECONDS, sceneSeconds / 3, previousSeconds / 3));
}

/** How to draw the old picture and the new one. Offsets are fractions of the frame width. */
export interface TransitionFrame {
  outgoing: { alpha: number; x: number; scale: number };
  incoming: { alpha: number; x: number; scale: number };
  /** Opacity of a black layer between the two (the "fade" dip). */
  black: number;
}

export function transitionFrame(kind: TransitionKind, progress: number): TransitionFrame {
  const p = Math.min(1, Math.max(0, progress));
  switch (kind) {
    case "cut":
      return { outgoing: { alpha: 0, x: 0, scale: 1 }, incoming: { alpha: 1, x: 0, scale: 1 }, black: 0 };
    case "dissolve":
      return { outgoing: { alpha: 1, x: 0, scale: 1 }, incoming: { alpha: p, x: 0, scale: 1 }, black: 0 };
    case "fade":
      return {
        outgoing: { alpha: p < 0.5 ? 1 : 0, x: 0, scale: 1 },
        incoming: { alpha: p < 0.5 ? 0 : 1, x: 0, scale: 1 },
        black: p < 0.5 ? p * 2 : 2 - p * 2,
      };
    case "slide": {
      const e = ease(p);
      return { outgoing: { alpha: 1, x: -e, scale: 1 }, incoming: { alpha: 1, x: 1 - e, scale: 1 }, black: 0 };
    }
    case "whip": {
      const e = Math.min(1, p * p * p * 2.2);
      return { outgoing: { alpha: 1, x: -e, scale: 1 }, incoming: { alpha: 1, x: 1 - e, scale: 1 }, black: 0 };
    }
    case "zoom":
      return { outgoing: { alpha: 1 - p, x: 0, scale: 1 + 0.3 * p }, incoming: { alpha: p, x: 0, scale: 1.15 - 0.15 * p }, black: 0 };
  }
}
