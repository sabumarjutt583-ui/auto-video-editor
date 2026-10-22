import { defaultCatalog, type Catalog } from "./catalog.ts";
import { FAIL, type Ctx, type Issue } from "./parse.ts";
import { specParser, type GraphicSpec } from "./schema.ts";

export { LIMITS, SCHEMA_VERSION, RENDERER_VERSION } from "./limits.ts";
export { defaultCatalog, COUNTRY_CODES, type Catalog } from "./catalog.ts";
export type { Issue } from "./parse.ts";
export * from "./schema.ts";

export type ValidateResult = { ok: true; spec: GraphicSpec } | { ok: false; issues: Issue[] };
export type RepairResult = { ok: true; spec: GraphicSpec; issues: Issue[] } | { ok: false; issues: Issue[] };

function run(input: unknown, repair: boolean, catalog: Catalog): { spec: GraphicSpec | null; issues: Issue[] } {
  const ctx: Ctx = { repair, issues: [], catalog };
  const spec = specParser(input, "", ctx);
  return { spec: spec === FAIL ? null : spec, issues: ctx.issues };
}

/** Strict check: any problem is an error and nothing is changed. */
export function validateSpec(input: unknown, catalog: Catalog = defaultCatalog): ValidateResult {
  const { spec, issues } = run(input, false, catalog);
  return spec && issues.length === 0 ? { ok: true, spec } : { ok: false, issues };
}

/**
 * Repairs what can be repaired (clamps numbers, cuts text, drops unknown fields and broken layers). `issues` lists
 * every change. Fails only when nothing usable is left (no layers, wrong schema version, no duration).
 * The result always passes `validateSpec`.
 */
export function repairSpec(input: unknown, catalog: Catalog = defaultCatalog): RepairResult {
  const first = run(input, true, catalog);
  if (!first.spec) return { ok: false, issues: first.issues };
  const check = run(first.spec, false, catalog);
  if (!check.spec || check.issues.length > 0) return { ok: false, issues: [...first.issues, ...check.issues] };
  return { ok: true, spec: check.spec, issues: first.issues.filter((i) => i.repaired) };
}

/** Short English lines for a person (or for the AI retry message). */
export function describeIssues(issues: Issue[], limit = 8): string {
  const lines = issues.slice(0, limit).map((i) => `${i.path === "" ? "(graphic)" : i.path} ${i.message}`);
  if (issues.length > limit) lines.push(`... and ${issues.length - limit} more`);
  return lines.join("\n");
}
