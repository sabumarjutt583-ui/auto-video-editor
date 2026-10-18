import { Eye, Scissors, SkipForward } from "lucide-react";

import { formatClock } from "../../lib/time";
import type { SilenceReport, VoiceCleanup } from "../../types";
import { Button, Checkbox, Field, NumberField } from "../ui";

interface SilencePanelProps {
  cleanup: VoiceCleanup;
  /** Preview that matches the current settings, if there is one. */
  report: SilenceReport | null;
  disabled: boolean;
  busy: boolean;
  onChange: (patch: Partial<VoiceCleanup>) => void;
  onPreview: () => void;
  onApply: () => void;
  onSkip: () => void;
}

/** Settings and buttons for removing silences. */
export function SilencePanel({ cleanup, report, disabled, busy, onChange, onPreview, onApply, onSkip }: SilencePanelProps) {
  const locked = disabled || busy;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Silence threshold (dB)" htmlFor="silence-threshold" hint="Quieter than this counts as silence.">
          <NumberField id="silence-threshold" value={cleanup.thresholdDb} min={-80} max={-10} disabled={locked} onChange={(thresholdDb) => onChange({ thresholdDb })} />
        </Field>
        <Field label="Shortest silence to cut (s)" htmlFor="silence-min" hint="Shorter pauses are kept.">
          <NumberField id="silence-min" value={cleanup.minSilence} min={0.1} max={10} step={0.1} disabled={locked} onChange={(minSilence) => onChange({ minSilence })} />
        </Field>
        <Field label="Padding around speech (s)" htmlFor="silence-padding" hint="Silence kept before and after words.">
          <NumberField id="silence-padding" value={cleanup.padding} min={0} max={1} step={0.05} disabled={locked} onChange={(padding) => onChange({ padding })} />
        </Field>
      </div>

      <Checkbox
        label="Normalize loudness (-16 LUFS, good for voice)"
        checked={cleanup.normalize}
        disabled={locked}
        onChange={(event) => onChange({ normalize: event.target.checked })}
      />

      {report && (
        <p className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm" role="status">
          Found <strong>{report.removed.length}</strong> silent {report.removed.length === 1 ? "part" : "parts"} to remove (shaded
          red on the waveform). The voice would go from <strong>{formatClock(report.duration, 1)}</strong> to{" "}
          <strong>{formatClock(report.newDuration, 1)}</strong>, saving{" "}
          <strong>{formatClock(report.duration - report.newDuration, 1)}</strong>.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button icon={Eye} disabled={locked} onClick={onPreview}>
          Preview
        </Button>
        <Button variant="primary" icon={Scissors} disabled={locked} onClick={onApply}>
          Apply
        </Button>
        <Button icon={SkipForward} disabled={locked} onClick={onSkip}>
          Skip (keep original)
        </Button>
      </div>
    </div>
  );
}
