import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { logFrontendError } from "../lib/appUpdate/api";
import { cn } from "../lib/cn";
import { createErrorDeduper, errorLogText } from "../lib/errorLog";
import type { AppError } from "../types";

interface ErrorNoticeProps {
  error: AppError;
}

const notLoggedYet = createErrorDeduper();

/** A friendly error message with a "Details" toggle for the technical text. Every error the person sees is also written to the log, with the page it was on. */
export function ErrorNotice({ error }: ErrorNoticeProps) {
  const [showDetails, setShowDetails] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    if (error.code === "cancelled") return;
    const text = errorLogText(error);
    if (!notLoggedYet(`${pathname}|${text}`)) return;
    void logFrontendError(text, pathname).catch(() => undefined);
  }, [error, pathname]);

  return (
    <div role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-xs">
      <p className="text-fg">{error.message}</p>
      <button
        type="button"
        onClick={() => setShowDetails((open) => !open)}
        aria-expanded={showDetails}
        className="mt-1.5 inline-flex cursor-pointer items-center gap-1 text-muted hover:text-fg"
      >
        <ChevronDown
          size={12}
          aria-hidden
          className={cn("transition-transform", showDetails && "rotate-180")}
        />
        Details
      </button>
      {showDetails && (
        <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted">
          {error.details}
        </pre>
      )}
    </div>
  );
}
