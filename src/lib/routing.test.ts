import assert from "node:assert/strict";
import { test } from "node:test";

import { autoEditorGate } from "./autoEditorGate.ts";
import { DEFAULT_PATH, NAV_ITEMS } from "./nav.ts";
import { QUICK_ID } from "./quick/textScenes.ts";

// Logic-level tests only: HashRouter, AppShell and the pages themselves
// are React components and are not rendered here (no DOM harness in this
// repo). What is tested here is the exact data and gating logic those
// components use: NAV_ITEMS / DEFAULT_PATH from nav.ts (the sidebar data
// and the index redirect target in App.tsx) and autoEditorGate (the exact
// gating logic of AutoEditorPage). The JSX route list in App.tsx itself
// (/channels/:id, /make-video redirect, /admin conditional route, * fallback)
// is NOT data and is therefore NOT covered by this file — it was checked
// by reading App.tsx, not by a test.

// --- Navigation data (nav.ts, used by the sidebar and App.tsx) ---

test("DEFAULT_PATH stays /projects even though Dashboard is now first in the sidebar", () => {
  // The default route is deliberately unchanged: opening the app still lands on Projects,
  // Dashboard is reached from the sidebar. So NAV_ITEMS[0] is no longer DEFAULT_PATH.
  assert.equal(DEFAULT_PATH, "/projects");
  assert.equal(NAV_ITEMS[0]?.path, "/dashboard");
});

test("NAV_ITEMS lists the eight main pages in sidebar order, without Admin in a user build", () => {
  // In node --test, import.meta.env is undefined, so the Admin item is
  // absent — exactly as in a user build, where VITE_ADMIN is not "true".
  assert.deepEqual(
    NAV_ITEMS.map((item) => item.path),
    ["/dashboard", "/projects", "/channels", "/prompt-generator", "/image-generator", "/auto-editor", "/sfx-library", "/settings"],
  );
  assert.deepEqual(
    NAV_ITEMS.map((item) => item.label),
    ["Dashboard", "Projects", "Channels", "Prompt Generator", "Image Generator", "Auto Editor", "SFX Library", "Settings"],
  );
  assert.ok(NAV_ITEMS.every((item) => item.path.startsWith("/")));
  assert.equal(new Set(NAV_ITEMS.map((item) => item.path)).size, NAV_ITEMS.length, "no duplicate nav paths");
  assert.ok(!NAV_ITEMS.some((item) => item.path === "/admin"), "Admin is not a nav item in a user build");
});

// --- Auto Editor gating (AutoEditorPage, via autoEditorGate) ---

function project(id: string, sceneCount: number) {
  return { id, scenes: Array.from({ length: sceneCount }, (_, i) => ({ id: `S0${i + 1}` })) };
}

test("autoEditorGate: no project shows the open-a-project guide", () => {
  assert.deepEqual(autoEditorGate(null), {
    ok: false,
    message: "Open a project first. The Auto Editor builds the video from the scenes of a project.",
  });
  assert.deepEqual(autoEditorGate(undefined), {
    ok: false,
    message: "Open a project first. The Auto Editor builds the video from the scenes of a project.",
  });
});

test("autoEditorGate: a Quick project shows the save-as-project guide, never the editor", () => {
  assert.equal(QUICK_ID, "quick-session");
  assert.deepEqual(autoEditorGate(project(QUICK_ID, 3)), {
    ok: false,
    message: "Quick prompts has no editor. Press 'Save as project' in the Prompt Generator first, then come back here.",
  });
});

test("autoEditorGate: a project with no scenes shows the build-scenes guide", () => {
  assert.deepEqual(autoEditorGate(project("prj_abc", 0)), {
    ok: false,
    message: "This project has no scenes yet. Build the scenes in the Prompt Generator first, then come back here.",
  });
});

test("autoEditorGate: a real project with scenes opens the editor", () => {
  assert.deepEqual(autoEditorGate(project("prj_abc", 1)), { ok: true });
  assert.deepEqual(autoEditorGate(project("prj_abc", 5)), { ok: true });
});
