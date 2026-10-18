import { convertFileSrc } from "@tauri-apps/api/core";
import { CheckCircle2, FolderOpen, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { toAppError } from "../../lib/errors";
import { showInFolder, type RenderResult } from "../../lib/render/api";
import { formatSize } from "../../lib/render/request";
import { formatClock } from "../../lib/time";
import type { AppError } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button } from "../ui";

/** The finished video: play it, open its folder, and see that its length matches the voice. */
export function ResultCard({ projectId, result }: { projectId: string; result: RenderResult }) {
  const [error, setError] = useState<AppError | null>(null);
  const name = result.path.split(/[\\/]/).pop() ?? result.path;
  const open = async () => {
    setError(null);
    try {
      await showInFolder(projectId, result.path);
    } catch (e) {
      setError(toAppError(e, "The folder could not be opened."));
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-4" data-testid="render-result">
      <p className="flex items-center gap-2 text-sm font-medium">
        {result.durationOk ? <CheckCircle2 size={18} className="text-success" aria-hidden /> : <TriangleAlert size={18} className="text-warning" aria-hidden />}
        Your video is ready
      </p>
      <video controls preload="metadata" src={convertFileSrc(result.path)} className="max-h-72 w-full rounded-lg bg-black" data-testid="render-video" />
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
        <div><dt className="text-muted">File</dt><dd className="truncate font-medium" title={result.path}>{name}</dd></div>
        <div><dt className="text-muted">Size</dt><dd className="font-medium tabular-nums">{formatSize(result.sizeBytes)}</dd></div>
        <div><dt className="text-muted">Length</dt><dd className="font-medium tabular-nums">{formatClock(result.duration, 1)} (voice {formatClock(result.expectedDuration, 1)})</dd></div>
        <div><dt className="text-muted">Picture</dt><dd className="font-medium tabular-nums">{result.width} × {result.height}</dd></div>
        <div><dt className="text-muted">Encoder</dt><dd className="font-medium">{result.encoder}</dd></div>
        <div><dt className="text-muted">Time taken</dt><dd className="font-medium tabular-nums">{formatClock(result.secondsTaken)}</dd></div>
        <div><dt className="text-muted">Length check</dt><dd className={`font-medium ${result.durationOk ? "text-success" : "text-warning"}`}>{result.durationOk ? "Matches the voice" : "Does not match"}</dd></div>
        {result.srtPath && <div><dt className="text-muted">Subtitles</dt><dd className="truncate font-medium" title={result.srtPath}>{result.srtPath.split(/[\\/]/).pop()}</dd></div>}
      </dl>
      {result.copyPath && <p className="text-xs text-muted">Also copied to your export folder: {result.copyPath}</p>}
      {result.warnings.map((w) => (
        <p key={w} className="text-xs text-warning">{w}</p>
      ))}
      <div className="flex gap-2">
        <Button icon={FolderOpen} onClick={() => void open()} data-testid="open-folder">Open folder</Button>
      </div>
      {error && <ErrorNotice error={error} />}
    </div>
  );
}
