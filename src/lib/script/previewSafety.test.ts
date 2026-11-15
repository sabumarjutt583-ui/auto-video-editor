import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultProfile } from "../pipeline/profile.ts";
import { copyScriptPreviewText, scriptPreviewKey } from "./previewSafety.ts";

const channel = () => {
  const profile = defaultProfile("channel-a", "Example");
  profile.script = { writer: "claude", masterPrompt: "Intro\nRules", claudeAccountId: null };
  profile.language = "en";
  return profile;
};
const video = () => ({ title: "Title", topic: "Topic", wordCountText: "1100", script: "" });

test("SW-02C-01 same channel and video inputs give a stable preview key", () => {
  assert.equal(scriptPreviewKey(channel(), video()), scriptPreviewKey(channel(), video()));
  assert.equal(scriptPreviewKey(channel(), video()).length, 64);
});

test("SW-02C-02 channel switching and returning changes the mounted instance key", () => {
  const profile = channel();
  const keyA = scriptPreviewKey(profile, video());
  const keyB = scriptPreviewKey({ ...profile, id: "channel-b", script: { ...profile.script, masterPrompt: "Other rules" } }, video());
  assert.notEqual(keyA, keyB);
  assert.equal(scriptPreviewKey(profile, video()), keyA);
  // React's key remount semantics ensure the A->B->A sequence creates a fresh instance.
});

test("SW-02C-03 master prompt, language, writer, account and disabled channel alter identity", () => {
  const base = channel();
  const key = scriptPreviewKey(base, video());
  const changed = [
    { ...base, language: "ko" },
    { ...base, script: { ...base.script, writer: "off" as const } },
    { ...base, script: { ...base.script, masterPrompt: "Edited rules" } },
    { ...base, script: { ...base.script, claudeAccountId: "different-account" } },
  ];
  for (const profile of changed) assert.notEqual(scriptPreviewKey(profile, video()), key);
  assert.notEqual(scriptPreviewKey(null, video()), key);
});

test("SW-02C-04 any Step 0 editable field invalidates the preview identity", () => {
  const key = scriptPreviewKey(channel(), video());
  for (const input of [
    { ...video(), title: "Other" }, { ...video(), topic: "Other" },
    { ...video(), wordCountText: "1200" }, { ...video(), script: "User narration" },
  ]) assert.notEqual(scriptPreviewKey(channel(), input), key);
});

test("SW-02C-05 secrets and master prompt content do not appear literally in the React key", () => {
  const profile = channel();
  profile.script.masterPrompt = "Confidential channel prompt";
  profile.script.claudeAccountId = "private-account";
  const key = scriptPreviewKey(profile, video());
  assert.doesNotMatch(key, /Confidential|private-account|channel-a/);
});

test("SW-02C-06 successful Clipboard API writes the exact requested prompt without fallback", async () => {
  let written = "";
  let fallbackCalled = false;
  const result = await copyScriptPreviewText("Legacy\n한국어 🎬", {
    writeText: async (text) => { written = text; },
  }, () => { fallbackCalled = true; return false; });
  assert.equal(result, "copied");
  assert.equal(written, "Legacy\n한국어 🎬");
  assert.equal(fallbackCalled, false);
});

test("SW-02C-07 unavailable WebView Clipboard API attempts the selected textarea fallback", async () => {
  let calls = 0;
  const result = await copyScriptPreviewText("New prompt", undefined, () => { calls++; return true; });
  assert.equal(result, "copied");
  assert.equal(calls, 1);
});

test("SW-02C-08 rejected Clipboard API tries a fallback, with no false success", async () => {
  const clipboard = { writeText: async (_text: string) => { throw new Error("Denied"); } };
  assert.equal(await copyScriptPreviewText("Prompt", clipboard, () => true), "copied");
  assert.equal(await copyScriptPreviewText("Prompt", clipboard, () => false), "manual");
  assert.equal(await copyScriptPreviewText("Prompt", clipboard, () => { throw new Error("Blocked"); }), "manual");
});

test("SW-02C-09 unavailable Clipboard API and failed fallback require manual copy", async () => {
  assert.equal(await copyScriptPreviewText("A", undefined, () => false), "manual");
});

test("SW-02C-10 comparisons remain non-sending; helper has no Tauri or network dependence", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("Unexpected network"); }) as typeof fetch;
  try {
    assert.ok(scriptPreviewKey(channel(), video()));
    assert.equal(await copyScriptPreviewText("text", undefined, () => true), "copied");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
