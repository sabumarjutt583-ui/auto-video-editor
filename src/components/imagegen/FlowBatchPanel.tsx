import { useState } from "react";

import { openExternalLink } from "../../lib/links";
import { toAppError } from "../../lib/errors";
import { Button } from "../ui";
import { ErrorNotice } from "../ErrorNotice";
import type { AppError } from "../../types";
import type { FlowBatchInfo } from "../../lib/imagegen/api";
import { flowBatchConfig } from "../../lib/imagegen/api";

/**
 * Batch Flow Studio (opt-in, alongside the Gemini Canvas tool, which stays
 * the default): shows the shared tool link, its defaults, and the rules
 * the user set. It does not start a batch by itself: the person opens the
 * shared tool, pastes the paragraph batch the Auto Editor prepares for
 * their project, and downloads the cards in order; the Auto Editor then
 * renames `S01.png` / `S01.mp4` to the timecode name from the scene
 * record. A prompt with no character name will get "Jin Kun" locked in
 * by the Flow tool itself — that is the example project's character, not
 * a character this app sets, so every prompt sent must carry its own
 * character name.
 */
export function FlowBatchPanel() {
  const [info, setInfo] = useState<FlowBatchInfo | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setInfo(await flowBatchConfig());
    } catch (caught) {
      setError(toAppError(caught, "Could not load the Batch Flow Studio settings."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5" aria-label="Batch Flow Studio">
      <h2 className="text-base font-semibold tracking-tight">Batch Flow Studio (optional)</h2>
      <p className="text-sm text-muted">
        The user&apos;s own batch tool inside Google Flow, for images and videos together. The Gemini Canvas tool stays the
        default; this engine is opt-in per batch. Prompts go to it as paragraphs — one paragraph per prompt, one blank line
        between prompts, never &quot;Prompt N:&quot; lines — and its downloads arrive as <code>S01.png</code> /{" "}
        <code>S01.mp4</code>, which the Auto Editor renames from the scene record, e.g.{" "}
        <code>S01_000.0-008.0.png</code>. Veo clips are 4 seconds, so a longer scene needs more than one clip or a loop.
      </p>
      <p className="text-sm text-muted">
        Warning: a prompt with no character name gets &quot;Jin Kun&quot; locked in by the Flow tool itself. That is the
        example project&apos;s character, not one this app sets — always send prompts that carry their own character name.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void openExternalLink("flow_batch")}>
          Open Batch Flow Studio
        </Button>
        <Button onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Show defaults"}
        </Button>
      </div>
      {error && <ErrorNotice error={error} />}
      {info && (
        <ul className="text-sm text-muted">
          <li>Tool: {info.url}</li>
          <li>
            Images: {info.imagesModel}, {info.aspect} · Videos: {info.videosModel}, Text to Video, {info.videoSeconds}s @{" "}
            {info.videoResolution}, {info.videoCreditsPerVideo} credits per video (cap {info.maxCreditsPerVideo})
          </li>
          <li>Batch size: {info.batchSize} at a time · Queue: per-card Download in card order, Download All only in batch order</li>
        </ul>
      )}
    </section>
  );
}
