import { ArrowRight, FilePlus2, FolderOpen } from "lucide-react";
import { useMemo, useState } from "react";

import { pickFolder, pickMediaFiles } from "../../lib/dialog";
import { isCancelled, toAppError } from "../../lib/errors";
import { scanMedia } from "../../lib/media/api";
import { sortSources, type SortBy } from "../../lib/media/files";
import { planRename, type RenameRow } from "../../lib/media/rename";
import { useFileDrop } from "../../lib/useFileDrop";
import { runJob, selectJob, useJobStore } from "../../store/jobStore";
import type { AppError, Scene, SourceMedia } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Field, Modal, Select } from "../ui";
import { JobBar } from "../voice/JobBar";

interface BulkRenameModalProps {
  scenes: Scene[];
  onClose: () => void;
  onConfirm: (rows: readonly RenameRow[]) => Promise<boolean>;
}

/** Turns files with random names (in the order they were made) into files named by scene timecode. */
export function BulkRenameModal({ scenes, onClose, onConfirm }: BulkRenameModalProps) {
  const [files, setFiles] = useState<SourceMedia[]>([]);
  const [sort, setSort] = useState<SortBy>("date");
  const [start, setStart] = useState(0);
  const [error, setError] = useState<AppError | null>(null);
  const [working, setWorking] = useState(false);
  const job = useJobStore(selectJob(["media"]));

  async function load(paths: string[]) {
    setError(null);
    try {
      const scan = await runJob("media", "Reading the files", (id) => scanMedia(paths, id));
      setFiles((before) => {
        const known = new Set(before.map((f) => f.path));
        return [...before, ...scan.files.filter((f) => !known.has(f.path))];
      });
      if (scan.skipped.length > 0) setError({ message: `${scan.skipped.length} files were left out because they are not pictures or clips I can read.`, details: scan.skipped.map((f) => `${f.name}: ${f.reason}`).join("\n") });
    } catch (caught) {
      if (!isCancelled(caught)) setError(toAppError(caught, "The files could not be read."));
    }
  }

  const { over } = useFileDrop((paths) => void load(paths), true);
  const ordered = useMemo(() => sortSources(files, sort), [files, sort]);
  const rows = useMemo(() => planRename(ordered, scenes, start), [ordered, scenes, start]);
  const usable = rows.filter((r) => r.newName !== null);

  async function confirm() {
    setWorking(true);
    const done = await onConfirm(rows);
    setWorking(false);
    if (done) onClose();
  }

  return (
    <Modal title="Bulk Rename" onClose={onClose} wide>
      <p className="text-sm text-muted">
        Add the files from your image or video tool. They are matched to the scenes in order, and copies with the right names are made in the project. Your originals are never changed.
      </p>
      <div className={`flex flex-wrap items-center gap-2 rounded-xl border-2 border-dashed p-3 ${over ? "border-accent bg-accent-soft" : "border-line"}`}>
        <Button icon={FilePlus2} disabled={working} onClick={() => void pickMediaFiles("Choose the files to rename").then((p) => (p.length > 0 ? load(p) : undefined))}>
          Choose files
        </Button>
        <Button icon={FolderOpen} disabled={working} onClick={() => void pickFolder("Choose the folder").then((p) => (p ? load([p]) : undefined))}>
          Choose folder
        </Button>
        <span className="text-xs text-muted">or drop them here. {files.length} files added.</span>
        {files.length > 0 && (
          <Button variant="danger" disabled={working} onClick={() => setFiles([])}>
            Clear
          </Button>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Order of the files" htmlFor="rename-sort" hint="Oldest first is the order most tools create files in.">
          <Select id="rename-sort" value={sort} onChange={(event) => setSort(event.target.value as SortBy)}>
            <option value="date">Oldest first</option>
            <option value="name">By file name</option>
          </Select>
        </Field>
        <Field label="First file becomes" htmlFor="rename-start">
          <Select id="rename-start" value={String(start)} onChange={(event) => setStart(Number(event.target.value))}>
            {scenes.map((scene, index) => (
              <option key={scene.id} value={index}>
                {scene.id}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {job && <JobBar job={job} />}
      {error && <ErrorNotice error={error} />}
      {rows.length > 0 && (
        <div className="max-h-72 overflow-auto rounded-xl border border-line" data-testid="rename-preview">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Old name</th>
                <th aria-hidden className="w-6" />
                <th className="px-3 py-2 font-medium">New name</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.file.path} className="border-t border-line">
                  <td className="max-w-0 truncate px-3 py-1.5" title={row.file.path}>
                    {row.file.name}
                  </td>
                  <td className="text-muted">
                    <ArrowRight size={14} aria-hidden />
                  </td>
                  <td className="max-w-0 truncate px-3 py-1.5 font-mono text-xs">
                    {row.newName ?? <span className="text-warning">No scene left for this file</span>}
                    {row.kindMismatch && row.newName && <span className="ml-2 text-warning">(scene planned as {scenes.find((s) => s.id === row.sceneId)?.mediaType})</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={usable.length === 0} loading={working} onClick={() => void confirm()}>
          Make {usable.length} renamed copies
        </Button>
      </div>
    </Modal>
  );
}
