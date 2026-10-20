// Pure helpers for the release scripts (no file or network access, so they can be tested).

export const PLACEHOLDER = "<RELEASES_REPO>";

/** "0.1.9" + "patch" -> "0.1.10". */
export function bumpVersion(version, kind) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`"${version}" is not a version like 1.2.3`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Use patch, minor or major (got "${kind}")`);
}

/** Replaces the version of the [package] section of a Cargo.toml. */
export function setCargoTomlVersion(text, version) {
  if (!/^version = "[^"]+"/m.test(text)) throw new Error("Cargo.toml has no version line");
  return text.replace(/^version = "[^"]+"/m, `version = "${version}"`);
}

/** Replaces the version of one package inside Cargo.lock. */
export function setCargoLockVersion(text, name, version) {
  const pattern = new RegExp(`(\\[\\[package\\]\\]\\nname = "${name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}"\\nversion = ")[^"]+(")`);
  return pattern.test(text) ? text.replace(pattern, `$1${version}$2`) : text;
}

/** Reads the version of the [package] section of a Cargo.toml. */
export function cargoTomlVersion(text) {
  return /^version = "([^"]+)"/m.exec(text)?.[1] ?? null;
}

const HEADING = /^## \[?([^\]\s]+)\]?(?:\s+-\s+(.*))?\s*$/;

/** The text of one version's section of CHANGELOG.md (without its heading), or null. */
export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => HEADING.exec(line)?.[1] === version);
  if (start < 0) return null;
  let end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end);
  // Link reference lines at the very end of the file belong to no section.
  while (body.length > 0 && (body[body.length - 1].trim() === "" || /^\[[^\]]+\]:\s/.test(body[body.length - 1]))) body.pop();
  while (body.length > 0 && body[0].trim() === "") body.shift();
  const text = body.join("\n");
  return text === "" ? null : text;
}

/** The notes written under "Unreleased" (empty text when there are none). */
export function unreleasedNotes(changelog) {
  return changelogSection(changelog.replace(/^## \[?Unreleased\]?.*$/im, "## [Unreleased]"), "Unreleased") ?? "";
}

/** Turns plain note lines into a "### Changed" list (lines that already start with "-" or "*" are kept). */
export function notesToMarkdown(notes) {
  const lines = notes.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return "";
  if (lines.some((l) => l.startsWith("#"))) return lines.join("\n");
  return `### Changed\n${lines.map((l) => (/^[-*]\s/.test(l) ? `- ${l.slice(2)}` : `- ${l}`)).join("\n")}`;
}

/** Adds a section for `version` below the "Unreleased" part (or below the intro when there is none). */
export function addChangelogSection(changelog, version, date, body) {
  if (changelogSection(changelog, version) !== null || new RegExp(`^## \\[?${version.replace(/\./g, "\\.")}\\]?`, "m").test(changelog)) {
    throw new Error(`CHANGELOG.md already has a section for ${version}`);
  }
  const section = `## [${version}] - ${date}\n\n${body.trim()}\n`;
  const lines = changelog.replace(/\r?\n/g, "\n").split("\n");
  const unreleased = lines.findIndex((l) => /^## \[?Unreleased\]?/i.test(l));
  if (unreleased >= 0) {
    // Everything under Unreleased moves into the new section, so Unreleased is empty again.
    const next = lines.findIndex((l, i) => i > unreleased && /^## /.test(l));
    const tail = next < 0 ? [] : lines.slice(next);
    return [...lines.slice(0, unreleased + 1), "", section.trimEnd(), "", ...tail].join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n*$/, "\n");
  }
  const first = lines.findIndex((l) => /^## /.test(l));
  const head = first < 0 ? lines : lines.slice(0, first);
  const tail = first < 0 ? [] : lines.slice(first);
  return [...head, section.trimEnd(), "", ...tail].join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n*$/, "\n");
}

export const NEW_CHANGELOG = `# Changelog

All notable changes to Auto Video Editor are written here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the version numbers follow [Semantic Versioning](https://semver.org/).

## [Unreleased]
`;

/** The fixed download names for the website, by the kind of installer. */
export const FIXED_NAMES = {
  windowsSetup: "AutoEditor-windows-x64-setup.exe",
  windowsMsi: "AutoEditor-windows-x64.msi",
  macDmg: "AutoEditor-macos-universal.dmg",
  linuxAppImage: "AutoEditor-linux-x64.AppImage",
  linuxDeb: "AutoEditor-linux-x64.deb",
};

/** GitHub turns spaces in asset names into dots. We do the same so the names in latest.json are right. */
export function assetName(fileName) {
  return fileName.replace(/\s+/g, ".");
}

/**
 * Finds the installers and signatures in a list of file names (base names).
 * Returns the base name of each, or null when missing.
 */
export function classifyFiles(names) {
  const find = (re) => names.find((n) => re.test(n)) ?? null;
  return {
    windowsSetup: find(/-setup\.exe$/),
    windowsSetupSig: find(/-setup\.exe\.sig$/),
    windowsMsi: find(/\.msi$/),
    macDmg: find(/\.dmg$/),
    macUpdate: find(/\.app\.tar\.gz$/),
    macUpdateSig: find(/\.app\.tar\.gz\.sig$/),
    linuxAppImage: find(/\.AppImage$/),
    linuxAppImageSig: find(/\.AppImage\.sig$/),
    linuxDeb: find(/\.deb$/),
  };
}

/** Names of the files that must exist before a release may be published. */
export function missingFiles(found) {
  const need = ["windowsSetup", "windowsSetupSig", "windowsMsi", "macDmg", "macUpdate", "macUpdateSig", "linuxAppImage", "linuxAppImageSig", "linuxDeb"];
  return need.filter((key) => !found[key]);
}

/** The latest.json of the Tauri updater. `signatures` maps a platform to the text inside its .sig file. */
export function buildLatestJson({ version, notes, pubDate, repo, tag, found, signatures }) {
  const base = `https://github.com/${repo}/releases/download/${tag}`;
  const url = (name) => `${base}/${encodeURIComponent(assetName(name))}`;
  const mac = { signature: signatures.mac, url: url(found.macUpdate) };
  return {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      "windows-x86_64": { signature: signatures.windows, url: url(found.windowsSetup) },
      "darwin-aarch64": mac,
      "darwin-x86_64": { ...mac },
      "linux-x86_64": { signature: signatures.linux, url: url(found.linuxAppImage) },
    },
  };
}

/** Checks that a value looks like owner/name. */
export function validRepo(value) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/.test(value ?? "");
}
