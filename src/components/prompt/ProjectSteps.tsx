import { useEffect, useState } from "react";

import { stepAccess, type StepId } from "../../lib/steps";
import { isQuickId } from "../../lib/quick/textScenes";
import type { Project } from "../../types";
import { BibleSection } from "../bible";
import { PromptsStep } from "../prompts";
import { ScenesStep } from "../scenes";
import { StyleSection } from "../styles";
import { TimingStep } from "../timing";
import { VoiceStep } from "../voice";
import { Button } from "../ui";
import { StepTabs } from "./StepTabs";

interface ProjectStepsProps {
  project: Project;
  /** Quick mode: no "Send to Auto Editor". */
  quick?: boolean;
  initialStep?: StepId;
}

/** The five steps of the Prompt Generator (voice, timing, scenes, style and cast, prompts). */
export function ProjectSteps({ project, quick = false, initialStep = "voice" }: ProjectStepsProps) {
  const access = stepAccess(project);
  const [step, setStep] = useState<StepId>(initialStep);

  // If the current step stops being available (for example after unlocking), go back to the voice.
  useEffect(() => {
    if (!access[step].enabled) setStep("voice");
  }, [access, step]);

  const untimed = !quick && project.scenes.length > 0 && project.words.length === 0 && project.scenes.every((scene) => isQuickId(scene.id));

  return (
    <div className="flex flex-col gap-6">
      {untimed && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-4" role="note">
          <p className="text-sm text-muted">Add a voice and timing to get timecodes for the editor. Until then the prompts are called P01, P02 ...</p>
          <Button onClick={() => setStep("voice")}>Add a voice</Button>
        </div>
      )}
      <StepTabs current={step} access={access} onSelect={setStep} />
      {step === "voice" && <VoiceStep key={project.id} project={project} />}
      {step === "timing" && <TimingStep key={project.id} project={project} />}
      {step === "scenes" && <ScenesStep key={project.id} project={project} />}
      {step === "style" && (
        <>
          <StyleSection key={`style-${project.id}`} project={project} />
          <BibleSection key={`bible-${project.id}`} project={project} />
        </>
      )}
      {step === "prompts" && <PromptsStep key={project.id} project={project} quick={quick} />}
    </div>
  );
}
