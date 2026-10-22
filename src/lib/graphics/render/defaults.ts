import type { Layer } from "../spec/schema.ts";
import type { Theme } from "./theme.ts";

/**
 * The layer with the brand kit's entrance and exit filled in where the spec has none.
 * A layer that says "none" keeps it. Without kit animations (the default theme) the layer is returned as it is.
 */
export function withThemeDefaults(layer: Layer, theme: Theme): Layer {
  const enter = layer.enter === undefined && theme.enter !== undefined && theme.enter.preset !== "none";
  const exit = layer.exit === undefined && theme.exit !== undefined && theme.exit.preset !== "none";
  if (!enter && !exit) return layer;
  const next = { ...layer } as Layer;
  if (enter && theme.enter) next.enter = { preset: theme.enter.preset as NonNullable<Layer["enter"]>["preset"], duration: theme.enter.duration, delay: 0, easing: theme.enter.easing };
  if (exit && theme.exit) next.exit = { preset: theme.exit.preset as NonNullable<Layer["exit"]>["preset"], duration: theme.exit.duration, easing: theme.exit.easing };
  return next;
}
