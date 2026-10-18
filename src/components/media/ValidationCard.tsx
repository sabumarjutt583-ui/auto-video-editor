import { AlertTriangle, CheckCircle2, Info, RefreshCw, XCircle } from "lucide-react";

import { cn } from "../../lib/cn";
import type { Issue, Severity } from "../../lib/media/validate";
import type { MediaFile } from "../../types";
import { Button, Card, Select } from "../ui";

const STYLE: Record<Severity, { box: string; icon: typeof XCircle; label: string }> = {
  red: { box: "border-danger/40 bg-danger/10", icon: XCircle, label: "Problem" },
  orange: { box: "border-warning/40 bg-warning/10", icon: AlertTriangle, label: "Check" },
  grey: { box: "border-line bg-surface-2 text-muted", icon: Info, label: "Fixed automatically" },
};

interface ValidationCardProps {
  issues: Issue[];
  media: MediaFile[];
  mediaMap: Record<string, string>;
  onPick: (sceneId: string, path: string) => void;
  onFileTime: (sceneId: string) => void;
  onProjectTime: (sceneId: string) => void;
  onRecheck: () => void;
  onRemove: (path: string) => void;
}

/** The list of things to look at: missing scenes (red), choices and short clips (orange), auto-fixed gaps (grey). */
export function ValidationCard({ issues, media, mediaMap, onPick, onFileTime, onProjectTime, onRecheck, onRemove }: ValidationCardProps) {
  const reds = issues.filter((i) => i.severity === "red").length;
  return (
    <Card title="Check" description="Everything that needs a look before you edit." icon={reds > 0 ? XCircle : CheckCircle2}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm" role="status">
          {issues.length === 0 ? "All scenes have media and nothing needs attention." : `${reds} problems, ${issues.filter((i) => i.severity === "orange").length} to check, ${issues.filter((i) => i.severity === "grey").length} fixed automatically.`}
        </p>
        <Button icon={RefreshCw} onClick={onRecheck}>
          Check again
        </Button>
      </div>
      {issues.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Problems">
          {issues.map((issue, index) => {
            const { box, icon: Icon, label } = STYLE[issue.severity];
            const candidates = media.filter((m) => m.sceneId === issue.sceneId);
            return (
              <li key={`${issue.kind}-${issue.sceneId}-${index}`} className={cn("flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm", box)} data-severity={issue.severity} data-kind={issue.kind}>
                <Icon size={16} aria-label={label} className="shrink-0" />
                <span className="min-w-0 flex-1">{issue.message}</span>
                {issue.kind === "duplicate" && (
                  <div className="w-64">
                    <Select aria-label={`File to use for ${issue.sceneId}`} value={mediaMap[issue.sceneId] ?? ""} onChange={(event) => onPick(issue.sceneId, event.target.value)}>
                      {candidates.map((m) => (
                        <option key={m.path} value={m.path}>
                          {m.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                {issue.kind === "file_missing" && issue.path && <Button onClick={() => onRemove(issue.path ?? "")}>Remove from list</Button>}
                {issue.kind === "time_mismatch" && (
                  <div className="flex gap-2">
                    <Button onClick={() => onFileTime(issue.sceneId)}>Use file time</Button>
                    <Button onClick={() => onProjectTime(issue.sceneId)}>Use project time</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
