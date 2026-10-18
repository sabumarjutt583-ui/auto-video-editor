import type { CaptionPreset, CaptionStyle } from "../../types/editor.ts";

export interface PresetInfo {
  id: CaptionPreset;
  label: string;
  hint: string;
  /** What this preset changes when it is picked. */
  style: Partial<CaptionStyle>;
}

export const PRESETS: readonly PresetInfo[] = [
  { id: "clean", label: "Clean Bottom", hint: "Plain text with an outline at the bottom.", style: { fontSize: 5, outline: 3, shadow: 1, position: "bottom" } },
  { id: "highlight", label: "Word Highlight", hint: "The word being spoken changes color.", style: { fontSize: 5.2, outline: 3, shadow: 1, position: "bottom" } },
  { id: "pop", label: "Pop Word", hint: "One or two words at a time, popping in.", style: { fontSize: 8, outline: 4, shadow: 2, position: "middle" } },
  { id: "boxed", label: "Boxed", hint: "Text on a see-through dark box.", style: { fontSize: 4.8, outline: 0, shadow: 0, position: "bottom" } },
  { id: "documentary", label: "Documentary", hint: "Small text in the lower left corner.", style: { fontSize: 3.6, outline: 2, shadow: 1, position: "bottom" } },
  { id: "none", label: "None", hint: "No captions in the video.", style: {} },
];

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  preset: "highlight",
  font: "auto",
  fontSize: 5.2,
  primary: "#FFFFFF",
  highlight: "#FFD400",
  outline: 3,
  shadow: 1,
  position: "bottom",
  uppercase: false,
};

/** The style after picking a preset: its own size, outline and position; the user's colors and font stay. */
export function applyPreset(style: CaptionStyle, preset: CaptionPreset): CaptionStyle {
  const info = PRESETS.find((p) => p.id === preset);
  return { ...style, ...(info?.style ?? {}), preset };
}
