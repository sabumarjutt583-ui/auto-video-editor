import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultProfile } from "../pipeline/profile.ts";
import {
  buildStep0Question,
  clampWordCount,
  countScriptWords,
  masterPromptVersion,
  recordsAreIsolated,
  recordFromProject,
  resolveStep0,
  scriptRecordFor,
  scriptsOfChannel,
} from "./step0.ts";

const channelA = { ...defaultProfile("channel-a", "Channel A"), script: { writer: "claude" as const, masterPrompt: "You write warm Korean senior stories." } };
const channelB = { ...defaultProfile("channel-b", "Channel B"), script: { writer: "claude" as const, masterPrompt: "You write fast tech news scripts." } };

test("the Step 0 question carries the channel's master prompt, title, topic and word count", () => {
  const question = buildStep0Question(channelA.script.masterPrompt, "My title", "My topic", 3000);
  assert.match(question, /You write warm Korean senior stories\./);
  assert.match(question, /My title/);
  assert.match(question, /My topic/);
  assert.match(question, /about 3000 words long/);
  assert.match(buildStep0Question(channelA.script.masterPrompt, "", "Only topic", null), /Only topic/);
  assert.doesNotMatch(buildStep0Question(channelA.script.masterPrompt, "", "Only topic", null), /about \d+ words long/);
});

test("two channels get different questions and different master prompt versions", () => {
  const a = buildStep0Question(channelA.script.masterPrompt, "Same title", "Same topic", 1000);
  const b = buildStep0Question(channelB.script.masterPrompt, "Same title", "Same topic", 1000);
  assert.notEqual(a, b);
  assert.match(a, /Korean senior stories/);
  assert.match(b, /tech news scripts/);
  assert.notEqual(masterPromptVersion(channelA.script.masterPrompt), masterPromptVersion(channelB.script.masterPrompt));
  assert.equal(masterPromptVersion(channelA.script.masterPrompt), masterPromptVersion(channelA.script.masterPrompt), "same prompt, same version");
  assert.notEqual(masterPromptVersion("a"), masterPromptVersion("a "));
});

test("a typed script never calls Claude, and a title alone calls Claude", () => {
  assert.deepEqual(resolveStep0({ script: "My own words here.", title: "", topic: "", profile: channelA }), { action: "useTyped", source: "typed" });
  assert.deepEqual(resolveStep0({ script: "", title: "A title", topic: "", profile: channelA }), { action: "callClaude", source: "claude" });
  assert.deepEqual(resolveStep0({ script: "", title: "", topic: "A topic", profile: channelA }), { action: "callClaude", source: "claude" });
  const empty = resolveStep0({ script: "", title: "", topic: "", profile: channelA });
  assert.equal(empty.action, "needInput");
  const off = { ...channelA, script: { writer: "off" as const, masterPrompt: "x" } };
  assert.equal(resolveStep0({ script: "", title: "T", topic: "", profile: off }).action, "needInput");
});

test("word counts are counted and clamped", () => {
  assert.equal(countScriptWords("  hello   world\nfoo "), 3);
  assert.equal(clampWordCount(null), null);
  assert.equal(clampWordCount(3000), 3000);
  assert.equal(clampWordCount(10), 50);
  assert.equal(clampWordCount(999999), 20000);
});

test("channel filtering never leaks one channel's scripts into another", () => {
  const records = [
    scriptRecordFor({ profile: channelA, title: "A video", topic: "A topic", wordCount: 1000, script: "one two three", source: "claude" }),
    scriptRecordFor({ profile: channelB, title: "B video", topic: "B topic", wordCount: 2000, script: "four five six", source: "claude" }),
    scriptRecordFor({ profile: channelA, title: "A video 2", topic: "A topic 2", wordCount: null, script: "seven eight", source: "typed" }),
  ];
  const onlyA = scriptsOfChannel(records, "channel-a");
  assert.equal(onlyA.length, 2);
  assert.ok(onlyA.every((record) => record.channelId === "channel-a"));
  assert.ok(recordsAreIsolated(onlyA, "channel-a"));
  assert.equal(recordsAreIsolated(records, "channel-a"), false, "the mixed list is not isolated for one channel");
  const onlyB = scriptsOfChannel(records, "channel-b");
  assert.equal(onlyB.length, 1);
  assert.equal(onlyB[0]?.title, "B video");
  assert.deepEqual(scriptsOfChannel(records, "channel-nope"), []);
});

test("a script record carries channel, title, topic, word count and master prompt version", () => {
  const record = scriptRecordFor({ profile: channelA, title: "T", topic: "Top", wordCount: 1500, script: "a b c d", source: "claude" });
  assert.equal(record.channelId, "channel-a");
  assert.equal(record.title, "T");
  assert.equal(record.topic, "Top");
  assert.equal(record.wordCountRequested, 1500);
  assert.equal(record.wordCountActual, 4);
  assert.equal(record.source, "claude");
  assert.equal(record.masterPromptVersion, masterPromptVersion(channelA.script.masterPrompt));
});

test("an old project without a Step 0 record is unknown, not guessed", () => {
  assert.equal(recordFromProject({ channelId: "a", name: "Old", script: "words here" }), null);
  const known = recordFromProject({ channelId: "a", name: "New", script: "words here", scriptSource: "claude", scriptTopic: "Top", scriptWordsRequested: 1000, scriptMasterPromptVersion: "v1-abc-10" });
  assert.equal(known?.source, "claude");
  assert.equal(known?.wordCountRequested, 1000);
  assert.equal(known?.wordCountActual, 2);
});
