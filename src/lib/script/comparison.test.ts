import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultProfile, readProfile } from "../pipeline/profile.ts";
import { buildScriptQuestion } from "./prompt.ts";
import { buildStep0Question, recordFromProject, resolveStep0 } from "./step0.ts";
import { compareScriptPromptFormats } from "./comparison.ts";
import type { LegacyScriptVideoInput, LegacyScriptAdapterContext } from "./compatibility.ts";

function channel(id = "channel-a", masterPrompt = "  Write calm, detailed stories.\nRetain the pauses.  ") {
  const profile = defaultProfile(id, "Story Channel");
  profile.language = "en";
  profile.script = { writer: "claude", masterPrompt, claudeAccountId: "personal-account" };
  return profile;
}
const video = (patch: Partial<LegacyScriptVideoInput> = {}): LegacyScriptVideoInput =>
  ({ title: "Why people trust money", topic: "Human motivation", wordCount: 1200, ...patch });
const context = (patch: Partial<LegacyScriptAdapterContext> = {}): LegacyScriptAdapterContext =>
  ({ requestId: "comparison-01", expectedChannelId: "channel-a", ...patch });

function good(profile: unknown = channel(), input: unknown = video(), ctx: unknown = context()) {
  const result = compareScriptPromptFormats(profile, input, ctx);
  assert.equal(result.ok, true, JSON.stringify(result.validation.errors));
  if (!result.ok) throw new Error("Expected valid comparison");
  return result;
}
function blocked(profile: unknown, input: unknown, ctx: unknown, field: string) {
  const result = compareScriptPromptFormats(profile, input, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.legacyPrompt, null);
  assert.equal(result.newPrompt, null);
  assert.equal(result.validation.valid, false);
  assert.ok(result.report.problems.some((finding) => finding.field === field), JSON.stringify(result.report.problems));
  return result;
}

test("SW-02B-01 both formats are prepared from the same validated legacy profile and input", () => {
  const profile = channel();
  const result = good(profile);
  assert.equal(result.legacyPrompt, buildStep0Question(profile.script.masterPrompt, "Why people trust money", "Human motivation", 1200));
  assert.equal(result.newPrompt, result.request.masterPrompt.content ? result.newPrompt : "");
  assert.equal(result.report.channelId, profile.id);
  assert.equal(result.report.requestId, "comparison-01");
  assert.notEqual(result.legacyPrompt, result.newPrompt);
});

test("SW-02B-02 title-only input generates both prompts and reports the exact title", () => {
  const result = good(channel(), { title: "A title only", topic: "" });
  assert.equal(result.report.title, "A title only");
  assert.equal(result.report.topic, "");
  assert.match(result.legacyPrompt, /TITLE OF THIS VIDEO:\nA title only/);
  assert.match(result.newPrompt, /"title": "A title only"/);
});

test("SW-02B-03 topic-only and legacy name=topic derivation do not add a duplicate title", () => {
  const result = good(channel(), { name: "Ancient humans", topic: "Ancient humans" });
  assert.equal(result.report.title, "");
  assert.equal(result.report.topic, "Ancient humans");
  assert.match(result.legacyPrompt, /TOPIC OF THIS VIDEO:\nAncient humans/);
  assert.doesNotMatch(result.legacyPrompt, /TITLE OF THIS VIDEO/);
  assert.match(result.newPrompt, /"title": ""/);
});

test("SW-02B-04 empty title/topic blocks both prompts", () => {
  const result = blocked(channel(), { title: "  ", topic: "\n" }, context(), "title");
  assert.equal(result.report.masterPromptPreserved, null);
  assert.equal(result.report.newFormatVersion, "script-prompt-v1");
});

test("SW-02B-05 malformed requests are reported without exceptions or prompt preparation", () => {
  blocked(null, video(), context(), "profile");
  blocked(channel(), null, context(), "video");
  blocked(channel(), video(), null, "context");
  blocked(channel(), { title: 15, topic: "Topic" }, context(), "title");
  blocked(channel(), video(), { requestId: [] }, "requestId");
});

test("SW-02B-06 unrelated channels retain their own master prompts and fingerprints", () => {
  const a = good(channel(), video(), context());
  const b = good(channel("channel-b", "Different B style"), video(), context({ expectedChannelId: "channel-b" }));
  assert.notEqual(a.report.masterPromptDigest, b.report.masterPromptDigest);
  assert.equal(b.report.channelId, "channel-b");
  assert.doesNotMatch(a.newPrompt, /Different B style/);
  assert.match(b.legacyPrompt, /Different B style/);
});

test("SW-02B-07 expected channel mismatch is blocked before either prompt exists", () => {
  const result = blocked(channel("channel-b"), video(), context(), "expectedChannelId");
  assert.equal(result.report.expectedDifferences.length, 0);
});

test("SW-02B-08 the original master is retained byte-for-byte in the new prompt", () => {
  const master = " \n  \"Quoted text\"   \n\nاردو/한국어 🎬  ";
  const result = good(channel("channel-a", master));
  assert.equal(result.request.masterPrompt.content, master);
  assert.equal(result.report.masterPromptPreserved, true);
  assert.ok(result.newPrompt.includes("CHANNEL MASTER PROMPT — VERBATIM START\n\n" + master + "\n\nCHANNEL MASTER PROMPT — VERBATIM END"));
  assert.ok(result.report.expectedDifferences.some((finding) => finding.code === "master_whitespace"));
  assert.ok(!result.legacyPrompt.startsWith(" "));
});

test("SW-02B-09 explicitly selected English narration is present in the new prompt", () => {
  const result = good(channel(), video({ language: "English" }));
  assert.equal(result.report.language, "English");
  assert.match(result.newPrompt, /"narrationLanguage": "English"/);
  assert.ok(result.report.warnings.some((w) => w.code === "legacy_language_implicit"));
});

test("SW-02B-10 Korean narration is preserved without translation", () => {
  const profile = channel();
  profile.language = "ko";
  const result = good(profile);
  assert.equal(result.report.language, "ko");
  assert.match(result.newPrompt, /"narrationLanguage": "ko"/);
});

test("SW-02B-11 Urdu language and multilingual instructions survive both validation and compilation", () => {
  const instructions = "Please use Urdu: اردو\nAnd mention 한국어: '안녕하세요' 🎬";
  const result = good(channel(), video({ language: "اردو / Urdu", additionalInstructions: instructions }));
  assert.equal(result.report.additionalInstructions, instructions);
  assert.equal(result.report.language, "اردو / Urdu");
  assert.ok(result.newPrompt.includes("اردو / Urdu"));
  assert.ok(result.newPrompt.includes("안녕하세요"));
  assert.ok(result.report.warnings.some((w) => w.field === "additionalInstructions"));
});

test("SW-02B-12 the real legacy clamp is used at 50 and 20,000 boundaries", () => {
  for (const [asked, expected] of [[-10, 50], [49.6, 50], [1400.5, 1401], [20005, 20000]] as const) {
    const result = good(channel(), video({ wordCount: asked }));
    assert.equal(result.report.requestedWords, expected);
    assert.match(result.legacyPrompt, new RegExp("about " + expected + " words long"));
    assert.ok(result.newPrompt.includes('"requestedWordCount": ' + expected));
  }
  assert.equal(good(channel(), video({ wordCount: null })).report.requestedWords, null);
});

test("SW-02B-13 audience and narration tone are new-only structured settings and generate warnings", () => {
  const result = good(channel(), video({ targetAudience: "US seniors", narrationTone: "measured" }));
  assert.equal(result.report.targetAudience, "US seniors");
  assert.equal(result.report.narrationTone, "measured");
  assert.match(result.newPrompt, /"targetAudience": "US seniors"/);
  assert.match(result.newPrompt, /"narrationTone": "measured"/);
  assert.ok(result.report.warnings.some((w) => w.field === "targetAudience"));
  assert.ok(result.report.warnings.some((w) => w.field === "narrationTone"));
});

test("SW-02B-14 exactly equivalent inputs produce stable report and prompt values", () => {
  const left = good();
  const right = good();
  assert.deepEqual(left, right);
  assert.ok(Object.isFrozen(left.report.expectedDifferences));
  assert.ok(Object.isFrozen(left.report.warnings));
});

test("SW-02B-15 known formatting differences are informational, not errors", () => {
  const result = good();
  assert.deepEqual(result.report.expectedDifferences.map((f) => f.code), [
    "subject_encoding", "word_count_encoding", "output_format_rules", "master_whitespace",
  ]);
  assert.equal(result.report.problems.length, 0);
  assert.equal(result.validation.valid, true);
});

test("SW-02B-16 missing, corrupted, or disabled channel master prompts are blocked", () => {
  blocked(channel("channel-a", ""), video(), context(), "profile.script.masterPrompt");
  blocked({ ...channel(), script: { writer: "claude", masterPrompt: null } }, video(), context(), "profile.script.masterPrompt");
  blocked({ ...channel(), script: { writer: "off", masterPrompt: "Valid prompt" } }, video(), context(), "profile.script.writer");
});

test("SW-02B-17 comparison invokes no browser or network API", () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("Unexpected network request"); }) as typeof fetch;
  try {
    const result = good();
    assert.equal(result.ok, true);
    assert.equal(typeof result.legacyPrompt, "string");
    assert.equal(typeof result.newPrompt, "string");
    assert.ok(!(result instanceof Promise));
  } finally {
    globalThis.fetch = original;
  }
});

test("SW-02B-18 caller profiles and video objects are never mutated", () => {
  const profile = channel();
  const input = Object.freeze(video({ additionalInstructions: "Stay grounded" }));
  const ctx = Object.freeze(context());
  Object.freeze(profile.script);
  Object.freeze(profile);
  const snapshot = JSON.stringify({ profile, input, ctx });
  good(profile, input, ctx);
  assert.equal(JSON.stringify({ profile, input, ctx }), snapshot);
});

test("SW-02B-19 existing generation helpers and decisions are unchanged", () => {
  const profile = channel();
  assert.equal(resolveStep0({ script: "", title: "T", topic: "", profile }).action, "callClaude");
  assert.equal(resolveStep0({ script: "typed", title: "", topic: "", profile }).action, "useTyped");
  const legacy = buildStep0Question("  Rules  ", " My title ", " My topic ", 55);
  assert.equal(legacy, buildScriptQuestion("Rules", "TITLE OF THIS VIDEO:\nMy title\n\nTOPIC OF THIS VIDEO:\nMy topic")
    .replace("Write the complete script now.", "Write the complete script now, about 55 words long (aim for 55 words, not much shorter or longer)."));
  assert.equal(recordFromProject({ channelId: "c", name: "Old", script: "hello" }), null);
});

test("SW-02B-20 invalid values cannot leak partially generated prompts", () => {
  for (const count of [NaN, Infinity, "500", [], {}]) {
    blocked(channel(), { title: "T", topic: "Q", wordCount: count }, context(), "wordCount");
  }
  blocked(channel(), { title: "T", topic: "Q", script: "Already written" }, context(), "script");
});

test("SW-02B-21 real legacy channel IDs can be previewed without migration", () => {
  const profile = readProfile({ id: "_old-1", language: "en", script: { writer: "claude", masterPrompt: "Old rules" } });
  const result = good(profile, { topic: "Why prices change" }, context({ expectedChannelId: "_old-1" }));
  assert.equal(result.report.channelId, "_old-1");
  assert.equal(profile.id, "_old-1");
});

test("SW-02B-22 the comparison report contains requested story style and format lineage only", () => {
  const result = good(channel(), video({ storytellingStyle: "introspective" }));
  assert.equal(result.report.storytellingStyle, "introspective");
  assert.equal(result.report.legacyFormatVersion, "legacy-step0-v1");
  assert.equal(result.report.newFormatVersion, "script-prompt-v1");
  assert.equal(result.report.masterPromptDigest, result.request.masterPrompt.contentDigest);
  assert.equal(result.report.legacyMasterPromptVersion, result.metadata.legacyMasterPromptVersion);
  assert.ok(!JSON.stringify(result.report).includes("personal-account"), "Account preference must not appear in the visible comparison report");
});
