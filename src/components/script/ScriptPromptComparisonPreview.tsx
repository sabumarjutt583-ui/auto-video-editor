import { useState } from "react";

import type { ChannelProfile } from "../../lib/pipeline/profile.ts";
import { compareScriptPromptFormats, type ScriptPromptComparisonResult } from "../../lib/script/comparison.ts";
import { Button } from "../ui";

interface Props {
  profile: ChannelProfile | null;
  title: string;
  topic: string;
  wordCountText: string;
  script: string;
}

type Preview = { signature: string; result: ScriptPromptComparisonResult };

/** Dev-build-only, user-triggered preparation. No Tauri invokes, network,
 * browser, project writes, auto-preview or production prompt replacement. */
export function ScriptPromptComparisonPreview({ profile, title, topic, wordCountText, script }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  // A result is visible only for the exact inputs that produced it.
  // No prompt or account details are written to logs or persistent storage.
  const signature = JSON.stringify([
    profile?.id, profile?.language, profile?.script.writer, profile?.script.masterPrompt,
    title, topic, wordCountText, script,
  ]);
  const current = preview?.signature === signature ? preview.result : null;

  if (!import.meta.env.DEV) return null;

  function prepare() {
    const requested = wordCountText.trim() === "" ? null : Number(wordCountText);
    const result = compareScriptPromptFormats(profile, {
      title, topic, script, wordCount: requested,
    }, {
      // This constant is only for non-sending developer previews, never a job ID.
      requestId: "dev-preview-only",
      ...(profile ? { expectedChannelId: profile.id } : {}),
    });
    setPreview({ signature, result });
    setCopyMessage("");
  }

  async function copyPrompt(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage("Copied to clipboard. Nothing was sent.");
    } catch {
      setCopyMessage("Clipboard permission was denied. Select the text and copy it manually.");
    }
  }

  return (
    <section aria-label="Script Prompt Comparison — Preview Only" className="rounded-xl border border-dashed border-line bg-surface-2 p-4">
      <h3 className="text-sm font-semibold">Script Prompt Comparison — Preview Only</h3>
      <p className="mt-1 text-xs text-muted">
        Development mode only. Nothing is submitted to Claude, saved to a project, or sent to a server.
        Click below to compare the current channel and video inputs.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={prepare}>Compare prompts (no sending)</Button>
      </div>
      {preview !== null && current === null && (
        <p role="status" className="mt-2 text-xs text-muted">Inputs changed. Generate another preview to see updated prompts.</p>
      )}
      {current !== null && (
        <div className="mt-4 flex flex-col gap-3">
          <p role="status" className="text-sm font-medium">
            {current.ok ? "Comparison prepared locally — no prompts sent." : "Comparison blocked — invalid or incompatible inputs."}
          </p>
          {current.report.problems.length > 0 && (
            <div role="alert" className="text-sm text-danger">
              <strong>Problems:</strong>
              <ul className="ml-5 list-disc">
                {current.report.problems.map((finding, index) => (
                  <li key={index}>{finding.field ? finding.field + ": " : ""}{finding.message}</li>
                ))}
              </ul>
            </div>
          )}
          {current.ok && (
            <>
              <dl className="grid gap-2 text-xs sm:grid-cols-2">
                <div><dt className="text-muted">Channel</dt><dd>{current.report.channelId}</dd></div>
                <div><dt className="text-muted">Request</dt><dd>{current.report.requestId}</dd></div>
                <div><dt className="text-muted">Language</dt><dd>{current.report.language || "Not specified"}</dd></div>
                <div><dt className="text-muted">Target words</dt><dd>{current.report.requestedWords ?? "From master prompt"}</dd></div>
                <div><dt className="text-muted">Master preserved</dt><dd>{current.report.masterPromptPreserved ? "Yes" : "No"}</dd></div>
                <div><dt className="text-muted">Master digest</dt><dd className="break-all">{current.report.masterPromptDigest}</dd></div>
                <div><dt className="text-muted">Title</dt><dd>{current.report.title || "(none)"}</dd></div>
                <div><dt className="text-muted">Topic</dt><dd>{current.report.topic || "(none)"}</dd></div>
              </dl>
              <div className="text-xs">
                <strong>Expected differences (not errors):</strong>
                <ul className="ml-5 list-disc">
                  {current.report.expectedDifferences.map((finding) => <li key={finding.code}>{finding.message}</li>)}
                </ul>
              </div>
              {current.report.warnings.length > 0 && (
                <div className="text-xs">
                  <strong>Warnings:</strong>
                  <ul className="ml-5 list-disc">
                    {current.report.warnings.map((finding, index) => <li key={index}>{finding.message}</li>)}
                  </ul>
                </div>
              )}
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label htmlFor="script-legacy-preview" className="text-sm font-medium">Legacy prompt — existing Step 0 format</label>
                  <Button onClick={() => void copyPrompt(current.legacyPrompt)}>Copy legacy</Button>
                </div>
                <textarea id="script-legacy-preview" readOnly value={current.legacyPrompt} rows={9} className="w-full rounded-lg border border-line bg-surface p-2 font-mono text-xs" />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label htmlFor="script-core-preview" className="text-sm font-medium">New prompt — script-prompt-v1</label>
                  <Button onClick={() => void copyPrompt(current.newPrompt)}>Copy new</Button>
                </div>
                <textarea id="script-core-preview" readOnly value={current.newPrompt} rows={9} className="w-full rounded-lg border border-line bg-surface p-2 font-mono text-xs" />
              </div>
              {copyMessage && <p role="status" className="text-xs text-muted">{copyMessage}</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
