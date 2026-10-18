import { FileAudio, Upload } from "lucide-react";

import { cn } from "../../lib/cn";
import { AUDIO_EXTENSIONS } from "../../lib/audioFiles";
import { Button } from "../ui";

interface VoiceDropzoneProps {
  dragging: boolean;
  busy: boolean;
  /** Text on the button, e.g. "Choose voice file" or "Replace voice". */
  buttonLabel: string;
  compact?: boolean;
  onPick: () => void;
}

/** The area where a voice file is dropped, with a button for the file picker. */
export function VoiceDropzone({ dragging, busy, buttonLabel, compact = false, onPick }: VoiceDropzoneProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-2xl border border-dashed text-center transition-colors",
        compact ? "justify-between px-4 py-3 text-left" : "flex-col px-6 py-10",
        dragging ? "border-accent bg-accent-soft" : "border-line bg-surface-2",
      )}
    >
      <div className={cn("flex items-center gap-3", compact ? "" : "flex-col")}>
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent-fg">
          {compact ? <FileAudio size={20} aria-hidden /> : <Upload size={20} aria-hidden />}
        </span>
        <div>
          <p className="text-sm font-medium">
            {dragging ? "Drop the voice file here" : compact ? "Use a different voice file" : "Drag your voice-over here"}
          </p>
          <p className="text-xs text-muted">{AUDIO_EXTENSIONS.join(", ")}</p>
        </div>
      </div>
      <Button variant={compact ? "secondary" : "primary"} icon={Upload} loading={busy} onClick={onPick}>
        {buttonLabel}
      </Button>
    </div>
  );
}
