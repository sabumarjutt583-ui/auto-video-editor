// Writes docs/thumbnail-prompts.txt: one line per complete style, `<id>.png | <prompt>`.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { normalizeStyle } = await import("../src/lib/styleChecks.ts");
const { thumbnailPromptsText } = await import("../src/lib/styleThumbnails.ts");
const { isComplete } = await import("../src/lib/styleModel.ts");

const dir = join(process.cwd(), "resources", "styles");
const styles = readdirSync(dir)
  .filter((n) => n.endsWith(".json") && n !== "package.json")
  .sort()
  .map((n) => normalizeStyle(JSON.parse(readFileSync(join(dir, n), "utf8"))))
  .filter(isComplete);
writeFileSync(join(process.cwd(), "docs", "thumbnail-prompts.txt"), thumbnailPromptsText(styles));
console.log(`Wrote docs/thumbnail-prompts.txt (${styles.length} prompts).`);
