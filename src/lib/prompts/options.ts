import type { TargetTool } from "../../types/project.ts";

export const TARGET_TOOLS: readonly { value: TargetTool; label: string; hint: string }[] = [
  { value: "generic", label: "Generic", hint: "Plain prompt. The negative words are kept in a separate field (CSV and JSON export)." },
  { value: "midjourney", label: "Midjourney", hint: "Adds --ar and --no at the end of every prompt." },
  { value: "stable_diffusion", label: "Stable Diffusion / Leonardo", hint: "The negative prompt is kept as a separate field (CSV and JSON export)." },
  { value: "flux", label: "Flux", hint: "Negatives are written as positive wishes inside the prompt." },
  { value: "dalle_gemini", label: "DALL-E / Gemini Image", hint: "Negatives are written as positive wishes inside the prompt." },
  { value: "video", label: "Video (Kling / Veo / Runway)", hint: "A short negative line is kept next to the prompt." },
];
