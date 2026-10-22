import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { readEditor } from "../../editor/model.ts";
import { buildOverlays } from "../../render/request.ts";

const old = JSON.parse(readFileSync(new URL("../../../../tests/fixtures/legacy_project.json", import.meta.url), "utf8")) as { editor: unknown };

describe("projects from before the graphics system", () => {
  it("open: old AI-written graphics are kept and the new fields get their defaults", () => {
    const editor = readEditor(old as Parameters<typeof readEditor>[0]);
    assert.equal(editor.motion.length, 2);
    assert.equal(editor.motion[0]?.kind, undefined);
    assert.equal(editor.motion[0]?.framesDir, "motion/m1/frames");
    assert.equal(editor.audio.graphicSfx, true, "graphic sounds are on by default");
    assert.equal(editor.audio.autoSfx, true);
    assert.equal(editor.brandKitId, "");
    assert.equal(editor.motion[0]?.colors, undefined);
  });

  it("render: the old graphics become the same frame overlays as before (only the ones of the video shape)", () => {
    const editor = readEditor(old as Parameters<typeof readEditor>[0]);
    assert.deepEqual(buildOverlays(editor.motion, 1920, 1080, 20), [{ framesDir: "motion/m1/frames", start: 2, fps: 30 }]);
    assert.deepEqual(buildOverlays(editor.motion, 1080, 1920, 20), [{ framesDir: "motion/m2/frames", start: 8, fps: 30 }]);
  });

  it("a project with no editor data at all opens too", () => {
    const editor = readEditor({ editor: undefined } as unknown as Parameters<typeof readEditor>[0]);
    assert.deepEqual(editor.motion, []);
    assert.equal(editor.audio.graphicSfx, true);
  });
});
