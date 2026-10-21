// Run in the publish job: takes the installers from the downloaded build folders, checks that all
// of them exist, and prepares the folder that is uploaded to the release:
//   - the normal files (spaces in names become dots, as GitHub does),
//   - the five fixed-name copies,
//   - latest.json (written to a separate folder, so it can be uploaded LAST).
// Usage: node scripts/ci/make-release-files.mjs <builds-dir> <out-dir> <latest-dir> <notes-file> <version> <repo>
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { assetName, buildLatestJson, classifyFiles, filesOf, FIXED_NAMES, missingFiles, parsePlatforms } from "../lib/release.mjs";

const [buildsDir, outDir, latestDir, notesFile, version, repo] = process.argv.slice(2);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const platforms = parsePlatforms(process.env.PLATFORMS);
const files = walk(buildsDir);
const byName = new Map(files.map((f) => [basename(f), f]));
const found = classifyFiles([...byName.keys()]);
const missing = missingFiles(found, platforms);
if (missing.length > 0) {
  console.error(`::error::These installers are missing, so nothing is published: ${missing.join(", ")}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
mkdirSync(latestDir, { recursive: true });
for (const key of filesOf(platforms)) copyFileSync(byName.get(found[key]), join(outDir, assetName(found[key])));
for (const key of Object.keys(FIXED_NAMES).filter((k) => found[k] && filesOf(platforms).includes(k))) copyFileSync(byName.get(found[key]), join(outDir, FIXED_NAMES[key]));

const sig = (name) => readFileSync(byName.get(name), "utf8").trim();
const latest = buildLatestJson({
  version,
  notes: readFileSync(notesFile, "utf8").trim(),
  pubDate: new Date().toISOString(),
  repo,
  tag: `v${version}`,
  found,
  platforms,
  signatures: {
    windows: platforms.includes("windows") ? sig(found.windowsSetupSig) : "",
    mac: platforms.includes("mac") ? sig(found.macUpdateSig) : "",
    linux: platforms.includes("linux") ? sig(found.linuxAppImageSig) : "",
  },
});
writeFileSync(join(latestDir, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);
console.log(`Prepared ${readdirSync(outDir).length} files and latest.json for v${version}.`);
