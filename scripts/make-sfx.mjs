// Builds the built-in sound effects with FFmpeg (no downloads, no licences to track):
//   resources/sfx/*.wav  and  resources/sfx/index.json
//
// Every sound is made from a short mathematical recipe (noise, sine sweeps and envelopes), so they are
// small, loop-safe where needed, and free to use. Run again to rebuild them:
//   node scripts/make-sfx.mjs
//
// FFmpeg is taken from src-tauri/binaries (see scripts/fetch-ffmpeg.mjs), or from FFMPEG / PATH.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "resources", "sfx");
const RATE = 44100;

function findTool(name) {
  const fromEnv = process.env[name.toUpperCase()];
  if (fromEnv) return fromEnv;
  const binaries = join(root, "src-tauri", "binaries");
  if (existsSync(binaries)) {
    const hit = readdirSync(binaries).find((f) => f.startsWith(`${name}-`) && !f.endsWith(".gitkeep"));
    if (hit) return join(binaries, hit);
  }
  return name;
}

const ffmpeg = findTool("ffmpeg");

const noise = "(2*random(0)-1)";
const pi2 = "2*PI";

// id, category, tags, seconds, expression, filters, default gain (0 to 1)
const SOUNDS = [
  ["whoosh_soft", "whoosh", ["soft", "slide"], 0.7, `0.9*${noise}*pow(sin(PI*t/0.7),2)`, "highpass=f=250,lowpass=f=2600", 0.8],
  ["whoosh_fast", "whoosh", ["fast", "whip"], 0.4, `0.9*${noise}*pow(sin(PI*t/0.4),2)`, "highpass=f=500,lowpass=f=5000", 0.8],
  ["whoosh_long", "whoosh", ["long", "zoom"], 1.0, `0.9*${noise}*pow(sin(PI*t/1.0),3)`, "highpass=f=180,lowpass=f=3200", 0.75],
  ["hit_deep", "hit", ["deep", "impact"], 0.9, `0.9*sin(${pi2}*(45*t+(40/12)*(1-exp(-12*t))))*exp(-4.5*t)+0.35*${noise}*exp(-35*t)`, "lowpass=f=900", 0.9],
  ["hit_punch", "hit", ["punch", "short"], 0.5, `0.9*sin(${pi2}*(70*t+(90/20)*(1-exp(-20*t))))*exp(-9*t)+0.4*${noise}*exp(-60*t)`, "lowpass=f=1500", 0.9],
  ["hit_boom", "hit", ["boom", "big"], 1.6, `0.9*sin(${pi2}*(38*t+(30/8)*(1-exp(-8*t))))*exp(-2.6*t)+0.3*${noise}*exp(-25*t)`, "lowpass=f=600", 0.9],
  ["pop_bubble", "pop", ["soft", "caption"], 0.15, `0.8*sin(${pi2}*(420*t+(1100/50)*(1-exp(-50*t))))*exp(-28*t)`, "", 0.7],
  ["pop_high", "pop", ["bright", "caption"], 0.12, `0.8*sin(${pi2}*(900*t+(1600/70)*(1-exp(-70*t))))*exp(-38*t)`, "", 0.7],
  ["click_soft", "click", ["soft", "ui"], 0.06, `0.8*${noise}*exp(-260*t)`, "highpass=f=1800,lowpass=f=9000", 0.6],
  ["click_tick", "click", ["tick", "ui"], 0.05, `0.8*sin(${pi2}*3200*t)*exp(-220*t)`, "", 0.6],
  ["riser_noise", "riser", ["noise", "build"], 1.8, `0.8*${noise}*pow(t/1.8,2)`, "highpass=f=400,lowpass=f=7000,afade=t=out:st=1.7:d=0.1", 0.7],
  ["riser_tone", "riser", ["tone", "build"], 2.2, `0.7*sin(${pi2}*(180*t+(260/2)*t*t))*pow(t/2.2,1.5)`, "lowpass=f=5000,afade=t=out:st=2.1:d=0.1", 0.65],
  ["ambience_calm", "ambience", ["calm", "peaceful", "village"], 8, `0.22*${noise}+0.10*sin(${pi2}*110*t)+0.06*sin(${pi2}*165*t)`, "lowpass=f=500,afade=t=in:d=1.5,afade=t=out:st=6.5:d=1.5", 0.35],
  ["ambience_tense", "ambience", ["tense", "dark", "danger"], 8, `0.18*${noise}+0.14*sin(${pi2}*55*t)+0.12*sin(${pi2}*58.5*t)`, "lowpass=f=350,afade=t=in:d=1.5,afade=t=out:st=6.5:d=1.5", 0.35],
  ["ambience_nature", "ambience", ["nature", "forest", "wind"], 8, `0.5*${noise}`, "highpass=f=500,lowpass=f=3500,volume=-1dB,tremolo=f=0.35:d=0.5,afade=t=in:d=1.5,afade=t=out:st=6.5:d=1.5", 0.3],
  ["swell_warm", "soft_swell", ["warm", "major"], 2.8, `0.3*(sin(${pi2}*220*t)+sin(${pi2}*277.2*t)+sin(${pi2}*330*t))*pow(sin(PI*t/2.8),2)`, "lowpass=f=2500", 0.6],
  ["swell_sad", "soft_swell", ["sad", "minor"], 2.8, `0.3*(sin(${pi2}*220*t)+sin(${pi2}*261.6*t)+sin(${pi2}*329.6*t))*pow(sin(PI*t/2.8),2)`, "lowpass=f=2200", 0.6],
  ["transition_impact", "transition", ["whoosh", "hit"], 1.2, `if(lt(t,0.55),0.7*${noise}*pow(t/0.55,2),0.9*sin(${pi2}*(55*(t-0.55)+(40/10)*(1-exp(-10*(t-0.55)))))*exp(-5*(t-0.55))+0.3*${noise}*exp(-40*(t-0.55)))`, "highpass=f=60,lowpass=f=5000", 0.85],
  ["transition_sweep", "transition", ["sweep", "bright"], 0.9, `0.8*${noise}*pow(sin(PI*t/0.9),2)*(0.4+0.6*t/0.9)`, "highpass=f=900,lowpass=f=9000", 0.75],
];

mkdirSync(outDir, { recursive: true });
const index = [];
for (const [id, category, tags, seconds, expression, filters, defaultGain] of SOUNDS) {
  const file = `${id}.wav`;
  const chain = [filters, "alimiter=limit=0.89:level=disabled"].filter(Boolean).join(",");
  execFileSync(
    ffmpeg,
    ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `aevalsrc='${expression}':s=${RATE}:d=${seconds}`, "-af", chain, "-ac", "1", "-c:a", "pcm_s16le", join(outDir, file)],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  // FFmpeg alone: decode to nowhere and read the length from the progress report.
  const report = spawnSync(ffmpeg, ["-hide_banner", "-nostats", "-i", join(outDir, file), "-f", "null", "-progress", "pipe:1", "-"], { encoding: "utf8" }).stdout;
  const micros = [...report.matchAll(/out_time_us=(\d+)/g)].pop();
  const probed = micros ? (Number(micros[1]) / 1e6).toFixed(3) : "0";
  index.push({ id, file, category, tags, duration: Math.round(Number(probed) * 1000) / 1000, defaultGain });
  console.log(`made ${file} (${probed} s)`);
}
writeFileSync(join(outDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
writeFileSync(join(outDir, "package.json"), `${JSON.stringify({ version: 1, date: "2026-10-01", count: index.length }, null, 2)}\n`);
console.log(`Wrote ${index.length} sounds and index.json to ${outDir}`);
