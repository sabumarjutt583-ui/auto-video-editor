import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CaptionStyle } from "../../../types/editor.ts";
import type { AspectRatio } from "../../../types/settings.ts";
import { repairSpec } from "../spec/index.ts";
import type { GraphicSpec } from "../spec/schema.ts";
import { area, captionZone, coveredArea, findSubject, inflate, inside, iou, isClear, mainExtent, MIN_SCALE, overlap, parseSubjects, placeGraphic, safeArea, sourceToFrame, touches, withCameraMove, type Box } from "./index.ts";

const ASPECTS: AspectRatio[] = ["16:9", "9:16", "1:1"];
const STYLE = (position: CaptionStyle["position"], preset: CaptionStyle["preset"] = "clean"): Pick<CaptionStyle, "preset" | "position" | "fontSize"> => ({ preset, position, fontSize: 5 });
const SAFE = safeArea({ x: 0.05, y: 0.05 });

function card(box: Box): GraphicSpec {
  const made = repairSpec({
    schemaVersion: 1, id: "g", duration: 3,
    layers: [
      { type: "shape", id: "plate", shape: "rect", box, start: 0 },
      { type: "text", id: "t", text: "45 %", box: { x: box.x + box.w * 0.1, y: box.y + box.h * 0.1, w: box.w * 0.8, h: box.h * 0.8 }, start: 0, size: 0.08 },
    ],
  });
  assert.ok(made.ok, JSON.stringify(made));
  return made.spec;
}

/** A grey picture: a dark, softly lit background with one bright, detailed subject at a known place. */
function frame(subject: Box, width = 96, height = 54): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inSubject = x / width >= subject.x && x / width < subject.x + subject.w && y / height >= subject.y && y / height < subject.y + subject.h;
      const noise = ((x * 7 + y * 13) % 5) * 2;
      gray[y * width + x] = inSubject ? 200 + ((x + y) % 2) * 40 : 30 + noise + Math.round((x / width) * 10);
    }
  }
  return gray;
}

describe("zones", () => {
  it("the caption zone sits where the captions are, for every shape", () => {
    for (const aspect of ASPECTS) {
      const bottom = captionZone(STYLE("bottom"), aspect);
      const top = captionZone(STYLE("top"), aspect);
      const middle = captionZone(STYLE("middle"), aspect);
      assert.ok(bottom && top && middle);
      assert.ok(bottom.y > 0.6 && bottom.y + bottom.h <= 1, aspect);
      assert.ok(top.y < 0.2 && top.y + top.h < 0.4, aspect);
      assert.ok(Math.abs(middle.y + middle.h / 2 - 0.5) < 0.01, aspect);
      for (const z of [bottom, top, middle]) assert.ok(inside(z, { x: 0, y: 0, w: 1, h: 1 }), aspect);
    }
    // Vertical video keeps captions higher (phone buttons) and bigger.
    assert.ok((captionZone(STYLE("bottom"), "9:16") as Box).y + (captionZone(STYLE("bottom"), "9:16") as Box).h < 0.9);
  });
  it("no captions, no zone", () => assert.equal(captionZone(STYLE("bottom", "none"), "16:9"), null));
  it("the safe area is the frame without the margins", () => {
    assert.deepEqual(safeArea({ x: 0.1, y: 0.05 }), { x: 0.1, y: 0.05, w: 0.8, h: 0.9 });
    assert.equal(safeArea({ x: 5, y: -1 }).x, 0.2);
  });
});

describe("subject finding", () => {
  it("finds the box of a synthetic subject", () => {
    for (const known of [{ x: 0.3, y: 0.2, w: 0.3, h: 0.6 }, { x: 0.6, y: 0.3, w: 0.25, h: 0.5 }, { x: 0.1, y: 0.1, w: 0.25, h: 0.4 }]) {
      const found = findSubject(frame(known), 96, 54);
      assert.ok(found, JSON.stringify(known));
      assert.ok(iou(found.box, known) > 0.4, `${JSON.stringify(known)} -> ${JSON.stringify(found.box)}`);
      assert.ok(overlap(found.box, known) / area(known) > 0.85);
    }
  });
  it("a flat picture has no subject, and the answer is repeatable", () => {
    assert.equal(findSubject(new Uint8Array(96 * 54).fill(80), 96, 54), null);
    assert.deepEqual(findSubject(frame({ x: 0.3, y: 0.2, w: 0.3, h: 0.6 }), 96, 54), findSubject(frame({ x: 0.3, y: 0.2, w: 0.3, h: 0.6 }), 96, 54));
  });
});

describe("AI subjects", () => {
  it("reads boxes and faces, clamps them and ignores nonsense", () => {
    const ok = parseSubjects('Here: {"pictures":[{"n":1,"subject":{"x":0.2,"y":0.1,"w":0.4,"h":0.7},"faces":[{"x":0.7,"y":0.1,"w":0.1,"h":0.1}]},{"n":2,"subject":null},{"n":9,"subject":{"x":0,"y":0,"w":1,"h":1}},{"n":3,"subject":{"x":-5,"y":0.5,"w":9,"h":0.2}}]}', 3);
    assert.equal(ok.size, 2);
    const first = ok.get(1);
    assert.ok(first && first.box.x === 0.2 && Math.abs(first.box.x + first.box.w - 0.8) < 1e-9);
    const third = ok.get(3);
    assert.ok(third && inside(third.box, { x: 0, y: 0, w: 1, h: 1 }));
    assert.equal(parseSubjects("not json", 2).size, 0);
  });
});

describe("mapping", () => {
  it("a wide picture cropped to a tall frame moves the box out of the frame's middle", () => {
    const framed = sourceToFrame({ x: 0.4, y: 0.2, w: 0.2, h: 0.6 }, { width: 1920, height: 1080 }, { width: 1080, height: 1920 }, "crop");
    assert.ok(framed.w > 1 || framed.x < 0.4, JSON.stringify(framed));
    const same = sourceToFrame({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, { width: 1920, height: 1080 }, { width: 1920, height: 1080 }, "crop");
    assert.deepEqual(same, { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    const contained = sourceToFrame({ x: 0, y: 0, w: 1, h: 1 }, { width: 1920, height: 1080 }, { width: 1080, height: 1920 }, "blur");
    assert.ok(contained.h < 0.4 && Math.abs(contained.y + contained.h / 2 - 0.5) < 1e-9);
  });
  it("the camera move changes where the subject is over time", () => {
    const box = { x: 0.6, y: 0.4, w: 0.2, h: 0.2 };
    const start = withCameraMove(box, "zoom_in", 0);
    const end = withCameraMove(box, "zoom_in", 1);
    assert.ok(iou(start, box) > 0.999);
    assert.ok(end.x > start.x && end.w > start.w);
    const pan = withCameraMove(box, "pan_left", 1);
    assert.ok(pan.x < withCameraMove(box, "pan_left", 0).x);
  });
});

describe("placement solver", () => {
  const big = card({ x: 0.55, y: 0.25, w: 0.4, h: 0.4 });
  it("keeps a graphic that is already free", () => {
    const r = placeGraphic({ spec: big, subjects: [{ x: 0.05, y: 0.2, w: 0.3, h: 0.6 }], caption: captionZone(STYLE("bottom"), "16:9"), safe: SAFE });
    assert.equal(r.action, "kept");
    assert.equal(r.spec, big);
  });
  it("moves a graphic away from the subject, to the opposite side", () => {
    const subject = { x: 0.5, y: 0.15, w: 0.35, h: 0.6 };
    const r = placeGraphic({ spec: big, subjects: [subject], caption: captionZone(STYLE("bottom"), "16:9"), safe: SAFE });
    assert.ok(r.spec && r.action !== "skipped");
    assert.equal(coveredArea(r.spec, [subject]), 0);
    const e = mainExtent(r.spec) as Box;
    assert.ok(e.x + e.w / 2 < 0.5, `moved to the side of the subject: ${JSON.stringify(e)}`);
  });
  it("never covers the subject, the captions or the margins, in 16:9, 9:16 and 1:1, at any caption position", () => {
    const subjects: Box[] = [{ x: 0.3, y: 0.2, w: 0.4, h: 0.5 }, { x: 0.05, y: 0.1, w: 0.3, h: 0.7 }, { x: 0.6, y: 0.5, w: 0.35, h: 0.45 }, { x: 0.35, y: 0.3, w: 0.3, h: 0.3 }];
    for (const aspect of ASPECTS) {
      for (const position of ["bottom", "middle", "top"] as const) {
        const caption = captionZone(STYLE(position), aspect);
        for (const subject of subjects) {
          for (const start of [card({ x: 0.1, y: 0.1, w: 0.5, h: 0.3 }), card({ x: 0.3, y: 0.6, w: 0.4, h: 0.3 }), big]) {
            const r = placeGraphic({ spec: start, subjects: [subject], caption, safe: SAFE });
            if (r.action === "skipped") continue;
            assert.ok(r.spec);
            const e = mainExtent(r.spec) as Box;
            const where = `${aspect} ${position} ${JSON.stringify(subject)} -> ${JSON.stringify(e)}`;
            assert.equal(touches(e, inflate(subject, 0.015)), false, `subject: ${where}`);
            if (caption) assert.equal(touches(e, caption), false, `caption: ${where}`);
            assert.ok(inside(e, SAFE), `margins: ${where}`);
            assert.ok(isClear(r.spec, { subjects: [subject], caption, safe: SAFE }));
          }
        }
      }
    }
  });
  it("end to end: a synthetic frame with a known subject, found by the saliency map, is never covered", () => {
    for (const aspect of ASPECTS) {
      const known = { x: 0.35, y: 0.25, w: 0.3, h: 0.5 };
      const found = findSubject(frame(known), 96, 54);
      assert.ok(found);
      const r = placeGraphic({ spec: card({ x: 0.3, y: 0.3, w: 0.4, h: 0.35 }), subjects: [found.box], caption: captionZone(STYLE("bottom"), aspect), safe: SAFE });
      assert.notEqual(r.action, "skipped");
      assert.equal(coveredArea(r.spec as GraphicSpec, [known]), 0, aspect);
    }
  });
  it("a moving camera: both the start and the end box are kept clear", () => {
    const box = { x: 0.55, y: 0.3, w: 0.2, h: 0.3 };
    const a = withCameraMove(box, "zoom_in", 0);
    const b = withCameraMove(box, "zoom_in", 1);
    const r = placeGraphic({ spec: big, subjects: [a, b], caption: null, safe: SAFE });
    assert.ok(r.spec);
    assert.equal(coveredArea(r.spec, [a, b]), 0);
  });
  it("shrinks when it only fits smaller, never below half size", () => {
    const wide = card({ x: 0.05, y: 0.05, w: 0.9, h: 0.45 });
    const subject = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };
    const r = placeGraphic({ spec: wide, subjects: [subject], caption: captionZone(STYLE("bottom"), "16:9"), safe: SAFE });
    if (r.spec) {
      assert.ok(r.scale >= MIN_SCALE);
      assert.equal(coveredArea(r.spec, [subject]), 0);
    } else assert.equal(r.action, "skipped");
  });
  it("uses the compact version when the full one has no room, else skips and says why", () => {
    const fullCard = card({ x: 0.05, y: 0.05, w: 0.9, h: 0.6 });
    const subject = { x: 0.05, y: 0.05, w: 0.9, h: 0.6 };
    const caption = captionZone(STYLE("bottom"), "16:9");
    const compact = card({ x: 0.1, y: 0.75, w: 0.12, h: 0.06 });
    const withCompact = placeGraphic({ spec: fullCard, subjects: [subject], caption: null, safe: SAFE, compact });
    assert.equal(withCompact.action, "compact");
    assert.ok(withCompact.spec && coveredArea(withCompact.spec, [subject]) === 0);
    const none = placeGraphic({ spec: fullCard, subjects: [{ x: 0, y: 0, w: 1, h: 1 }], caption, safe: SAFE });
    assert.equal(none.action, "skipped");
    assert.equal(none.spec, null);
    assert.match(none.reason, /no free place/);
  });
  it("is repeatable, and layers that fill the frame (dimming, particles) stay where they are", () => {
    const made = repairSpec({ schemaVersion: 1, id: "g", duration: 3, layers: [
      { type: "shape", id: "dim", shape: "rect", box: { x: 0, y: 0, w: 1, h: 1 }, start: 0, opacity: 0.3 },
      { type: "text", id: "t", text: "Hello", box: { x: 0.3, y: 0.4, w: 0.4, h: 0.2 }, start: 0 },
    ] });
    assert.ok(made.ok);
    const input = { spec: made.spec, subjects: [{ x: 0.25, y: 0.3, w: 0.5, h: 0.4 }], caption: null, safe: SAFE };
    const a = placeGraphic(input);
    assert.deepEqual(a, placeGraphic(input));
    assert.ok(a.spec);
    assert.deepEqual(a.spec.layers[0]?.box, { x: 0, y: 0, w: 1, h: 1 });
    assert.equal(coveredArea(a.spec, input.subjects), 0);
  });
});

describe("placeAll", () => {
  it("places each graphic, drops those without room, and notes why", async () => {
    const { placeAll } = await import("./index.ts");
    const items = [
      { sceneId: "S01", start: 0, duration: 3, spec: card({ x: 0.55, y: 0.25, w: 0.4, h: 0.4 }) },
      { sceneId: "S02", start: 0, duration: 3, spec: card({ x: 0.3, y: 0.3, w: 0.4, h: 0.4 }) },
      { sceneId: "S03", start: 0, duration: 3, spec: card({ x: 0.05, y: 0.05, w: 0.9, h: 0.6 }) },
    ];
    const full: Box = { x: 0, y: 0, w: 1, h: 1 };
    const out = placeAll(items, {
      caption: captionZone(STYLE("bottom"), "16:9"), safe: SAFE,
      subjectsFor: (i) => (i.sceneId === "S01" ? [] : i.sceneId === "S02" ? [{ x: 0.3, y: 0.2, w: 0.4, h: 0.6 }] : [full]),
    });
    assert.equal(out.notes.length, 3);
    assert.deepEqual(out.notes.map((n) => n.action).slice(0, 1), ["kept"]);
    assert.equal(out.notes[2]?.action, "skipped");
    assert.equal(out.placed.length, 2);
    assert.equal(out.placed[0], items[0]);
  });
});

describe("subjects on screen", () => {
  it("a picture follows the camera, a clip follows its preview frames", async () => {
    const { subjectsOnScreen } = await import("./index.ts");
    const base = { source: { width: 1920, height: 1080 }, frame: { width: 1920, height: 1080 }, motion: "zoom_in" as const, fit: "crop" as const, from: 0.2, to: 0.8 };
    const image = subjectsOnScreen({ ...base, kind: "image", boxes: [{ x: 0.6, y: 0.3, w: 0.2, h: 0.3 }] });
    assert.equal(image.length, 2);
    assert.ok((image[1] as Box).w > (image[0] as Box).w);
    const clip = subjectsOnScreen({ ...base, kind: "video", boxes: [{ x: 0.1, y: 0.2, w: 0.2, h: 0.3 }, { x: 0.4, y: 0.2, w: 0.2, h: 0.3 }, { x: 0.7, y: 0.2, w: 0.2, h: 0.3 }] });
    assert.ok((clip[0] as Box).x < 0.2 && (clip[1] as Box).x > 0.6);
    assert.deepEqual(subjectsOnScreen({ ...base, kind: "image", boxes: [] }), []);
  });
});
