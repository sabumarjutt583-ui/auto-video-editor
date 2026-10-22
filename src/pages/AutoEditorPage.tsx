import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { EditorStep } from "../components/editor/EditorStep";
import { MediaStep } from "../components/media";
import { Button, SegmentedControl } from "../components/ui";
import { readEditor } from "../lib/editor/model";
import { reconcile } from "../lib/media/place";
import { applyEdit } from "../store/historyStore";
import { QUICK_ID } from "../lib/quick/textScenes";
import { useProjectStore } from "../store/projectStore";

type StepId = "media" | "edit";

function NeedsScenes({ message }: { message: string }) {
  const navigate = useNavigate();
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface p-12 text-center">
      <h2 className="text-base font-semibold tracking-tight">Auto Editor</h2>
      <p className="text-sm text-muted">{message}</p>
      <Button variant="primary" icon={FolderOpen} onClick={() => navigate("/projects")}>
        Go to Projects
      </Button>
    </section>
  );
}

export function AutoEditorPage() {
  const project = useProjectStore((state) => state.project);
  const [step, setStep] = useState<StepId>("media");

  // The scenes may have been rebuilt since the files were placed: place them again by name.
  const projectId = project?.id ?? null;
  const sceneKey = project?.scenes.map((s) => `${s.id}:${s.start}`).join("|") ?? "";
  useEffect(() => {
    const current = useProjectStore.getState().project;
    if (!current || current.scenes.length === 0) return;
    const data = readEditor(current);
    if (data.media.length === 0) return;
    const placement = reconcile(data, current.mediaMap, current.scenes);
    if (JSON.stringify(placement.media) !== JSON.stringify(data.media) || JSON.stringify(placement.mediaMap) !== JSON.stringify(current.mediaMap)) {
      applyEdit({ editor: { ...data, media: placement.media }, mediaMap: placement.mediaMap });
    }
  }, [projectId, sceneKey]);

  if (!project) return <NeedsScenes message="Open a project first. The Auto Editor builds the video from the scenes of a project." />;
  if (project.id === QUICK_ID) return <NeedsScenes message="Quick prompts has no editor. Press 'Save as project' in the Prompt Generator first, then come back here." />;
  if (project.scenes.length === 0) return <NeedsScenes message="This project has no scenes yet. Build the scenes in the Prompt Generator first, then come back here." />;

  return (
    <div className={step === "edit" ? "flex w-full flex-col gap-4" : "mx-auto flex w-full max-w-5xl flex-col gap-6"}>
      <SegmentedControl<StepId> label="Auto Editor steps" value={step} onChange={setStep} options={[{ value: "media", label: "1  Media" }, { value: "edit", label: "2  Edit" }]} />
      {step === "media" && <MediaStep key={project.id} project={project} />}
      {step === "edit" && <EditorStep key={project.id} project={project} />}
    </div>
  );
}
