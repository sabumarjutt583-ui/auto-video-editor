import { FilePlus2, Save, X } from "lucide-react";
import { useState } from "react";

import { QUICK_ID } from "../../lib/quick/textScenes";
import { useProjectStore } from "../../store/projectStore";
import { useQuickStore } from "../../store/quickStore";
import type { Project } from "../../types";
import { BibleSection } from "../bible";
import { ErrorNotice } from "../ErrorNotice";
import { ProjectSteps } from "../prompt/ProjectSteps";
import { PromptsStep } from "../prompts";
import { StyleSection } from "../styles";
import { Button, SegmentedControl } from "../ui";
import { EngineSwitch } from "./EngineSwitch";
import { QuickScriptStep } from "./QuickScriptStep";
import { SaveAsProjectDialog } from "./SaveAsProjectDialog";
import type { QuickSession } from "./useQuickSession";

type Input = "text" | "voice";
type TextStep = "script" | "style" | "prompts";

interface QuickGeneratorProps {
  project: Project;
  session: QuickSession;
  /** Called with the id of the project that was made. */
  onSaved: (projectId: string) => void;
}

/** The Prompt Generator without a project: paste text, or add a voice and timing, then write the prompts. */
export function QuickGenerator({ project, session, onSaved }: QuickGeneratorProps) {
  const restoredNote = useQuickStore((state) => state.restoredNote);
  const saveState = useProjectStore((state) => state.saveState);
  const [input, setInput] = useState<Input>(project.voiceLocked || project.words.length > 0 ? "voice" : "text");
  const [step, setStep] = useState<TextStep>("script");
  const [confirmNew, setConfirmNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const hasScenes = project.scenes.length > 0;
  const hasStyle = project.styleId !== null;
  const textSteps: { value: TextStep; label: string }[] = [
    { value: "script", label: "1  Script" },
    { value: "style", label: "2  Style & cast" },
    { value: "prompts", label: "3  Prompts" },
  ];
  const stepReady = (value: TextStep) => value === "script" || (value === "style" && hasScenes) || (value === "prompts" && hasScenes && hasStyle);
  const shown: TextStep = stepReady(step) ? step : "script";

  async function save(name: string) {
    const id = await session.saveAsProject(name);
    if (id) {
      setSaving(false);
      onSaved(id);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold">Quick prompts</span>
          <span className="text-xs text-muted" role="status">
            No project needed. {saveState === "saving" ? "Saving…" : saveState === "error" ? "Could not save." : "Saved automatically."}
          </span>
        </div>
        <div className="flex-1" />
        <EngineSwitch />
        <Button icon={FilePlus2} disabled={session.busy} onClick={() => setConfirmNew(true)}>
          New quick session
        </Button>
        <Button variant="primary" icon={Save} disabled={session.busy || (!hasScenes && project.script.trim() === "" && !project.voiceLocked)} onClick={() => setSaving(true)}>
          Save as project
        </Button>
      </div>

      {restoredNote && (
        <p className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm text-muted" role="status">
          Last quick session restored.
          <button type="button" aria-label="Close" className="cursor-pointer rounded p-1 hover:text-fg" onClick={() => useQuickStore.getState().setRestoredNote(false)}>
            <X size={14} />
          </button>
        </p>
      )}
      {session.error && <ErrorNotice error={session.error} />}

      {confirmNew && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-5 py-4" role="alertdialog" aria-label="New quick session">
          <p className="text-sm">Start a new quick session? The script, voice, scenes, prompts and character bible of this one are deleted. Your style and options stay.</p>
          <div className="flex gap-2">
            <Button onClick={() => setConfirmNew(false)}>Cancel</Button>
            <Button
              variant="danger"
              loading={session.busy}
              onClick={() => {
                setConfirmNew(false);
                setStep("script");
                void session.startNew();
              }}
            >
              Delete and start new
            </Button>
          </div>
        </div>
      )}

      <SegmentedControl<Input>
        label="How to start"
        value={input}
        onChange={setInput}
        options={[{ value: "text", label: "Text only" }, { value: "voice", label: "Voice + timing" }]}
      />

      {input === "voice" ? (
        <ProjectSteps key={`${QUICK_ID}-voice`} project={project} quick />
      ) : (
        <div className="flex flex-col gap-6">
          <SegmentedControl<TextStep> label="Quick steps" value={shown} onChange={(value) => stepReady(value) && setStep(value)} options={textSteps} />
          {shown === "script" && <QuickScriptStep project={project} />}
          {shown === "style" && (
            <>
              <StyleSection project={project} />
              <BibleSection project={project} />
            </>
          )}
          {shown === "prompts" && <PromptsStep project={project} quick />}
        </div>
      )}

      {saving && <SaveAsProjectDialog busy={session.busy} onSave={(name) => void save(name)} onClose={() => setSaving(false)} />}
    </div>
  );
}
