import { CheckCircle, ClipboardCheck } from "lucide-react";
import { useState } from "react";
import { checkMedia } from "../../lib/media/api";
import { readEditor } from "../../lib/editor/model";
import { checkStudioQuality, type StudioQualityIssue } from "../../lib/studio/quality";
import { toAppError } from "../../lib/errors";
import type { Project, AppError } from "../../types";
import { Button } from "../ui";
import { ErrorNotice } from "../ErrorNotice";

export function StudioQualityPanel({ project }: { project: Project }) {
  const [issues, setIssues] = useState<StudioQualityIssue[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  async function run(): Promise<void> {
    setRunning(true);
    setError(null);
    setIssues(null);
    try {
      const files = readEditor(project).media;
      const paths = Array.from(new Set(files.map((file) => file.path)));
      const found = paths.length ? await checkMedia(project.id, paths) : [];
      const present = Object.fromEntries(paths.map((path, index) => [path, found[index] !== false]));
      setIssues(checkStudioQuality(project, present));
      setCheckedAt(Date.now());
    } catch (caught) {
      setError(toAppError(caught, "Could not inspect project media. No quality result was recorded."));
    } finally {
      setRunning(false);
    }
  }

  const blocking = issues?.filter((issue) => issue.severity === "error").length ?? 0;
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4" aria-label="Studio quality check">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><ClipboardCheck size={18} /><h3 className="text-sm font-semibold">Pre-export Quality Check</h3></div>
        <Button onClick={() => void run()} loading={running}>Check Timeline & Files</Button>
      </div>
      <p className="text-xs text-muted">Checks source existence, missing clips, timing gaps, video trim limits and audio presence. This check never modifies your project.</p>
      {error && <ErrorNotice error={error} />}
      {issues && (
        <div className="flex flex-col gap-2" role="status">
          <p className="text-sm font-medium">{blocking === 0 ? "No blocking issues detected by this check." : `${blocking} blocking issue(s) detected.`}</p>
          {checkedAt && <p className="text-xs text-muted">Checked {new Date(checkedAt).toLocaleTimeString()} · Recheck after editing.</p>}
          {issues.length === 0 && <div className="flex items-center gap-2 text-sm"><CheckCircle size={16} />No issues found in the checks available.</div>}
          {issues.map((issue, index) => (
            <div key={index} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs">
              <strong>{issue.severity.toUpperCase()}</strong> — {issue.sceneId ?? "Project"} · {issue.time.toFixed(2)}s — {issue.message}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
