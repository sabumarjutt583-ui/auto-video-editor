import { AudioLines, FileJson, Subtitles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useGroqKeyStatus } from "./useGroqKeyStatus";
import { cn } from "../../lib/cn";
import type { JobInfo } from "../../store/jobStore";
import { Card } from "../ui";
import { JobBar } from "../voice/JobBar";

export type SourceKind = "srt" | "json" | "groq";

interface Option {
  kind: SourceKind;
  title: string;
  text: string;
  action: string;
  icon: LucideIcon;
}

const OPTIONS: readonly Option[] = [
  { kind: "srt", title: "I have an SRT or VTT file", text: "Line times only, so word times are estimated inside each line.", action: "Choose SRT / VTT file", icon: Subtitles },
  { kind: "json", title: "I have a JSON timing file", text: "Whisper, ElevenLabs or a list of { text, start, end }. Exact word times.", action: "Choose JSON file", icon: FileJson },
  { kind: "groq", title: "Get the timings automatically", text: "Groq Whisper listens to the locked voice. Needs a Groq key in Settings.", action: "Transcribe with Groq", icon: AudioLines },
];

interface SourceCardProps {
  busy: boolean;
  job: JobInfo | null;
  onChoose: (kind: SourceKind) => void;
}

/** Three ways to get the time of every word. */
export function SourceCard({ busy, job, onChoose }: SourceCardProps) {
  const groqKey = useGroqKeyStatus();
  return (
    <Card title="Get the word timings" description="The voice is locked. Now every word needs a time. Choose one way.">
      <div className="grid gap-3 md:grid-cols-3" role="group" aria-label="Timing source">
        {OPTIONS.map(({ kind, title, text, action, icon: Icon }) => {
          const missingKey = kind === "groq" && groqKey === "not_set";
          return (
            <div key={kind} className={cn("flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-4", missingKey && "opacity-80")}>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent-fg">
                <Icon size={18} aria-hidden />
              </span>
              <div className="flex-1">
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-1 text-xs text-muted">{text}</p>
                {missingKey && <p className="mt-1 text-xs text-warning">No Groq key saved yet. Add one in Settings.</p>}
              </div>
              <button
                type="button"
                disabled={busy || missingKey}
                onClick={() => onChoose(kind)}
                className="h-9 cursor-pointer rounded-lg border border-line bg-surface px-3 text-sm font-medium transition-colors hover:border-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {action}
              </button>
            </div>
          );
        })}
      </div>
      {job && <JobBar job={job} />}
    </Card>
  );
}
