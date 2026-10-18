import { FilePlus2, FolderOpen, Shuffle, Upload } from "lucide-react";

import { cn } from "../../lib/cn";
import { Button, Card } from "../ui";

interface ImportCardProps {
  over: boolean;
  busy: boolean;
  matched: number;
  sceneCount: number;
  fileCount: number;
  onFiles: () => void;
  onFolder: () => void;
  onRename: () => void;
}

/** The drop zone and the buttons that bring pictures and clips in. */
export function ImportCard({ over, busy, matched, sceneCount, fileCount, onFiles, onFolder, onRename }: ImportCardProps) {
  return (
    <Card title="Add your pictures and clips" description="Drop a folder or many files here. Files named like S01_000.0-005.1.png go to their scenes by themselves." icon={Upload}>
      <div
        className={cn(
          "flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition-colors",
          over ? "border-accent bg-accent-soft" : "border-line bg-surface-2",
        )}
        data-testid="drop-zone"
      >
        <Upload size={28} aria-hidden className="text-muted" />
        <p className="text-sm">{over ? "Drop to add" : "Drag a folder or files here"}</p>
        <p className="text-xs text-muted">png, jpg, jpeg, webp, mp4, mov, webm. Your originals are copied into the project and never changed.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" icon={FilePlus2} disabled={busy} onClick={onFiles}>
            Choose files
          </Button>
          <Button icon={FolderOpen} disabled={busy} onClick={onFolder}>
            Choose folder
          </Button>
          <Button icon={Shuffle} disabled={busy || sceneCount === 0} onClick={onRename}>
            Bulk Rename
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted" role="status">
        {fileCount} files in the project. <span className="font-medium text-fg">{matched} of {sceneCount}</span> scenes have media.
      </p>
    </Card>
  );
}
