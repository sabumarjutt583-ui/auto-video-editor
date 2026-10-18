import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { StepTabs } from "../components/prompt/StepTabs";
import { BibleSection } from "../components/bible";
import { PromptsStep } from "../components/prompts";
import { ScenesStep } from "../components/scenes";
import { StyleSection } from "../components/styles";
import { TimingStep } from "../components/timing";
import { VoiceStep } from "../components/voice";
import { Button } from "../components/ui";
import { stepAccess, type StepId } from "../lib/steps";
import { useProjectStore } from "../store/projectStore";

export function PromptGeneratorPage() {
  const navigate = useNavigate();
  const project = useProjectStore((state) => state.project);
  const [step, setStep] = useState<StepId>("voice");

  const access = project ? stepAccess(project) : null;
  // If the current step stops being available (for example after unlocking), go back to the voice.
  useEffect(() => {
    if (access && !access[step].enabled) setStep("voice");
  }, [access, step]);

  if (!project || !access) {
    return (
      <section className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface p-12 text-center">
        <h2 className="text-base font-semibold tracking-tight">No project open</h2>
        <p className="text-sm text-muted">Open or create a project first. Each project keeps its own voice, scenes and prompts.</p>
        <Button variant="primary" icon={FolderOpen} onClick={() => navigate("/projects")}>
          Go to Projects
        </Button>
      </section>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
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
      {step === "prompts" && <PromptsStep key={project.id} project={project} />}
    </div>
  );
}
