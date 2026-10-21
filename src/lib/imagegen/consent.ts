import type { ImageGenSettings } from "../../types/imagegen.ts";

/** The notice shown once before the free engine is used (and again when the engine settings change a lot). */
export const CONSENT_TITLE = "Before you use the free engine";

export const CONSENT_POINTS: readonly string[] = [
  "The free engine uses the image tool of Gemini through YOUR OWN Google account. The app opens your own browser and types your prompts for you.",
  "This may be against Google's terms of service. Google can limit your account, ask you to verify it, or suspend it.",
  "We recommend a separate Google account for this. Do not use the account of your YouTube or AdSense channel, or your main Gmail.",
  "If Google asks for a check (captcha, \"unusual activity\", terms), the app will stop and show it to you. It never tries to get around these checks.",
  "You can switch to the API engine at any time. It uses your own API key and Google's official rules.",
];

export const CONSENT_CHECKBOX = "I understand";

/** The free engine may start only after the notice for this version of the engine settings was accepted. */
export function consentGiven(settings: Pick<ImageGenSettings, "consent">, configMajor: number): boolean {
  return settings.consent !== null && settings.consent.configMajor === configMajor;
}

/** The major number of a version such as "2.1". */
export function majorOf(configVersion: string): number {
  const major = Number.parseInt(configVersion.split(".")[0] ?? "", 10);
  return Number.isFinite(major) ? major : 1;
}
