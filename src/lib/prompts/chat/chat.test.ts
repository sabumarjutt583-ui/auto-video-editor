import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyScene } from "../../scenes/assemble.ts";
import { blankStyle } from "../../styleModel.ts";
import type { Character, Location, PromptSettings, Scene } from "../../../types/project.ts";
import type { StyleProfile } from "../../../types/style.ts";
import type { PromptContext } from "../generate.ts";
import { buildBatchMessage, buildMissingMessage, buildReminder, buildSetupMessage, castOf, MAX_MESSAGE_CHARS, planChatGroups } from "./messages.ts";
import { isSoftFailureText, parseFullBatch, saysReady } from "./parse.ts";
import { randomPauseMs, runChatPrompts, type ChatTransport } from "./runner.ts";
import { verifyPrompt } from "./verify.ts";

const LOCK = "film noir, high contrast black and white, hard shadows, 35mm grain";
const STYLE: StyleProfile = { ...blankStyle(), id: "noir", name: "Korean Noir", category: "Cinematic", core_identity: "CORE", example_prompt: "EXAMPLE", style_lock: LOCK, negative: "cartoon" };
const MINA: Character = { id: "c1", name: "Mina", role: "girl", appearance: "An 8-year-old girl with a short black bob and a yellow raincoat." };
const VILLAGE: Location = { id: "l1", name: "Village", description: "A grey-stone harbour village at dawn." };
const SETTINGS: PromptSettings = { outputType: "image", detail: "short", tool: "generic" };
const CONTEXT: PromptContext = { style: STYLE, characters: [MINA], locations: [VILLAGE], settings: SETTINGS, aspect: "16:9" };

function scene(n: number, extra: Partial<Scene> = {}): Scene {
  return { ...emptyScene(), id: `S${String(n).padStart(2, "0")}`, index: n, start: (n - 1) * 5, end: n * 5, duration: 5, text: `Narration ${n}.`, characterIds: ["c1"], locationId: "l1", ...extra };
}
const scenes = (n: number) => Array.from({ length: n }, (_, i) => scene(i + 1));
const good = (id: string) => ({ id, prompt: `Mina walks along the quiet pier in scene ${id}, the camera follows her from behind at a low angle while the gulls circle above the water and the first light slowly warms the wet stones around her small boots. ${MINA.appearance} ${VILLAGE.description} ${LOCK}`, motion: "" });
const answerFor = (ids: string[]) => "```json\n" + JSON.stringify(ids.map(good)) + "\n```";
const idsIn = (message: string) => [...message.matchAll(/^(S\d+) \|/gm)].map((m) => m[1] ?? "");

test("the setup message is text-only, has the full profile and ends with READY", () => {
  const m = buildSetupMessage(CONTEXT);
  assert.ok(m.startsWith("This is a text-only writing task. Do not generate, draw or create any images or files. Reply with text only."));
  assert.ok(m.includes(LOCK) && m.includes(MINA.appearance) && m.includes(VILLAGE.description));
  assert.ok(m.includes("Example description") && !m.includes("Example prompt") && m.includes("shots of a video"));
  assert.ok(m.trimEnd().endsWith("Reply with the single word READY."));
});

test("every batch message starts with the reminder block and lists the scenes", () => {
  const m = buildBatchMessage("P7-B03", CONTEXT, scenes(2), []);
  assert.ok(m.startsWith("This is a text-only writing task. Reply with text only.\nBATCH_ID: P7-B03\nREMINDER:"));
  assert.ok(m.includes(`END with exactly this style lock: "${LOCK}"`));
  assert.ok(m.includes(MINA.appearance));
  assert.deepEqual(idsIn(m), ["S01", "S02"]);
  assert.ok(buildReminder("X", CONTEXT, scenes(1).map((s) => castOf(s, CONTEXT))).includes("BATCH_ID: X"));
  assert.ok(buildMissingMessage("X-M1", CONTEXT, scenes(1), []).includes("missing"));
});

test("messages stay under the size limit by using smaller batches", () => {
  const long = scenes(30).map((s) => ({ ...s, text: "word ".repeat(80) }));
  const groups = planChatGroups(long, CONTEXT, long, 20);
  assert.ok(groups.length > 2);
  for (const g of groups) assert.ok(g.length === 1 || buildBatchMessage("X-B00", CONTEXT, g, []).length <= MAX_MESSAGE_CHARS);
  assert.equal(groups.flat().length, 30);
  assert.equal(planChatGroups(scenes(45), CONTEXT, scenes(45), 20).map((g) => g.length).join(), "20,20,5");
});

test("answers are read from a code block, plain JSON or JSON with words around it; ids are checked", () => {
  const ids = ["S01", "S02"];
  assert.equal(parseFullBatch(answerFor(ids), ids).items.length, 2);
  assert.equal(parseFullBatch(JSON.stringify(ids.map(good)), ids).missing.length, 0);
  assert.equal(parseFullBatch(`Sure! Here you go:\n${JSON.stringify(ids.map(good))}\nEnjoy`, ids).items.length, 2);
  const missing = parseFullBatch(answerFor(["S01"]), ids);
  assert.deepEqual(missing.missing, ["S02"]);
  assert.deepEqual(parseFullBatch(answerFor(["S02", "S01", "S09"]), ids).extra, ["S09"]);
  assert.deepEqual(parseFullBatch(answerFor(["S02", "S01"]), ids).items.map((i) => i.id), ["S01", "S02"], "wrong order is repaired");
  assert.equal(parseFullBatch("no json here", ids).readable, false);
});

test("soft failures and READY are recognised", () => {
  assert.ok(isSoftFailureText("I seem to be encountering an error. Can I help with something else instead?"));
  assert.ok(isSoftFailureText("I'm having a hard time fulfilling your request."));
  assert.ok(!isSoftFailureText(answerFor(["S01"])));
  assert.ok(saysReady("READY") && saysReady("Ready.") && !saysReady("Sure, what is the task?"));
});

test("a missing style lock is added, a partly written one is replaced", () => {
  const input = { style: STYLE, characters: [MINA], location: VILLAGE, detail: "short" as const };
  const none = verifyPrompt({ ...input, prompt: `Mina walks. ${MINA.appearance} ${VILLAGE.description}` });
  assert.ok(none.prompt.endsWith(LOCK));
  assert.ok(none.fixes.includes("added the style lock"));
  const partial = verifyPrompt({ ...input, prompt: `Mina walks. ${MINA.appearance} ${VILLAGE.description} film noir, high contrast` });
  assert.ok(partial.prompt.endsWith(LOCK));
  assert.equal(partial.prompt.split("film noir").length, 2, "no duplicate partial words");
  const fine = verifyPrompt({ ...input, prompt: good("S01").prompt });
  assert.deepEqual(fine.fixes, []);
  assert.equal(fine.prompt, good("S01").prompt);
});

test("missing character and location text is inserted; banned words are removed", () => {
  const input = { style: STYLE, characters: [MINA], location: VILLAGE, detail: "short" as const };
  const fixed = verifyPrompt({ ...input, prompt: `A girl walks in a Pixar style town with letters saying WELCOME. ${LOCK}` });
  assert.ok(fixed.prompt.includes(MINA.appearance) && fixed.prompt.includes(VILLAGE.description));
  assert.ok(!/pixar/i.test(fixed.prompt) && !/WELCOME/.test(fixed.prompt));
  assert.ok(fixed.prompt.endsWith(LOCK));
  assert.ok(fixed.fixes.some((f) => f.includes("banned")));
  const short = verifyPrompt({ ...input, prompt: good("S01").prompt, detail: "detailed" });
  assert.ok(short.checks.some((c) => c.startsWith("length")), "a far-off length is flagged, not changed");
});

function fakeTransport(options: { answers?: (message: string, n: number) => string; failAt?: number[] } = {}) {
  const sent: { message: string; thread: string | null; batchId: string }[] = [];
  let calls = 0;
  let threads = 0;
  const transport: ChatTransport = {
    async send(message, { thread, batchId }) {
      calls += 1;
      if (options.failAt?.includes(calls)) throw { message: "x", details: "SoftFailure" };
      let url = thread?.url ?? "";
      if (!thread) {
        threads += 1;
        url = `https://g/app/${threads}`;
      }
      sent.push({ message, thread: url, batchId });
      const text = message.includes("Reply with the single word READY.") ? "READY" : (options.answers ?? ((m) => answerFor(idsIn(m))))(message, calls);
      return { text, accountId: "a1", accountName: "Acc", threadUrl: url };
    },
  };
  return { transport, sent };
}
const run = (transport: ChatTransport, n: number, extra = {}) => runChatPrompts({ scenes: scenes(n), targetIds: new Set(scenes(n).map((s) => s.id)), context: CONTEXT, transport, tag: "P7", sleep: async () => undefined, ...extra });

test("40 scenes: one setup, READY, two batches in ONE thread, each with the reminder", async () => {
  const { transport, sent } = fakeTransport();
  const result = await run(transport, 40);
  assert.equal(result.failed, null);
  assert.equal(sent.length, 3);
  assert.ok(sent[0]?.message.includes("READY"));
  assert.deepEqual(new Set(sent.map((s) => s.thread)).size, 1);
  for (const batch of sent.slice(1)) assert.ok(batch.message.startsWith("This is a text-only writing task. Reply with text only.\nBATCH_ID: P7-B0"));
  assert.deepEqual(sent.slice(1).map((s) => s.batchId), ["P7-B01", "P7-B02"]);
  assert.equal(new Set(sent.map((s) => s.message)).size, 3, "no duplicate message");
  assert.ok(result.scenes.every((s) => s.prompt.endsWith(LOCK) && s.prompt.includes(MINA.appearance) && s.status === "prompt_ready"));
  assert.ok(result.scenes.every((s) => (s.fixNotes ?? []).length === 0));
});

test("a thread is replaced after 15 batches (setup again)", async () => {
  const { transport, sent } = fakeTransport();
  const result = await run(transport, 6, { batchSize: 1, threadBatches: 2 });
  assert.equal(result.failed, null);
  assert.equal(sent.filter((s) => s.message.includes("READY")).length, 3);
});

test("missing ids are asked for once, in the same thread", async () => {
  const { transport, sent } = fakeTransport({ answers: (m, n) => (n === 2 ? answerFor(idsIn(m).slice(0, 18)) : answerFor(idsIn(m))) });
  const result = await run(transport, 20);
  assert.equal(result.failed, null);
  assert.equal(sent.length, 3);
  assert.deepEqual(idsIn(sent[2]?.message ?? ""), ["S19", "S20"]);
  assert.equal(sent[2]?.thread, sent[1]?.thread);
  const still = await run(fakeTransport({ answers: () => answerFor(["S01"]) }).transport, 3);
  assert.ok(still.failed?.error.details.startsWith("MissingIds"));
});

test("a soft failure waits, opens ONE new thread with setup, and never loops", async () => {
  const waits: number[] = [];
  const { transport, sent } = fakeTransport({ failAt: [2] });
  const ok = await run(transport, 3, { sleep: async (ms: number) => void waits.push(ms) });
  assert.equal(ok.failed, null);
  assert.deepEqual(waits, [30_000]);
  assert.equal(sent.filter((s) => s.message.includes("READY")).length, 2, "setup was sent again in the new thread");
  const twice = fakeTransport({ failAt: [2, 4, 5, 6, 7, 8] });
  const bad = await run(twice.transport, 3);
  assert.ok(bad.failed, "second failure stops");
  assert.ok(twice.sent.length < 8, "no endless loop");
});

test("READY not returned is a soft failure", async () => {
  const transport: ChatTransport = { send: async () => ({ text: "Sure, what is the task?", accountId: "a", accountName: "A", threadUrl: "u" }) };
  const result = await run(transport, 2);
  assert.ok(result.failed?.error.details.includes("SoftFailure"));
});

test("rows that needed fixes get notes; more than 30% fixed starts a new thread", async () => {
  const bare = (id: string) => ({ id, prompt: `Mina walks in ${id}.`, motion: "" });
  const { transport, sent } = fakeTransport({ answers: (m) => "```json\n" + JSON.stringify(idsIn(m).map(bare)) + "\n```" });
  const result = await run(transport, 4, { batchSize: 2 });
  assert.equal(result.failed, null);
  assert.ok(result.scenes.every((s) => s.prompt.endsWith(LOCK) && s.prompt.includes(MINA.appearance) && (s.fixNotes ?? []).length > 0));
  assert.equal(sent.filter((s) => s.message.includes("READY")).length, 2, "a new thread after a batch with many fixes");
});

function slowThenOk(kind: string, times: number) {
  let failures = 0;
  const batchIds: string[] = [];
  const transport: ChatTransport = {
    async send(message, { batchId }) {
      if (message.includes("Reply with the single word READY.")) return { text: "READY", accountId: "a1", accountName: "Acc", threadUrl: "https://g/app/1" };
      batchIds.push(batchId);
      if (failures < times) {
        failures += 1;
        throw { message: "Gemini took too long to answer. It was not interrupted or resent.", details: kind };
      }
      return { text: answerFor(idsIn(message)), accountId: "a1", accountName: "Acc", threadUrl: "https://g/app/1" };
    },
  };
  return { transport, batchIds };
}

test("a slow or lost chat is asked again for the SAME batch by itself (3 retries, growing waits)", async () => {
  for (const kind of ["ResponseTimeout", "NoResponse", "Session", "Network"]) {
    const waits: number[] = [];
    const { transport, batchIds } = slowThenOk(kind, 2);
    const result = await run(transport, 3, { sleep: async (ms: number) => void waits.push(ms) });
    assert.equal(result.failed, null, kind);
    assert.deepEqual(waits, [20_000, 45_000], kind);
    assert.deepEqual(batchIds, ["P7-B01", "P7-B01", "P7-B01"], "the same batch id every time, so the chat can see the message is already there");
  }
});

test("after 3 retries the run stops and keeps what it has; other errors are not retried", async () => {
  const stuck = slowThenOk("ResponseTimeout", 99);
  const result = await run(stuck.transport, 3);
  assert.ok(result.failed?.error.details.includes("ResponseTimeout"));
  assert.equal(stuck.batchIds.length, 4, "first try + 3 retries");
  const limited = slowThenOk("RateLimit", 99);
  const second = await run(limited.transport, 3);
  assert.ok(second.failed);
  assert.equal(limited.batchIds.length <= 4, true);
  const auth = slowThenOk("Auth", 99);
  await run(auth.transport, 3);
  assert.equal(auth.batchIds.length, 1, "a signed-out account is not asked again");
});

test("a polite pause comes between batches, not after the last one", async () => {
  const waits: number[] = [];
  const { transport } = fakeTransport();
  const result = await run(transport, 6, { batchSize: 2, pauseBetween: () => 7_000, sleep: async (ms: number) => void waits.push(ms) });
  assert.equal(result.failed, null);
  assert.deepEqual(waits, [7_000, 7_000]);
});

test("the random pause stays between the two numbers", () => {
  assert.equal(randomPauseMs(4, 12, () => 0), 4_000);
  assert.equal(randomPauseMs(4, 12, () => 1), 12_000);
  assert.equal(randomPauseMs(12, 4, () => 0.5), 8_000, "swapped numbers still work");
  assert.equal(randomPauseMs(0, 0), 0);
});
