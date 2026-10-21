import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addChangelogSection, assetName, buildLatestJson, bumpVersion, cargoTomlVersion, changelogSection, classifyFiles, missingFiles, parsePlatforms,
  NEW_CHANGELOG, notesToMarkdown, setCargoLockVersion, setCargoTomlVersion, unreleasedNotes, validRepo,
} from "./lib/release.mjs";

test("bumpVersion", () => {
  assert.equal(bumpVersion("0.1.9", "patch"), "0.1.10");
  assert.equal(bumpVersion("0.1.9", "minor"), "0.2.0");
  assert.equal(bumpVersion("1.4.2", "major"), "2.0.0");
  assert.throws(() => bumpVersion("1.2", "patch"));
  assert.throws(() => bumpVersion("1.2.3", "huge"));
});

test("cargo files", () => {
  const toml = '[package]\nname = "x"\nversion = "0.1.0"\n[dependencies]\nfoo = { version = "1" }\n';
  assert.equal(cargoTomlVersion(toml), "0.1.0");
  assert.equal(setCargoTomlVersion(toml, "0.2.0"), toml.replace("0.1.0", "0.2.0"));
  const lock = '[[package]]\nname = "auto-video-editor"\nversion = "0.1.0"\n\n[[package]]\nname = "other"\nversion = "0.1.0"\n';
  const out = setCargoLockVersion(lock, "auto-video-editor", "0.3.0");
  assert.match(out, /name = "auto-video-editor"\nversion = "0.3.0"/);
  assert.match(out, /name = "other"\nversion = "0.1.0"/);
});

test("changelog sections are added and read back", () => {
  let log = addChangelogSection(NEW_CHANGELOG, "0.1.0", "2026-10-20", "### Added\n- First version");
  log = addChangelogSection(log, "0.2.0", "2026-11-01", notesToMarkdown("Better captions\n- Faster render"));
  assert.match(log, /## \[Unreleased\]\n\n## \[0\.2\.0\] - 2026-11-01[\s\S]*## \[0\.1\.0\]/);
  assert.equal(changelogSection(log, "0.2.0"), "### Changed\n- Better captions\n- Faster render");
  assert.equal(changelogSection(log, "0.1.0"), "### Added\n- First version");
  assert.equal(changelogSection(log, "9.9.9"), null);
  assert.throws(() => addChangelogSection(log, "0.2.0", "2026-11-02", "x"));
});

test("unreleased notes move into the new section", () => {
  const log = "# Changelog\n\n## [Unreleased]\n\n### Fixed\n- A bug\n\n## [0.1.0] - 2026-01-01\n\n- Old\n";
  const out = addChangelogSection(log, "0.1.1", "2026-02-01", "### Fixed\n- A bug");
  assert.equal(changelogSection(out, "0.1.1"), "### Fixed\n- A bug");
});

const names = [
  "Auto Video Editor_0.2.0_x64-setup.exe", "Auto Video Editor_0.2.0_x64-setup.exe.sig", "Auto Video Editor_0.2.0_x64_en-US.msi",
  "Auto Video Editor_0.2.0_universal.dmg", "Auto Video Editor.app.tar.gz", "Auto Video Editor.app.tar.gz.sig",
  "Auto Video Editor_0.2.0_amd64.AppImage", "Auto Video Editor_0.2.0_amd64.AppImage.sig", "Auto Video Editor_0.2.0_amd64.deb",
];

test("files are recognised and missing ones are reported", () => {
  const found = classifyFiles(names);
  assert.deepEqual(missingFiles(found), []);
  assert.equal(found.windowsSetupSig, "Auto Video Editor_0.2.0_x64-setup.exe.sig");
  assert.equal(found.macUpdate, "Auto Video Editor.app.tar.gz");
  assert.deepEqual(missingFiles(classifyFiles(names.filter((n) => !n.endsWith(".deb")))), ["linuxDeb"]);
});

test("latest.json has all platforms with dotted asset names", () => {
  const json = buildLatestJson({
    version: "0.2.0", notes: "Hi", pubDate: "2026-10-20T00:00:00Z", repo: "me/releases", tag: "v0.2.0",
    found: classifyFiles(names), signatures: { windows: "W", mac: "M", linux: "L" },
  });
  assert.deepEqual(Object.keys(json.platforms), ["windows-x86_64", "darwin-aarch64", "darwin-x86_64", "linux-x86_64"]);
  assert.equal(json.platforms["windows-x86_64"].url, "https://github.com/me/releases/releases/download/v0.2.0/Auto.Video.Editor_0.2.0_x64-setup.exe");
  assert.equal(json.platforms["darwin-aarch64"].signature, "M");
  assert.equal(json.platforms["darwin-x86_64"].url, json.platforms["darwin-aarch64"].url);
  assert.equal(assetName("a b  c"), "a.b.c");
});

test("repo names", () => {
  assert.equal(validRepo("me/autoeditor-releases"), true);
  assert.equal(validRepo("autoeditor"), false);
  assert.equal(validRepo(""), false);
  assert.equal(validRepo("<RELEASES_REPO>"), false);
});

test("notes under Unreleased can be read", () => {
  const log = "# Changelog\n\n## [Unreleased]\n\n### Fixed\n- A bug\n\n## [0.1.0] - 2026-01-01\n\n- Old\n";
  assert.equal(unreleasedNotes(log), "### Fixed\n- A bug");
  assert.equal(unreleasedNotes(NEW_CHANGELOG), "");
});

test("a Windows-only release needs only the Windows files and lists only Windows in latest.json", () => {
  assert.deepEqual(parsePlatforms("windows"), ["windows"]);
  assert.deepEqual(parsePlatforms(""), ["windows", "mac", "linux"]);
  assert.deepEqual(parsePlatforms("all"), ["windows", "mac", "linux"]);
  assert.throws(() => parsePlatforms("amiga"));
  const found = classifyFiles(["App_0.3.0_x64-setup.exe", "App_0.3.0_x64-setup.exe.sig", "App_0.3.0_x64_en-US.msi"]);
  assert.deepEqual(missingFiles(found, ["windows"]), []);
  assert.ok(missingFiles(found).length > 0, "all platforms still need every file");
  const json = buildLatestJson({ version: "0.3.0", notes: "n", pubDate: "d", repo: "o/r", tag: "v0.3.0", found, signatures: { windows: "sig", mac: "", linux: "" }, platforms: ["windows"] });
  assert.deepEqual(Object.keys(json.platforms), ["windows-x86_64"]);
});
