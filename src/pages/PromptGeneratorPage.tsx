import { FolderOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ProjectSteps } from "../components/prompt/ProjectSteps";
import { QuickGenerator } from "../components/quick/QuickGenerator";
import { useQuickSession } from "../components/quick/useQuickSession";
import { ErrorNotice } from "../components/ErrorNotice";
import { Button, SegmentedControl } from "../components/ui";
import { QUICK_ID } from "../lib/quick/textScenes";
import { useProjectStore } from "../store/projectStore";
import { useQuickStore } from "../store/quickStore";

type Choice = "quick" | "project";

export function PromptGeneratorPage() {
  const navigate = useNavigate();
  const project = useProjectStore((state) => state.project);
  const lastProject = useQuickStore((state) => state.lastProject);
  const session = useQuickSession();
  const [choice, setChoice] = useState<Choice>("quick");
  const [afterSave, setAfterSave] = useState<string | null>(null);
  const entered = useRef(false);

  const isQuick = project?.id === QUICK_ID;

  // Nothing is open and the person wants quick mode (the default): open the session.
  useEffect(() => {
    if (project || choice !== "quick" || entered.current) return;
    entered.current = true;
    void session.enter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, choice]);

  function pick(next: Choice) {
    setChoice(next);
    entered.current = false;
    if (!project) return;
    if (next === "quick" && !isQuick) void session.enter();
    if (next === "project" && isQuick) void session.leave();
  }

  const options: { value: Choice; label: string }[] = project
    ? [
        { value: "project", label: isQuick ? (lastProject ? `Project: ${lastProject.name}` : "Open or create a project") : `Project: ${project.name}` },
        { value: "quick", label: "Quick prompts" },
      ]
    : [
        { value: "quick", label: "Quick prompts (no project)" },
        { value: "project", label: "Open or create a project" },
      ];
  const selected: Choice = project ? (isQuick ? "quick" : "project") : choice;

  const switcher = <SegmentedControl<Choice> label="Prompt Generator mode" value={selected} onChange={pick} options={options} />;

  if (!project) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {switcher}
        {session.error && <ErrorNotice error={session.error} />}
        {choice === "quick" ? (
          <p className="text-sm text-muted" role="status">
            {session.error ? "" : "Opening the quick session…"}
          </p>
        ) : (
          <section className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface p-12 text-center">
            <h2 className="text-base font-semibold tracking-tight">No project open</h2>
            <p className="text-sm text-muted">Open or create a project. Each project keeps its own voice, scenes and prompts. Or use quick prompts, which needs no project.</p>
            <Button variant="primary" icon={FolderOpen} onClick={() => navigate("/projects")}>
              Go to Projects
            </Button>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      {switcher}
      {isQuick ? (
        <QuickGenerator
          project={project}
          session={session}
          onSaved={(id) => {
            setAfterSave(id);
            setChoice("project");
          }}
        />
      ) : (
        <ProjectSteps key={`${project.id}-${afterSave === project.id ? "saved" : "open"}`} project={project} initialStep={afterSave === project.id ? "prompts" : "voice"} />
      )}
    </div>
  );
}
