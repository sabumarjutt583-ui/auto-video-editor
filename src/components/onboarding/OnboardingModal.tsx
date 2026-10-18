import { ArrowRight, CheckCircle2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useKeyStore } from "../../store/keyStore";
import { useSettingsStore } from "../../store/settingsStore";
import { ApiKeyCard } from "../settings";
import { Button, Modal } from "../ui";

const WORKS_WITHOUT_KEYS = [
  "Create projects and add your voice-over",
  "Use your own SRT or JSON timing file (no Groq needed)",
  "Cut the script into scenes by sentence or by seconds",
  "Import pictures and videos named like S01_000.0-005.1.png",
  "Match files by order, build the timeline, add captions, music and sound effects",
  "Render the final MP4",
];

/** Three first-run screens: welcome, Groq key, Gemini key. Every screen can be skipped. */
export function OnboardingModal() {
  const [step, setStep] = useState(0);
  const status = useKeyStore((s) => s.status);
  const update = useSettingsStore((s) => s.update);
  const refreshKeys = useKeyStore((s) => s.refreshAll);
  useEffect(() => {
    void refreshKeys();
  }, [refreshKeys]);
  const finish = () => update({ onboardingDone: true });
  const last = step === 2;
  return (
    <Modal title={step === 0 ? "Welcome to Auto Video Editor" : step === 1 ? "Step 2 of 3: Groq key (for timing)" : "Step 3 of 3: Gemini key (for prompts)"} onClose={finish} wide>
      <div data-testid={`onboarding-${step + 1}`} className="flex flex-col gap-4">
        {step === 0 && (
          <>
            <p className="text-sm text-muted">Turn a voice-over and a script into a finished video: prompts for your pictures, an automatic timeline, captions, music and sound effects.</p>
            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <p className="mb-2 text-sm font-medium">What works with no keys at all:</p>
              <ul className="flex flex-col gap-1.5 text-sm">
                {WORKS_WITHOUT_KEYS.map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-sm text-muted">Two free keys make it faster: Groq finds the exact word timings, and Gemini writes the scenes and image prompts. Your keys stay in this computer’s keychain.</p>
          </>
        )}
        {step === 1 && <ApiKeyCard provider="groq" title="Groq key" description="Finds the exact time of every word in your voice-over." linkLabel="Get a free Groq key" link="groq_keys" />}
        {step === 2 && <ApiKeyCard provider="gemini" title="Gemini key" description="Splits your script into scenes and writes the image prompts." linkLabel="Get a free Gemini key" link="gemini_keys" />}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button icon={X} onClick={finish}>
            Skip for now
          </Button>
          <div className="flex items-center gap-3">
            {step > 0 && step <= 2 && (
              <span className="text-xs text-muted">{status[step === 1 ? "groq" : "gemini"] === "set" ? "Key saved." : "No key yet. You can add it later in Settings."}</span>
            )}
            <Button variant="primary" icon={ArrowRight} onClick={() => (last ? finish() : setStep(step + 1))}>
              {last ? "Finish" : step === 0 ? "Get started" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
