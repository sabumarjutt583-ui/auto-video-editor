// Downloads LGPL builds of FFmpeg + FFprobe and installs them as Tauri sidecars:
//   src-tauri/binaries/ffmpeg-<target-triple>[.exe]
//   src-tauri/binaries/ffprobe-<target-triple>[.exe]
//
// Source: BtbN/FFmpeg-Builds (stable n8.1 branch, LGPL, static). The download is
// verified against the SHA-256 list published next to the release assets.
//
// Usage:
//   node scripts/fetch-ffmpeg.mjs               always (re)download for this machine
//   node scripts/fetch-ffmpeg.mjs --if-missing  do nothing when both binaries exist
//
// No third-party packages: only Node built-ins plus the system `tar`
// (bsdtar ships with Windows 10+, so it also unpacks the .zip files).

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const RELEASE_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest";

/** target triple -> LGPL build asset (stable 8.1 branch) */
const BUILDS = {
  "x86_64-pc-windows-msvc": { asset: "ffmpeg-n8.1-latest-win64-lgpl-8.1.zip", exe: ".exe" },
  "aarch64-pc-windows-msvc": { asset: "ffmpeg-n8.1-latest-winarm64-lgpl-8.1.zip", exe: ".exe" },
  "x86_64-unknown-linux-gnu": { asset: "ffmpeg-n8.1-latest-linux64-lgpl-8.1.tar.xz", exe: "" },
  "aarch64-unknown-linux-gnu": { asset: "ffmpeg-n8.1-latest-linuxarm64-lgpl-8.1.tar.xz", exe: "" },
};

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binariesDir = join(projectRoot, "src-tauri", "binaries");
const ifMissing = process.argv.includes("--if-missing");

function hostTriple() {
  try {
    const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    const match = out.match(/^host:\s*(\S+)/m);
    if (match) return match[1];
  } catch {
    // rustc not on PATH: fall back to Node's own platform info
  }
  const { platform, arch } = process;
  if (platform === "win32") return arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  if (platform === "darwin") return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  return arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
}

function fail(message) {
  console.error(`\n[ffmpeg] ${message}\n`);
  process.exit(1);
}

async function sha256(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status} ${response.statusText}) for ${url}`);
  }
  const total = Number(response.headers.get("content-length") ?? 0);
  let received = 0;
  let lastPercent = -10;
  const source = Readable.fromWeb(response.body);
  source.on("data", (chunk) => {
    received += chunk.length;
    if (total > 0) {
      const percent = Math.floor((received / total) * 100);
      if (percent >= lastPercent + 10) {
        lastPercent = percent;
        console.log(`[ffmpeg]   ${percent}%`);
      }
    }
  });
  await pipeline(source, createWriteStream(destination));
}

function findFile(directory, fileName) {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      const found = findFile(full, fileName);
      if (found) return found;
    } else if (entry === fileName && dirname(full).endsWith("bin")) {
      return full;
    }
  }
  return null;
}

async function main() {
  const triple = hostTriple();
  const build = BUILDS[triple];
  const targets = ["ffmpeg", "ffprobe"].map((name) => ({
    name,
    destination: join(binariesDir, `${name}-${triple}${build?.exe ?? ""}`),
  }));

  if (ifMissing && targets.every((t) => existsSync(t.destination))) return;

  if (!build) {
    fail(
      `No automatic LGPL FFmpeg download is available for "${triple}".\n` +
        `Place LGPL builds manually at:\n  ${targets.map((t) => t.destination).join("\n  ")}`,
    );
  }

  const workDir = mkdtempSync(join(tmpdir(), "ave-ffmpeg-"));
  try {
    const archive = join(workDir, build.asset);
    console.log(`[ffmpeg] Downloading ${build.asset} ...`);
    await download(`${RELEASE_URL}/${build.asset}`, archive);

    console.log("[ffmpeg] Verifying checksum ...");
    const listing = await (await fetch(`${RELEASE_URL}/checksums.sha256`)).text();
    const line = listing.split("\n").find((l) => l.trim().endsWith(build.asset));
    const expected = line?.trim().split(/\s+/)[0]?.toLowerCase();
    if (!expected) throw new Error(`No checksum published for ${build.asset}`);
    const actual = await sha256(archive);
    if (actual !== expected) throw new Error(`Checksum mismatch for ${build.asset}`);

    console.log("[ffmpeg] Unpacking ...");
    const extractDir = join(workDir, "unpacked");
    mkdirSync(extractDir);
    execFileSync("tar", ["-xf", archive, "-C", extractDir], { stdio: "inherit" });

    mkdirSync(binariesDir, { recursive: true });
    for (const { name, destination } of targets) {
      const source = findFile(extractDir, `${name}${build.exe}`);
      if (!source) throw new Error(`${name}${build.exe} not found inside ${build.asset}`);
      copyFileSync(source, destination);
      if (build.exe === "") chmodSync(destination, 0o755);
      console.log(`[ffmpeg] Installed ${destination}`);
    }
  } catch (error) {
    fail(`Could not set up FFmpeg: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

await main();
