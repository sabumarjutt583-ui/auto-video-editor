import { Download, X } from "lucide-react";

import { selectJob, useJobStore } from "../../store/jobStore";
import { useAppUpdateStore } from "../../store/appUpdateStore";
import { ErrorNotice } from "../ErrorNotice";
import { Button } from "../ui";
import { JobBar } from "../voice/JobBar";

/** "A new version is ready": shown at the top of every page until it is installed or dismissed. */
export function AppUpdateBanner() {
  const { available, dismissed, installing, error, install, dismiss } = useAppUpdateStore();
  const job = useJobStore(selectJob(["app-update"]));
  if (!available || (dismissed && !installing && !error)) return null;
  return (
    <div className="flex flex-col gap-3 border-b border-line bg-accent-soft px-6 py-3" role="status" data-testid="app-update-banner">
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm">
          <strong>Version {available.version}</strong> is ready (you have {available.current}). Your projects are not touched by an update.
        </p>
        <Button variant="primary" icon={Download} loading={installing} onClick={() => void install()}>
          Update now
        </Button>
        {!installing && (
          <Button icon={X} onClick={dismiss}>
            Later
          </Button>
        )}
      </div>
      {job && <JobBar job={job} />}
      {error && <ErrorNotice error={error} />}
    </div>
  );
}
