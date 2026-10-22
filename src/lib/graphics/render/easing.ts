import type { EASINGS } from "../spec/schema.ts";

export type EasingName = (typeof EASINGS)[number];

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

const C1 = 1.70158;
const C3 = C1 + 1;

/** All easings map 0 to 0 and 1 to 1 (spring and easeOutBack overshoot in between). */
export function ease(name: EasingName, x: number): number {
  const t = clamp01(x);
  switch (name) {
    case "linear":
      return t;
    case "easeOut":
      return 1 - Math.pow(1 - t, 3);
    case "easeInOut":
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case "easeOutBack":
      return 1 + C3 * Math.pow(t - 1, 3) + C1 * Math.pow(t - 1, 2);
    case "easeOutExpo":
      return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
    case "spring": {
      if (t >= 1) return 1;
      // Damped oscillation, deterministic, settles to 1 (the last 0.5 % is snapped to 1 at t = 1).
      return 1 - Math.exp(-6 * t) * Math.cos(10 * t);
    }
  }
}
