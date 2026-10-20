import { Download, X } from "lucide-react";

import { shortNotes } from "../../lib/appUpdate/schedule";

import { selectJob, useJobStore } from "../../store/jobStore";
import { useAppUpdateStore } from "../../store/appUpdateStore";
import { ErrorNotice } from "../ErrorNotice";
import { Button } from "../ui";
import { JobBar } from "../voice/JobBar";

/** "A new version is ready": shown at the top of every page until it is installed or dismissed. */
export function AppUpdateBanner() {
  const { available, dismissed, installing, error, blockedBy, install, cancelBlocking, dismiss } = useAppUpdateStore();
  const job = useJobStore(selectJob(["app-update"]));
  if (!available || (dismissed && !installing && !error)) return null;
  return (
    <div className="flex flex-col gap-3 border-b border-line bg-accent-soft px-6 py-3" role="status" data-testid="app-update-banner">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 text-sm">
          <p>
            <strong>Version {available.version} is available</strong> (you have {available.current}). Your projects are not touched by an update.
          </p>
          {shortNotes(available.notes) !== "" && <p className="mt-0.5 text-muted">{shortNotes(available.notes)}</p>}
        </div>
        <Button variant="primary" icon={Download} loading={installing} onClick={() => void install()}>
          Update now
        </Button>
        {!installing && (
          <Button icon={X} onClick={dismiss}>
            Later
          </Button>
        )}
      </div>
      {blockedBy.length > 0 && !installing && (
        <div className="flex flex-wrap items-center gap-3 text-sm" role="alert">
          <p className="flex-1">A task is still running ({blockedBy.map((j) => j.stage).join(", ")}). Please wait until it is finished, or cancel it, then press Update now again.</p>
          <Button onClick={cancelBlocking}>Cancel the running task</Button>
        </div>
      )}
      {job && <JobBar job={job} />}
      {error && <ErrorNotice error={error} />}
    </div>
  );
}
