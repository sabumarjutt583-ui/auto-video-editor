import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, Wrench } from "lucide-react";

import type { Issue, QualityReport } from "../../../lib/graphics/quality";
import { requestCancel } from "../../../store/jobStore";
import { ErrorNotice } from "../../ErrorNotice";
import { Button } from "../../ui";
import type { QualityView } from "./useGraphicQuality";

const TITLES: Record<Issue["check"], string> = {
  fit: "Text fit", contrast: "Contrast", reading: "Reading time", font: "Font", glyph: "Missing letters",
  placement: "Placement", overlap: "Overlap", timing: "Timing",
};

export function summaryOf(report: QualityReport): { open: number; errors: number; fixed: number } {
  const open = report.issues.filter((i) => !i.fixed);
  return { open: open.length, errors: open.filter((i) => i.severity === "error").length, fixed: report.issues.filter((i) => i.fixed).length };
}

/** The list of problems, each with the graphic's scene, and what was repaired by itself. */
export function IssueList({ report }: { report: QualityReport }) {
  if (report.issues.length === 0) return <p className="flex items-center gap-1.5 text-xs text-muted"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden />All graphics passed the checks.</p>;
  return (
    <ul className="flex flex-col gap-1 text-xs" aria-label="Graphic problems">
      {report.issues.map((i, k) => (
        <li key={`${i.graphicId}-${i.check}-${k}`} className="flex items-start gap-1.5">
          {i.fixed ? <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden /> : <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${i.severity === "error" ? "text-danger" : "text-warning"}`} aria-hidden />}
          <span><strong>{i.sceneId}</strong> · {TITLES[i.check]}: {i.message}{i.fixed ? " (repaired)" : ""}</span>
        </li>
      ))}
    </ul>
  );
}

/** "Check graphics": reads every graphic for the problems of phase 9 and can repair the safe ones. */
export function QualityPanel({ view }: { view: QualityView }) {
  const busy = view.checking || view.job !== null;
  const sum = view.report ? summaryOf(view.report) : null;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3" aria-label="Graphic quality">
      <h4 className="text-sm font-semibold">Quality check</h4>
      <p className="text-xs text-muted">Checks text fit, contrast against the picture, reading time, fonts and missing letters, the captions and the subject, overlaps and timing. What is safe is repaired; the rest is listed.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={ShieldCheck} loading={busy} onClick={() => void view.check()}>Check graphics</Button>
        <Button icon={Wrench} disabled={busy} onClick={() => void view.fix()}>Fix what can be fixed</Button>
        {view.job && <Button onClick={() => requestCancel(view.job?.id ?? "")}>Cancel</Button>}
      </div>
      {view.job && <p role="status" className="flex items-center gap-2 text-xs text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />{view.job.stage}</p>}
      {sum && !busy && <p className="text-xs text-muted" role="status">{sum.open === 0 ? "No open problems" : `${sum.open} open problem${sum.open === 1 ? "" : "s"}${sum.errors > 0 ? ` (${sum.errors} serious)` : ""}`}{sum.fixed > 0 ? `, ${sum.fixed} repaired` : ""}.</p>}
      {view.report && !busy && <IssueList report={view.report} />}
      {view.error && <ErrorNotice error={view.error} />}
    </div>
  );
}
