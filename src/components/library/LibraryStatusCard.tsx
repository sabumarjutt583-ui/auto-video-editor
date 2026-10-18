import { Download, Undo2 } from "lucide-react";

import { KIND_LABEL } from "../../lib/library/text";
import { selectJob, useJobStore } from "../../store/jobStore";
import { useLibraryStore } from "../../store/libraryStore";
import { useSettingsStore } from "../../store/settingsStore";
import { ErrorNotice } from "../ErrorNotice";
import { Button } from "../ui";
import { JobBar } from "../voice/JobBar";

/** Which version of the sounds and styles is in use, with "Check for library update" and rollback. */
export function LibraryStatusCard() {
  const { status, checking, message, error, check, rollback } = useLibraryStore();
  const job = useJobStore(selectJob(["library"]));
  const url = useSettingsStore((s) => s.settings?.libraryUpdateUrl ?? "");
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 shadow-card" data-testid="library-status">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Library updates</h2>
          <p className="text-xs text-muted">New sounds and styles can arrive without a new app version.</p>
        </div>
        <Button icon={Download} loading={checking} onClick={() => void check(false)} disabled={url === ""}>
          Check for library update
        </Button>
      </div>
      {url === "" && <p className="text-xs text-muted">No update address is set yet. Add it in Settings under Library updates.</p>}
      <ul className="flex flex-col gap-1 text-sm">
        {status.map((s) => (
          <li key={s.kind} className="flex flex-wrap items-center gap-2" data-testid={`library-${s.kind}`}>
            <span className="font-medium">{KIND_LABEL[s.kind]}:</span>
            <span>version {s.version}</span>
            <span className="text-muted">({s.source === "downloaded" ? "downloaded" : "built in"}{s.date ? `, ${s.date}` : ""}{s.count ? `, ${s.count}` : ""})</span>
            {s.hasPrevious && (
              <Button icon={Undo2} onClick={() => void rollback(s.kind)} disabled={checking}>
                Go back to the version before
              </Button>
            )}
          </li>
        ))}
      </ul>
      {job && <JobBar job={job} />}
      {message && <p className="text-sm" role="status" data-testid="library-message">{message}</p>}
      {error && <ErrorNotice error={error} />}
    </section>
  );
}
