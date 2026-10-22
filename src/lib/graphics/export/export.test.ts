import assert from "node:assert/strict";
import { test } from "node:test";

import { repairSpec } from "../spec/index.ts";
import type { GraphicSpec } from "../spec/schema.ts";
import type { ExportApi, GraphicClip } from "./api.ts";
import { ExportCancelled, exportGraphic, type FrameSource } from "./exportGraphic.ts";
import { fontsFor, scriptsOf, textsOf } from "./fonts.ts";

function spec(layers: Record<string, unknown>[], duration = 3): GraphicSpec {
  const r = repairSpec({ schemaVersion: 1, id: "g", duration, layers });
  assert.ok(r.ok);
  return r.spec;
}
const box = { x: 0.1, y: 0.1, w: 0.5, h: 0.2 };

interface Fakes {
  calls: string[];
  sent: number[];
  api: ExportApi;
  source: (failAt?: number) => Promise<FrameSource>;
  inFlight: () => number;
  closed: () => boolean;
}

function fakes(frameSize = 8): Fakes {
  const calls: string[] = [];
  const sent: number[] = [];
  let requested = 0;
  let delivered = 0;
  let maxAhead = 0;
  let closed = false;
  const clip: GraphicClip = { path: "graphics/g/clip.mov", frames: 0, width: 2, height: 2, sizeBytes: 1 };
  const api: ExportApi = {
    start: async (_p, id, w, h, frames) => { calls.push(`start:${id}:${w}x${h}:${frames}`); },
    frame: async (_job, bytes) => { sent.push(bytes[0] ?? -1); delivered++; calls.push("frame"); },
    finish: async () => { calls.push("finish"); return clip; },
    abort: async () => { calls.push("abort"); },
  };
  const source = async (failAt?: number): Promise<FrameSource> => ({
    frame: async (n) => {
      requested++;
      maxAhead = Math.max(maxAhead, requested - delivered);
      if (n === failAt) throw new Error(`frame ${n} failed`);
      const bytes = new Uint8Array(frameSize);
      bytes[0] = n;
      return bytes.buffer;
    },
    close: () => { closed = true; },
  });
  return { calls, sent, api, source, inFlight: () => maxAhead, closed: () => closed };
}

const base = { projectId: "p", graphicId: "g", width: 2, height: 2, jobId: "job-1" };

test("export: sends exactly round(duration * 30) frames in order, then finishes", async () => {
  const f = fakes();
  const s = spec([{ id: "a", type: "shape", box }], 3);
  const clip = await exportGraphic({ ...base, spec: s, api: f.api, createSource: () => f.source() });
  assert.equal(clip.path, "graphics/g/clip.mov");
  assert.equal(f.calls[0], "start:g:2x2:90");
  assert.equal(f.calls.filter((c) => c === "frame").length, 90);
  assert.equal(f.calls[f.calls.length - 1], "finish");
  assert.deepEqual(f.sent, Array.from({ length: 90 }, (_, i) => i), "frames arrive in order, none skipped");
  assert.ok(!f.calls.includes("abort"));
  assert.ok(f.closed());
});

test("export: odd durations round to whole frames", async () => {
  const f = fakes();
  await exportGraphic({ ...base, spec: spec([{ id: "a", type: "shape", box }], 0.34), api: f.api, createSource: () => f.source() });
  assert.equal(f.sent.length, 10);
});

test("export: drawing runs only a few frames ahead", async () => {
  const f = fakes();
  await exportGraphic({ ...base, spec: spec([{ id: "a", type: "shape", box }], 2), api: f.api, createSource: () => f.source(), ahead: 3 });
  assert.ok(f.inFlight() <= 4, `at most ${f.inFlight()} frames drawn but not yet sent`);
});

test("export: a failed frame stops the engine, removes its file and closes the worker", async () => {
  const f = fakes();
  await assert.rejects(exportGraphic({ ...base, spec: spec([{ id: "a", type: "shape", box }]), api: f.api, createSource: () => f.source(20) }), /frame 20 failed/);
  assert.ok(f.calls.includes("abort"));
  assert.ok(!f.calls.includes("finish"));
  assert.ok(f.sent.length <= 20);
  assert.ok(f.closed());
});

test("export: Cancel stops after the current frame and cleans up", async () => {
  const f = fakes();
  let count = 0;
  const api: ExportApi = { ...f.api, frame: async (job, bytes) => { count++; await f.api.frame(job, bytes); } };
  await assert.rejects(
    exportGraphic({ ...base, spec: spec([{ id: "a", type: "shape", box }]), api, createSource: () => f.source(), isCancelled: () => count >= 10 }),
    (error: unknown) => error instanceof ExportCancelled,
  );
  assert.equal(f.sent.length, 10);
  assert.ok(f.calls.includes("abort") && !f.calls.includes("finish") && f.closed());
});

test("export: when the engine refuses to start, the worker is never made and abort is still safe", async () => {
  const f = fakes();
  let made = false;
  const api: ExportApi = { ...f.api, start: async () => { throw new Error("no ffmpeg"); }, abort: async () => { throw new Error("already gone"); } };
  await assert.rejects(exportGraphic({ ...base, spec: spec([{ id: "a", type: "shape", box }]), api, createSource: async () => { made = true; return f.source(); } }), /no ffmpeg/);
  assert.equal(made, false);
});

test("fonts: the fonts a graphic needs follow its writing systems", () => {
  const latin = spec([{ id: "t", type: "text", box, text: "Hello" }]);
  assert.deepEqual(fontsFor(latin).map((f) => f.id), ["noto_sans"]);
  const mixed = spec([
    { id: "a", type: "text", box, text: "안녕하세요" },
    { id: "b", type: "richText", box, runs: [{ text: "नमस्ते" }, { text: "दुनिया" }] },
    { id: "c", type: "lowerThird", box, title: "یہ اردو ہے", subtitle: "日本語のテキスト" },
  ]);
  assert.deepEqual([...fontsFor(mixed).map((f) => f.id)].sort(), ["noto_arabic", "noto_devanagari", "noto_jp", "noto_kr", "noto_sans"]);
  assert.deepEqual([...scriptsOf(mixed)].sort(), ["arabic", "devanagari", "japanese", "korean", "latin"]);
});

test("fonts: every kind of text is collected", () => {
  const s = spec([
    { id: "a", type: "counter", box, to: 5, label: "Users" },
    { id: "b", type: "chart", box, kind: "bar", title: "T", rows: [{ label: "A", value: 1 }] },
    { id: "c", type: "list", box, items: [{ text: "One" }] },
    { id: "d", type: "map", box, pins: [{ name: "Karachi", lat: 24, lon: 67 }] },
  ]);
  assert.deepEqual(textsOf(s).sort(), ["A", "Karachi", "One", "T", "Users"]);
});
