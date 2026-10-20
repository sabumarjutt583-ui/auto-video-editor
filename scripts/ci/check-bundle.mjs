// Looks inside a finished installer and FAILS when source code or secrets would be shipped.
//   node scripts/ci/check-bundle.mjs <installer-or-package> [more files...]
// Supported: Windows setup .exe and .msi (7-Zip), Linux .AppImage and .deb, macOS .app.tar.gz.
// It also prints a size table (as workflow notices) so the size of every part is visible.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";

const FORBIDDEN_FILE = [
  [/\.tsx?$/i, "TypeScript source"],
  [/\.rs$/i, "Rust source"],
  [/\.map$/i, "source map"],
  [/(^|\/)\.env[^/]*$/i, "environment file"],
  [/\.key$/i, "private key"],
  [/\.pem$/i, "private key / certificate"],
];
const FORBIDDEN_DIR = [[/^src$/i, "src folder"], [/^node_modules$/i, "node_modules folder"], [/^\.git$/i, "git folder"], [/^tests?$/i, "tests folder"], [/^docs?$/i, "docs folder"]];

// Third-party system files inside Linux packages: usr/share/* and usr/lib/* except the app's own folder.
// Only the folder-name rules skip them; the file rules (.ts .rs .map .env .key) apply everywhere.
function isSystemPath(rel) {
  const parts = rel.split("/");
  const at = parts.indexOf("usr");
  if (at < 0) return false;
  const area = parts[at + 1];
  const own = /auto[ _-]?video[ _-]?editor/i.test(parts[at + 2] ?? "");
  return (area === "share" || area === "lib") && !own;
}

function notice(text) {
  console.log(process.env.GITHUB_ACTIONS ? `::notice::${text}` : text);
}
function fail(text) {
  console.error(process.env.GITHUB_ACTIONS ? `::error::${text}` : text);
  process.exit(1);
}

function sevenZip() {
  for (const name of ["7z", "7zz", "7za", "C:\\Program Files\\7-Zip\\7z.exe"]) {
    try {
      execFileSync(name, ["i"], { stdio: "ignore" });
      return name;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

function unpack(file, target) {
  const name = file.toLowerCase();
  if (name.endsWith(".exe") || name.endsWith(".msi")) {
    const tool = sevenZip();
    if (!tool) fail("7-Zip is needed to look inside the Windows installer, but it was not found.");
    execFileSync(tool, ["x", "-y", `-o${target}`, file], { stdio: ["ignore", "ignore", "pipe"] });
    // The NSIS installer holds the program files in an inner archive only on some versions; 7-Zip already lists them.
  } else if (name.endsWith(".appimage")) {
    execFileSync("chmod", ["+x", file]);
    execFileSync(file, ["--appimage-extract"], { cwd: target, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: "1" } });
  } else if (name.endsWith(".deb")) {
    execFileSync("dpkg-deb", ["-x", file, target]);
  } else if (name.endsWith(".tar.gz")) {
    execFileSync("tar", ["-xzf", file, "-C", target]);
  } else {
    fail(`Do not know how to open ${basename(file)}.`);
  }
}

function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    visit(full, entry.isDirectory());
    if (entry.isDirectory()) walk(full, visit);
  }
}

const megabytes = (bytes) => (bytes / 1e6).toFixed(1);

let failed = false;
for (const file of process.argv.slice(2).map((f) => resolve(f))) {
  if (!existsSync(file)) fail(`${file} does not exist.`);
  const work = mkdtempSync(join(tmpdir(), "ave-bundle-"));
  const target = join(work, "x");
  mkdirSync(target);
  try {
    unpack(file, target);
  } catch (error) {
    const text = error instanceof Error ? `${error.message}\n${String(error.stderr ?? "")}` : String(error);
    fail(`Could not open ${basename(file)}: ${text.slice(0, 1500).replace(/\n/g, " | ")}`);
  }

  const problems = [];
  const groups = new Map();
  let files = 0;
  walk(target, (full, isDir) => {
    const rel = relative(target, full).split("\\").join("/");
    if (isDir) {
      // Linux packages carry system libraries (GTK, WebKit ...) with their own doc/test/src folders: those are not ours.
      const hit = isSystemPath(rel) ? null : FORBIDDEN_DIR.find(([re]) => re.test(basename(full)));
      if (hit) problems.push(`${rel}/  (${hit[1]})`);
      return;
    }
    files += 1;
    const keyPub = /\.key\.pub$/i.test(rel);
    const hit = keyPub ? null : FORBIDDEN_FILE.find(([re]) => re.test(rel));
    if (hit) problems.push(`${rel}  (${hit[1]})`);
    const size = statSync(full).size;
    const lower = rel.toLowerCase();
    const group = /ffmpeg/.test(lower) ? "ffmpeg" : /fonts?\//.test(lower) || /\.(otf|ttf)$/.test(lower) ? "fonts" : /sfx\//.test(lower) ? "sfx" : /styles\//.test(lower) ? "styles (+thumbnails)" : /\.(exe|so|dll|dylib)$/.test(lower) || !/\./.test(basename(lower)) ? "program / libraries" : "other";
    groups.set(group, (groups.get(group) ?? 0) + size);
  });

  notice(`${basename(file)}: ${megabytes(statSync(file).size)} MB packed, ${files} files inside`);
  for (const [group, size] of [...groups].sort((a, b) => b[1] - a[1])) notice(`  inside ${basename(file)}: ${group} ${megabytes(size)} MB (unpacked)`);
  if (problems.length > 0) {
    failed = true;
    console.error(process.env.GITHUB_ACTIONS ? `::error::${basename(file)} contains files that must not be shipped: ${problems.slice(0, 20).join("; ")}` : `${basename(file)} contains files that must not be shipped:\n  ${problems.join("\n  ")}`);
  } else {
    console.log(`OK: ${basename(file)} has no source code, source maps, environment files or private keys.`);
  }
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
