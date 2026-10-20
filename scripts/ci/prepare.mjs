// Run before the builds: checks that the tag and the three version files agree, writes the real
// RELEASES_REPO into src-tauri/tauri.conf.json (replacing the placeholder) and the notes file.
// Usage: node scripts/ci/prepare.mjs <notes-output-file>
// Reads: RELEASES_REPO, GITHUB_REF_TYPE, GITHUB_REF_NAME, GITHUB_OUTPUT
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cargoTomlVersion, changelogSection, PLACEHOLDER } from "../lib/release.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (f) => readFileSync(join(root, f), "utf8");
const fail = (m) => {
  console.error(`::error::${m}`);
  process.exit(1);
};

const versions = {
  "package.json": JSON.parse(read("package.json")).version,
  "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
  "src-tauri/Cargo.toml": cargoTomlVersion(read("src-tauri/Cargo.toml")),
};
const version = versions["package.json"];
if (new Set(Object.values(versions)).size !== 1) fail(`The version differs between files: ${JSON.stringify(versions)}. Run: node scripts/set-version.mjs ${version}`);
if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== `v${version}`) {
  fail(`The tag is ${process.env.GITHUB_REF_NAME} but the files say version ${version}.`);
}

const repo = process.env.RELEASES_REPO;
const confPath = join(root, "src-tauri", "tauri.conf.json");
const conf = readFileSync(confPath, "utf8");
if (conf.includes(PLACEHOLDER)) writeFileSync(confPath, conf.replaceAll(PLACEHOLDER, repo));
else if (!conf.includes(`https://github.com/${repo}/releases/latest/download/latest.json`)) {
  fail(`The updater address in tauri.conf.json does not use ${repo}. Put ${PLACEHOLDER} there, or the same repository as the variable RELEASES_REPO.`);
}

const notes = changelogSection(read("CHANGELOG.md"), version) ?? `Auto Editor v${version}`;
writeFileSync(process.argv[2], `${notes}\n`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
console.log(`Version ${version}. Updater address uses ${repo}.`);
