/** Dev-preview identity and clipboard helpers. No browser, network, or Tauri imports. */
import type { ChannelProfile } from "../pipeline/profile.ts";
import { sha256Hex } from "./core/fingerprint.ts";

export interface ScriptPreviewInputs {
  readonly title: string;
  readonly topic: string;
  readonly wordCountText: string;
  readonly script: string;
}

/** A content-based React key. A change unmounts the previous preview so that
 * returning to old inputs does not resurrect an unapproved result.
 * Hashing also avoids placing full channel prompt text into a React key. */
export function scriptPreviewKey(
  profile: Pick<ChannelProfile, "id" | "language" | "script"> | null,
  inputs: ScriptPreviewInputs,
): string {
  return sha256Hex(JSON.stringify([
    profile?.id ?? null,
    profile?.language ?? null,
    profile?.script?.writer ?? null,
    profile?.script?.masterPrompt ?? null,
    profile?.script?.claudeAccountId ?? null,
    inputs.title,
    inputs.topic,
    inputs.wordCountText,
    inputs.script,
  ]));
}

export type PreviewCopyResult = "copied" | "manual";

/** Prefer the secure-context Clipboard API. An injected synchronous fallback
 * can select the correct read-only textarea and try document.execCommand('copy').
 * No successful-copy claim is made if both methods fail. */
export async function copyScriptPreviewText(
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined,
  selectAndCopy: () => boolean,
): Promise<PreviewCopyResult> {
  if (clipboard && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return "copied";
    } catch {
      // In WebView2 clipboard permission/secure-context policies may vary.
    }
  }
  try {
    return selectAndCopy() ? "copied" : "manual";
  } catch {
    return "manual";
  }
}
