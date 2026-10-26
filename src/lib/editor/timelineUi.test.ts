import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyScene } from "../scenes/assemble.ts";
import type { Scene } from "../../types/project.ts";
import {
  arrowTarget,
  clampZoom,
  dragMoved,
  fitZoom,
  MAX_PIXELS_PER_SECOND,
  MIN_PIXELS_PER_SECOND,
  sceneIndexAt,
} from "./timeline.ts";

// Logic-level tests only: the Timeline component, useTimelineDrag and
// useEditorKeys are React hooks and are not rendered here (no DOM harness
// in this repo). The functions tested below are the exact pure functions
// those hooks call — dragMoved is used by useTimelineDrag, arrowTarget is
// used by useEditorKeys, and clampZoom/fitZoom/sceneIndexAt are used by
// Timeline — so a change to the drag, arrow-key or zoom behaviour that
// goes through these functions is caught here. Pointer handling, React
// state and actual DOM rendering are NOT covered by this file.

function scene(index: number, start: number, end: number): Scene {
  return { ...emptyScene(), id: `S${String(index).padStart(2, "0")}`, index, start, end, duration: end - start };
}

const SCENES = [scene(1, 0, 5), scene(2, 5, 10), scene(3, 10, 15)];

test("clampZoom and fitZoom: the zoom slider and Fit button in Timeline", () => {
  assert.equal(clampZoom(1), MIN_PIXELS_PER_SECOND);
  assert.equal(clampZoom(4), 4);
  assert.equal(clampZoom(40), 40);
  assert.equal(clampZoom(400), 400);
  assert.equal(clampZoom(10000), MAX_PIXELS_PER_SECOND);
  assert.equal(fitZoom(0, 800), 40);
  assert.equal(fitZoom(100, 8000), 80);
  assert.equal(fitZoom(10, 10000), 400, "fit zoom is clamped to the maximum");
  assert.equal(fitZoom(1000, 100), 4, "fit zoom is clamped to the minimum");
});

test("dragMoved: the 4-pixel threshold in useTimelineDrag", () => {
  assert.equal(dragMoved(100, 100), false);
  assert.equal(dragMoved(100, 104), false, "exactly 4 px is still a click, not a drag");
  assert.equal(dragMoved(100, 105), true);
  assert.equal(dragMoved(100, 96), false, "4 px to the left is still a click");
  assert.equal(dragMoved(100, 95), true);
  assert.equal(dragMoved(100, 105, 10), false, "a larger threshold needs a larger move");
});

test("arrowTarget: ArrowRight and ArrowLeft in useEditorKeys", () => {
  assert.deepEqual(arrowTarget(SCENES, 2, 15, "ArrowRight"), { kind: "scene", index: 1, start: 5 });
  assert.deepEqual(arrowTarget(SCENES, 6, 15, "ArrowLeft"), { kind: "scene", index: 1, start: 5 }, "more than 0.5 s into a scene stays in it");
  assert.deepEqual(arrowTarget(SCENES, 5.2, 15, "ArrowLeft"), { kind: "scene", index: 0, start: 0 }, "0.2 s into a scene goes back");
  assert.deepEqual(arrowTarget(SCENES, 5.5, 15, "ArrowLeft"), { kind: "scene", index: 0, start: 0 }, "exactly 0.5 s goes back, the rule is strictly greater");
  assert.deepEqual(arrowTarget(SCENES, 14, 15, "ArrowRight"), { kind: "seek", time: 15 }, "past the last scene seeks to the voice end");
  assert.deepEqual(arrowTarget(SCENES, 0, 15, "ArrowLeft"), { kind: "seek", time: 0 }, "before the first scene seeks to 0");
  assert.deepEqual(arrowTarget([], 2, 15, "ArrowRight"), { kind: "seek", time: 15 });
  assert.deepEqual(arrowTarget([], 2, 15, "ArrowLeft"), { kind: "seek", time: 0 });
});

test("sceneIndexAt: edge times used by the playhead and arrow keys", () => {
  assert.equal(sceneIndexAt(SCENES, -1), 0);
  assert.equal(sceneIndexAt(SCENES, 0), 0);
  assert.equal(sceneIndexAt(SCENES, 5), 1, "a time on a boundary belongs to the scene starting there");
  assert.equal(sceneIndexAt(SCENES, 15), 2);
  assert.equal(sceneIndexAt(SCENES, 999), 2);
  assert.equal(sceneIndexAt([], 1), -1);
});
