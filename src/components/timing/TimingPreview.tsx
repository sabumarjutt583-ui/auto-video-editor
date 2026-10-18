import { AlertTriangle, Info, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "../../lib/cn";
import { splitSentences, lowConfidenceSentences } from "../../lib/sentences";
import { activeWordIndex } from "../../lib/timing/active";
import { formatClock } from "../../lib/time";
import type { Project } from "../../types";
import { Button, Card } from "../ui";
import { WaveformPlayer } from "../voice/WaveformPlayer";

interface TimingPreviewProps {
  project: Project;
  /** Shown when the timing file does not fit the voice length. */
  warning: string;
  onRedo: () => void;
}

const SOURCE_NAMES = { srt: "subtitle file", json: "JSON file", groq: "Groq Whisper" } as const;

/** The result: quality, low-confidence sentences in orange, and a player that highlights the spoken word. */
export function TimingPreview({ project, warning, onRedo }: TimingPreviewProps) {
  const [time, setTime] = useState(0);
  const [seek, setSeek] = useState<{ time: number; nonce: number } | null>(null);

  const sentences = useMemo(() => splitSentences(project.words), [project.words]);
  const low = useMemo(() => lowConfidenceSentences(sentences, new Set(project.unmatchedWords)), [sentences, project.unmatchedWords]);
  const active = activeWordIndex(project.words, time);
  const quality = project.alignmentQuality;
  const source = project.timingSource ? SOURCE_NAMES[project.timingSource] : "timing";

  return (
    <Card title="Timing preview" description={`${project.words.length.toLocaleString()} words from the ${source}, in ${sentences.length} sentences. Click a sentence to hear it.`}>
      {quality !== null && (
        <p className={cn("text-sm font-medium", quality >= 90 ? "text-success" : "text-warning")} role="status">
          Script match: {quality.toFixed(1)}%
          <span className="ml-2 font-normal text-muted">
            {quality >= 90 ? "Almost every script word was found in the voice." : "Some script words were not found in the voice. Orange sentences need a look."}
          </span>
        </p>
      )}
      {project.timingEstimated && (
        <p className="flex items-start gap-2 text-sm text-muted" role="note">
          <Info size={16} aria-hidden className="mt-0.5 shrink-0" />
          Word times are estimated from the line times of the file. Scene boundaries are still accurate to the line.
        </p>
      )}
      {warning && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" role="alert">
          <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-warning" />
          {warning}
        </p>
      )}

      {project.voicePath && <WaveformPlayer projectId={project.id} path={project.voicePath} version={0} onTime={setTime} seek={seek} />}

      <ol className="flex max-h-96 flex-col gap-1.5 overflow-y-auto pr-1" aria-label="Sentences">
        {sentences.map((sentence) => {
          const isActive = time >= sentence.start && active >= sentence.firstWord && active <= sentence.lastWord;
          const isLow = low.has(sentence.index);
          return (
            <li key={sentence.index}>
              <button
                type="button"
                onClick={() => setSeek({ time: sentence.start, nonce: (seek?.nonce ?? 0) + 1 })}
                className={cn(
                  "flex w-full cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                  isLow ? "border-warning/50 bg-warning/10" : "border-line bg-surface-2",
                  isActive && "border-accent",
                )}
              >
                <span className="w-24 shrink-0 pt-0.5 font-mono text-xs tabular-nums text-muted">
                  {formatClock(sentence.start, 1)}–{formatClock(sentence.end, 1)}
                </span>
                <span dir="auto" className={cn("min-w-0 flex-1 break-words", isLow && "text-warning")}>
                  {isActive
                    ? project.words.slice(sentence.firstWord, sentence.lastWord + 1).map((word, offset) => (
                        <span key={sentence.firstWord + offset} className={cn("rounded px-0.5", sentence.firstWord + offset === active && "bg-accent text-on-accent")}>
                          {word.text}{" "}
                        </span>
                      ))
                    : sentence.text}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div>
        <Button icon={RotateCcw} onClick={onRedo}>
          Redo the timings
        </Button>
      </div>
    </Card>
  );
}
