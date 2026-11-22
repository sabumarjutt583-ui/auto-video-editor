import { FileText, WandSparkles } from "lucide-react";
import { useState } from "react";
import { planScriptDraft, patchFromScriptDraft } from "../../lib/studio/scriptDraft";
import { toAppError } from "../../lib/errors";
import { applyEdit } from "../../store/historyStore";
import { useProjectStore } from "../../store/projectStore";
import type { AppError, Project } from "../../types";
import { Button } from "../ui";
import { ErrorNotice } from "../ErrorNotice";

interface Props { project: Project; onBuilt: () => void }

/** Script-to-scenes in the independent editor. This is an offline draft, not an LLM claim. */
export function ScriptDraftPanel({ project, onBuilt }: Props) {
  const [script, setScript] = useState(project.script || "");
  const [rate, setRate] = useState(150);
  const [error, setError] = useState<AppError | null>(null);
  const [estimate, setEstimate] = useState<{ count: number; seconds: number } | null>(null);

  function analyze(): void {
    setError(null);
    try {
      const result = planScriptDraft(script, rate);
      setEstimate({ count: result.scenes.length, seconds: result.duration });
    } catch (caught) {
      setEstimate(null);
      setError(toAppError(caught, "The script could not be analyzed."));
    }
  }

  function create(): void {
    setError(null);
    try {
      const current = useProjectStore.getState().project;
      if (!current || current.id !== project.id || current.scriptSource !== "video_studio") return;
      if (current.scenes.length > 0) {
        throw new Error("This edit already has timeline clips. To preserve manual edits, create another blank Studio project for a different script.");
      }
      applyEdit(patchFromScriptDraft(script, rate));
      onBuilt();
    } catch (caught) {
      setError(toAppError(caught, "The script scene plan could not be built."));
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4" aria-label="Script to video draft">
      <div className="flex items-center gap-2"><FileText size={18} /><h2 className="text-sm font-semibold">Script to Video — Offline Scene Draft</h2></div>
      <p className="text-xs text-muted">
        Paste narration to create editable timed scenes. Timing is estimated from reading speed; it is not voiceover transcription or semantic AI analysis.
        Imported visuals can then be assigned to the resulting scenes.
      </p>
      <textarea aria-label="Paste narration script" rows={5} dir="auto"
        className="w-full resize-y rounded-xl border border-line bg-surface-2 p-3 text-sm text-fg"
        placeholder="Paste your video script here..." value={script} onChange={(event) => { setScript(event.target.value); setEstimate(null); }} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">Estimated narration speed (words/minute)
          <input type="number" min={90} max={240} step={5} value={rate}
            onChange={(event) => { setRate(Number(event.target.value)); setEstimate(null); }}
            className="w-28 rounded-lg border border-line bg-surface-2 px-3 py-2 text-fg" />
        </label>
        <Button onClick={analyze}>Analyze draft</Button>
        <Button icon={WandSparkles} variant="primary" disabled={project.scenes.length > 0 || !script.trim()} onClick={create}>
          Build Editable Scenes
        </Button>
      </div>
      {estimate && <p className="text-xs text-muted" role="status">
        Draft estimate: {estimate.count} scenes, approximately {estimate.seconds.toFixed(1)} seconds. Add real voiceover later for actual synchronization.
      </p>}
      {project.scenes.length > 0 && <p className="text-xs text-muted">
        This project already has {project.scenes.length} clips. Draft creation is disabled to protect the existing edit.
      </p>}
      {error && <ErrorNotice error={error} />}
    </section>
  );
}
