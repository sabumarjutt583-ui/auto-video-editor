// Prints a table (style name, status, problems), then runs the style tests.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { BANNED_NAMES, formatReportTable, normalizeStyle, reportStyles } = await import("../src/lib/styleChecks.ts");

const dir = join(process.cwd(), "resources", "styles");
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".json") && name !== "package.json")
  .sort()
  .map((fileName) => ({ fileName, style: normalizeStyle(JSON.parse(readFileSync(join(dir, fileName), "utf8"))) }));

console.log(formatReportTable(reportStyles(files, BANNED_NAMES)));
const { thumbnailWarnings } = await import("../src/lib/styleThumbnails.ts");
const thumbDir = join(dir, "thumbnails");
const pictures = new Set(existsSync(thumbDir) ? readdirSync(thumbDir) : []);
const warnings = thumbnailWarnings(files.map((f) => f.style), pictures);
console.log(warnings.length === 0 ? "\nThumbnails: all present." : `\nWARNING (not an error):\n${warnings.map((w) => `  - ${w}`).join("\n")}`);
console.log("\nRunning the style tests…\n");
const result = spawnSync(process.execPath, ["--test", "--test-reporter=spec", "src/lib/styleProfiles.test.ts"], { stdio: "inherit" });
process.exit(result.status ?? 1);
