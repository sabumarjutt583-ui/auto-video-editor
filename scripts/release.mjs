// npm run release -- <patch|minor|major>
// Checks the working tree, bumps the version everywhere, writes the CHANGELOG section,
// commits "Release vX.Y.Z", tags it and pushes the commit and the tag.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { addChangelogSection, bumpVersion, NEW_CHANGELOG, notesToMarkdown, unreleasedNotes } from "./lib/release.mjs";
import { setVersionEverywhere } from "./set-version.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function stop(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const kind = process.argv[2];
if (!["patch", "minor", "major"].includes(kind ?? "")) stop("Use: npm run release -- patch   (or minor, or major)");

if (git("status", "--porcelain") !== "") stop("The working tree is not clean. Commit or stash your changes first.");
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main") stop(`You are on "${branch}". Releases are made from the main branch.`);

const current = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const version = bumpVersion(current, kind);
const tag = `v${version}`;
if (git("tag", "--list", tag) !== "") stop(`The tag ${tag} already exists.`);

const lastTag = git("tag", "--list", "v*", "--sort=-v:refname").split("\n")[0] ?? "";
const reader = createInterface({ input: process.stdin, output: process.stdout, prompt: "> " });
console.log(`Releasing ${current} -> ${version}`);
console.log("Write the release notes, one line per change. Finish with an empty line. (Empty = use the commit messages.)");
const lines = [];
reader.prompt();
for await (const raw of reader) {
  const line = raw.trim();
  if (line === "") break;
  lines.push(line);
  reader.prompt();
}
reader.close();

const changelogPath = join(root, "CHANGELOG.md");
const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : NEW_CHANGELOG;
// Notes already written under "Unreleased" are kept; what you type now is added below them.
let notes = [unreleasedNotes(changelog), notesToMarkdown(lines.join("\n"))].filter(Boolean).join("\n\n");
if (notes === "") {
  const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
  const subjects = git("log", range, "--pretty=%s").split("\n").filter((s) => s && !/^Release v\d/.test(s));
  notes = notesToMarkdown(subjects.join("\n")) || "### Changed\n- Small improvements.";
}

const date = new Date().toISOString().slice(0, 10);
writeFileSync(changelogPath, addChangelogSection(changelog, version, date, notes));

setVersionEverywhere(version);

git("add", "-A");
git("commit", "-m", `Release ${tag}`);
git("tag", "-a", tag, "-m", `Auto Editor ${tag}`);
console.log(git("log", "-1", "--oneline"));
git("push", "origin", branch);
git("push", "origin", tag);
console.log(`\nPushed ${tag}. Open the Actions tab of your source repository to watch the build (10 to 20 minutes).`);
