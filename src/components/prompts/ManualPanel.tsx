import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";

import { copyText } from "../../lib/clipboard";
import { applyManualAnswer, planManual, type ManualStep } from "../../lib/prompts/chat/manual";
import type { PromptContext } from "../../lib/prompts/generate";
import type { Scene } from "../../types";
import { Button, Card } from "../ui";

interface ManualPanelProps {
  scenes: readonly Scene[];
  context: PromptContext | null;
  tag: string;
  batchSize: number;
  /** Stores the scenes after an answer was used. */
  onScenes: (scenes: Scene[]) => void;
}

interface StepState {
  answer: string;
  note: string;
  followUp: string | null;
  done: boolean;
}

const EMPTY: StepState = { answer: "", note: "", followUp: null, done: false };

/** Manual mode: the messages to copy into any AI chat, and a box to paste each answer back. No browser, account or key needed. */
export function ManualPanel({ scenes, context, tag, batchSize, onScenes }: ManualPanelProps) {
  const [steps, setSteps] = useState<ManualStep[] | null>(null);
  const [state, setState] = useState<Record<string, StepState>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const missingIds = useMemo(() => new Set(scenes.filter((s) => s.prompt.trim() === "" && !s.edited).map((s) => s.id)), [scenes]);

  const prepare = (all: boolean) => {
    if (!context) return;
    const ids = all ? new Set(scenes.map((s) => s.id)) : missingIds;
    setSteps(planManual(context, scenes, ids, tag, batchSize));
    setState({});
  };
  const patch = (id: string, change: Partial<StepState>) => setState((s) => ({ ...s, [id]: { ...EMPTY, ...s[id], ...change } }));
  const copy = async (id: string, text: string) => {
    if (await copyText(text)) {
      setCopied(id);
      window.setTimeout(() => setCopied(null), 1500);
    }
  };

  function use(step: ManualStep) {
    if (!context) return;
    const entry = state[step.id];
    const answer = entry?.answer ?? "";
    if (step.kind === "setup") {
      patch(step.id, { done: true, note: "Setup done." });
      return;
    }
    const result = applyManualAnswer(step, answer, scenes, context);
    if (!result.readable) {
      patch(step.id, { note: "No JSON list was found in this answer. Copy the whole answer of the AI, including the ```json block.", done: false });
      return;
    }
    if (result.applied.length > 0) onScenes(result.scenes);
    const notes = [`${result.applied.length} prompts were used.`];
    if (result.missing.length > 0) notes.push(`Missing: ${result.missing.join(", ")}. Copy the follow-up message below and paste the new answer here.`);
    if (result.extra.length > 0) notes.push(`Not part of this batch (ignored): ${result.extra.join(", ")}.`);
    patch(step.id, { note: notes.join(" "), followUp: result.followUp, done: result.missing.length === 0, answer: result.missing.length === 0 ? answer : "" });
  }

  return (
    <Card title="Manual (copy and paste)" description="Copy each message into any AI chat (Gemini, ChatGPT, Claude...) in the same chat window, in order. Paste each answer back and press Use answer. No browser, account or key is needed.">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={!context || missingIds.size === 0} onClick={() => prepare(false)}>
          {missingIds.size === 0 ? "All scenes have a prompt" : `Prepare messages for ${missingIds.size} scenes`}
        </Button>
        <Button disabled={!context || scenes.length === 0} onClick={() => prepare(true)}>
          Prepare for all scenes
        </Button>
      </div>
      {steps && (
        <ol className="flex flex-col gap-3" aria-label="Messages">
          {steps.map((step) => {
            const s = state[step.id];
            return (
              <li key={step.id} className="rounded-xl border border-line bg-surface-2 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {s?.done && <Check size={14} aria-label="done" />}
                    {step.title}
                  </span>
                  <Button icon={copied === step.id ? Check : Copy} onClick={() => void copy(step.id, step.message)}>
                    {copied === step.id ? "Copied" : "Copy"}
                  </Button>
                </div>
                <textarea aria-label={`Message ${step.id}`} readOnly rows={4} value={step.message} className="w-full resize-y rounded-lg border border-line bg-transparent px-2 py-1 font-mono text-xs" />
                <textarea
                  aria-label={`Paste answer ${step.id}`}
                  rows={3}
                  placeholder={step.kind === "setup" ? "Paste the answer (READY) here, optional." : "Paste the answer of the AI here."}
                  value={s?.answer ?? ""}
                  onChange={(event) => patch(step.id, { answer: event.target.value })}
                  className="mt-2 w-full resize-y rounded-lg border border-line bg-transparent px-2 py-1 font-mono text-xs"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button disabled={step.kind === "batch" && (s?.answer ?? "").trim() === ""} onClick={() => use(step)}>
                    Use answer
                  </Button>
                  {s?.note && <span className="text-xs text-muted" role="status">{s.note}</span>}
                </div>
                {s?.followUp && (
                  <div className="mt-2 flex items-center gap-2">
                    <Button icon={Copy} onClick={() => void copy(`${step.id}-m`, s.followUp ?? "")}>
                      {copied === `${step.id}-m` ? "Copied" : "Copy follow-up for the missing scenes"}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
