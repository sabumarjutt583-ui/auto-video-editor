import { CHECKS } from "./checks.ts";
import type { GraphicItem, Issue, QualityEnv, QualityReport } from "./types.ts";

const ROUNDS = 3;

/**
 * Runs every check on every graphic. With `fix`, what can be repaired safely is repaired (up to three rounds, because one repair can
 * show another problem) and the changed graphics are returned so they can be drawn again; the rest stays in the report as warnings.
 */
export function checkGraphics(graphics: readonly GraphicItem[], env: QualityEnv, options: { fix: boolean } = { fix: false }): QualityReport {
  let current = graphics.map((g) => g);
  const fixedIssues: Issue[] = [];
  const changed = new Set<string>();
  if (options.fix) {
    for (let round = 0; round < ROUNDS; round++) {
      let any = false;
      for (let i = 0; i < current.length; i++) {
        for (const check of CHECKS) {
          const item = current[i] as GraphicItem;
          const found = check.run(item, env, current).find((f) => f.fix);
          const repaired = found?.fix?.();
          if (found && repaired) {
            current[i] = repaired;
            changed.add(item.id);
            any = true;
            fixedIssues.push({ graphicId: item.id, sceneId: item.sceneId, check: check.id, severity: found.severity, message: found.message, fixed: true });
          }
        }
      }
      if (!any) break;
    }
  }
  const issues: Issue[] = [...fixedIssues];
  for (const item of current) {
    for (const check of CHECKS) {
      for (const found of check.run(item, env, current)) issues.push({ graphicId: item.id, sceneId: item.sceneId, check: check.id, severity: found.severity, message: found.message, fixed: false });
    }
  }
  return { issues, changed: current.filter((g) => changed.has(g.id)) };
}

/** Graphic id -> its worst open issue, for the warning badges. */
export function badgesOf(report: QualityReport): Map<string, Issue> {
  const out = new Map<string, Issue>();
  for (const issue of report.issues) {
    if (issue.fixed) continue;
    const old = out.get(issue.graphicId);
    if (!old || (issue.severity === "error" && old.severity !== "error")) out.set(issue.graphicId, issue);
  }
  return out;
}
