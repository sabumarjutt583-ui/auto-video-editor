// Makes the flag pictures of the motion graphics renderer (one-off, committed output).
//
//   node scripts/build-flags.mjs <flag-icons-package-dir> <chromium-executable>
//
// Every flag of src/lib/graphics/assets/countries.json is drawn from flag-icons (MIT) `flags/4x3/<code>.svg` by a
// headless Chromium on a transparent page at 480x360 and stored as a lossless WebP (system `ffmpeg` with libwebp):
// src/lib/graphics/assets/flags/<a2 lower case>.webp. A raster is used because flag SVGs use clip paths, gradients and
// `use` elements that the Canvas renderer would otherwise need a whole SVG engine for, and a picture keeps preview and
// export identical. Not run by the app or by CI.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [pkg, chrome] = process.argv.slice(2);
if (!pkg || !chrome) throw new Error("usage: node scripts/build-flags.mjs <flag-icons-package-dir> <chromium>");
const assets = path.join(root, "src/lib/graphics/assets");
const outDir = path.join(assets, "flags");
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "flags-"));
const codes = JSON.parse(fs.readFileSync(path.join(assets, "countries.json"), "utf8")).map((c) => c.a2.toLowerCase());
const W = 480;
const H = 360;
let total = 0;
const missing = [];
for (const code of codes) {
  const svg = path.join(pkg, "flags/4x3", `${code}.svg`);
  if (!fs.existsSync(svg)) { missing.push(code); continue; }
  const html = path.join(tmp, `${code}.html`);
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}img{display:block;width:${W}px;height:${H}px}</style><img src="file://${svg}">`);
  const png = path.join(tmp, `${code}.png`);
  // The headless window is taller than the page, so ask for extra height and cut the picture afterwards.
  execFileSync(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000", `--window-size=${W},${H + 200}`, `--screenshot=${png}`, `file://${html}`], { stdio: "ignore" });
  const webp = path.join(outDir, `${code}.webp`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", png, "-vf", `crop=${W}:${H}:0:0`, "-c:v", "libwebp", "-lossless", "1", "-compression_level", "6", webp]);
  total += fs.statSync(webp).size;
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`flags: ${codes.length - missing.length} files, ${(total / 1024).toFixed(0)} kB; no flag file for: ${missing.join(" ") || "none"}`);
