import { useEffect } from "react";

import { useProjectDir } from "../../../lib/editor/useProjectDir";
import type { Project } from "../../../types";
import { Button } from "../../ui";
import { useBrandKit } from "../brand/useBrandKit";
import { IssueList, summaryOf } from "./QualityPanel";
import { useGraphicQuality } from "./useGraphicQuality";

/** The report shown before a render: it never blocks, it says what is still wrong and can repair the safe things. */
export function RenderCheck({ project }: { project: Project }) {
  const dir = useProjectDir(project.id);
  const brand = useBrandKit(project);
  const view = useGraphicQuality(project, dir, brand.kit, brand.theme);
  const { check } = view;
  useEffect(() => { if (dir) void check(); }, [dir, check]);
  if (!view.report || view.report.issues.length === 0 && !view.checking) return null;
  const sum = summaryOf(view.report);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3" role="region" aria-label="Graphics check">
      <p className="text-sm font-medium">Graphics check: {sum.open === 0 ? "everything is fine" : `${sum.open} problem${sum.open === 1 ? "" : "s"} found`}</p>
      <IssueList report={view.report} />
      {sum.open > 0 && <div><Button onClick={() => void view.fix()} loading={view.checking}>Fix what can be fixed</Button></div>}
    </div>
  );
}
