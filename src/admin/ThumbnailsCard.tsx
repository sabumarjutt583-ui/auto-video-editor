import { FileText, Image as ImageIcon, Upload } from "lucide-react";
import { useState } from "react";

import { ErrorNotice } from "../components/ErrorNotice";
import { Button, Card } from "../components/ui";
import { pickPictureFiles, pickSavePath } from "../lib/dialog";
import { toAppError } from "../lib/errors";
import { writeTextFile } from "../lib/files";
import { useFileDrop } from "../lib/useFileDrop";
import { isComplete } from "../lib/styleModel";
import { matchThumbnailFiles, thumbnailPromptsText } from "../lib/styleThumbnails";
import { useStyleStore } from "../store/styleStore";
import type { AppError } from "../types";
import { adminImportThumbnails, type ThumbnailImportReport } from "./api";

interface Report extends ThumbnailImportReport {
  unmatched: string[];
  duplicates: string[];
}

/** Export the prompts for the thumbnail pictures, and import the finished pictures. */
export function ThumbnailsCard() {
  const styles = useStyleStore((state) => state.styles);
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);

  async function exportPrompts() {
    setError(null);
    setNotice(null);
    try {
      const path = await pickSavePath("Export thumbnail prompts", "thumbnail-prompts.txt", "TXT", ["txt"]);
      if (!path) return;
      const usable = styles.filter(isComplete);
      await writeTextFile(path, thumbnailPromptsText(usable));
      setNotice(`Saved ${usable.length} prompts to ${path}`);
    } catch (caught) {
      setError(toAppError(caught, "The prompts could not be saved."));
    }
  }

  async function importFiles(files: string[]) {
    const pictures = files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
    if (pictures.length === 0 || busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const matches = matchThumbnailFiles(pictures, styles.map((s) => s.id));
      const result = await adminImportThumbnails(matches.matched.map((m) => ({ id: m.id, path: m.file })));
      setReport({ ...result, unmatched: matches.unmatched, duplicates: matches.duplicates });
      await useStyleStore.getState().load();
    } catch (caught) {
      setError(toAppError(caught, "The thumbnails could not be imported."));
    } finally {
      setBusy(false);
    }
  }

  const { over } = useFileDrop((paths) => void importFiles(paths), true);

  return (
    <Card title="Style thumbnails" description="Make the 480×360 pictures for the Style Gallery. Export the prompts, make the pictures with an image tool, name each file after its style id, then import them all at once." icon={ImageIcon}>
      {error && <ErrorNotice error={error} />}
      <div className="flex flex-wrap gap-2">
        <Button icon={FileText} onClick={() => void exportPrompts()}>
          Export thumbnail prompts
        </Button>
        <Button icon={Upload} disabled={busy} onClick={() => void pickPictureFiles("Choose the thumbnail pictures").then(importFiles)}>
          {busy ? "Importing…" : "Import thumbnails"}
        </Button>
      </div>
      <p className={`mt-3 rounded-xl border border-dashed px-4 py-3 text-sm ${over ? "border-accent text-fg" : "border-line text-muted"}`}>Or drop many pictures (PNG, JPG, WebP) on this window.</p>
      {notice && <p className="mt-3 text-sm text-muted">{notice}</p>}
      {report && (
        <div className="mt-3 flex flex-col gap-2 text-sm" aria-live="polite">
          <p>Imported: {report.imported.length}</p>
          {report.failed.length > 0 && <p>Could not convert: {report.failed.map(([name, why]) => `${name} (${why})`).join(", ")}</p>}
          {report.unmatched.length > 0 && <p>No style with this name: {report.unmatched.join(", ")}</p>}
          {report.duplicates.length > 0 && <p>Skipped (same style twice): {report.duplicates.join(", ")}</p>}
          <p>{report.missing.length === 0 ? "Every style has a thumbnail." : `Still missing (${report.missing.length}): ${report.missing.join(", ")}`}</p>
        </div>
      )}
    </Card>
  );
}
