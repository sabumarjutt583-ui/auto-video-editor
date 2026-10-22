/** Runs the prompt writing through a chat: setup once per thread, then batches (each with the reminder), verified and repaired. */

import type { AppError } from "../../../types";
import type { Scene } from "../../../types/project.ts";
import { toAppError } from "../../errors.ts";
import { assemblePrompt, finishMotion, needsMotion } from "../assemble.ts";
import type { PromptContext } from "../generate.ts";
import { buildBatchMessage, buildMissingMessage, buildSetupMessage, castOf, DEFAULT_BATCH, planChatGroups } from "./messages.ts";
import { isSoftFailureText, parseFullBatch, saysReady } from "./parse.ts";
import { verifyPrompt } from "./verify.ts";

export interface ThreadRef {
  accountId: string;
  url: string;
  /** Batches answered in this thread. */
  batches: number;
}

export interface ChatAnswer {
  text: string;
  accountId: string;
  accountName: string;
  threadUrl: string;
}

export interface ChatTransport {
  /** Sends one message. `thread` null = start a new thread (the next free account). */
  send(message: string, options: { thread: ThreadRef | null; batchId: string }): Promise<ChatAnswer>;
}

export interface ChatProgress {
  batch: number;
  total: number;
  account: string;
}

export interface ChatRunArgs {
  scenes: readonly Scene[];
  targetIds: ReadonlySet<string>;
  context: PromptContext;
  transport: ChatTransport;
  /** Short id of the project / quick session, used in batch ids. */
  tag: string;
  batchSize?: number;
  /** A new thread (with setup) after this many batches. */
  threadBatches?: number;
  /** Wait before the single retry after a soft failure (ms). */
  softWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  thread?: ThreadRef | null;
  onThread?: (thread: ThreadRef | null) => void;
  onBatch?: (progress: ChatProgress) => void;
  onScenes?: (scenes: Scene[]) => void;
  onLog?: (line: string) => void;
}

export interface ChatRunResult {
  scenes: Scene[];
  failed: { batch: number; error: AppError } | null;
}

const detailsOf = (error: unknown) => toAppError(error).details;
const has = (error: unknown, word: string) => detailsOf(error).includes(word);
export const isSoft = (error: unknown) => has(error, "SoftFailure");

/** Writes a verified full prompt into a scene. */
export function applyFullPrompt(scene: Scene, prompt: string, motion: string, fixes: string[], context: PromptContext): Scene {
  const { negative } = assemblePrompt({ description: "", characters: [], location: null, style: context.style, aspect: context.aspect, tool: context.settings.tool });
  return {
    ...scene,
    description: "",
    prompt,
    negative,
    motionPrompt: needsMotion(scene, context.settings.outputType) ? finishMotion(motion, scene.duration) : "",
    edited: false,
    status: "prompt_ready",
    fixNotes: fixes,
  };
}

/** Runs all batches. Never resends a message that got an answer; a soft failure is retried once in a new thread. */
export async function runChatPrompts(args: ChatRunArgs): Promise<ChatRunResult> {
  const { context, transport } = args;
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = args.onLog ?? (() => undefined);
  const maxThreadBatches = args.threadBatches ?? 15;
  let scenes = [...args.scenes];
  const targets = scenes.filter((s) => args.targetIds.has(s.id));
  const groups = planChatGroups(targets, context, scenes, args.batchSize ?? DEFAULT_BATCH);
  let thread: ThreadRef | null = args.thread ?? null;
  let threadNo = 0;
  let account = "";
  const setThread = (next: ThreadRef | null) => {
    thread = next;
    args.onThread?.(next);
  };

  async function startThread(): Promise<void> {
    threadNo += 1;
    const batchId = `${args.tag}-SETUP${threadNo}`;
    const answer = await transport.send(buildSetupMessage(context), { thread: null, batchId });
    account = answer.accountName;
    if (!saysReady(answer.text)) {
      throw { message: "Gemini did not answer READY to the setup message.", details: `SoftFailure: setup reply: ${answer.text.slice(0, 300)}` } satisfies AppError;
    }
    setThread({ accountId: answer.accountId, url: answer.threadUrl, batches: 0 });
    log(`new thread on ${account}`);
  }

  async function ask(message: string, batchId: string): Promise<string> {
    if (thread === null || thread.batches >= maxThreadBatches) {
      setThread(null);
      await startThread();
    }
    try {
      const answer = await transport.send(message, { thread, batchId });
      account = answer.accountName || account;
      if (thread) setThread({ ...thread, url: answer.threadUrl || thread.url });
      if (isSoftFailureText(answer.text)) throw { message: "Gemini gave a generic error reply.", details: `SoftFailure: ${answer.text.slice(0, 300)}` } satisfies AppError;
      return answer.text;
    } catch (error) {
      if (has(error, "thread_account_unavailable")) {
        setThread(null);
        await startThread();
        const answer = await transport.send(message, { thread, batchId });
        return answer.text;
      }
      throw error;
    }
  }

  for (let b = 0; b < groups.length; b += 1) {
    const group = groups[b] ?? [];
    const ids = group.map((s) => s.id);
    const firstIndex = scenes.findIndex((s) => s.id === group[0]?.id);
    const before = scenes.slice(0, Math.max(0, firstIndex));
    const batchId = `${args.tag}-B${String(b + 1).padStart(2, "0")}`;
    args.onBatch?.({ batch: b + 1, total: groups.length, account });

    let answerText = "";
    let softTries = 0;
    for (;;) {
      try {
        answerText = await ask(buildBatchMessage(batchId, context, group, before), batchId);
        break;
      } catch (error) {
        if (isSoft(error) && softTries === 0) {
          softTries += 1;
          log("soft failure: waiting, then ONE new thread");
          await sleep(args.softWaitMs ?? 30_000);
          setThread(null);
          continue;
        }
        if (has(error, "RateLimit") && softTries < 3) {
          softTries += 1;
          setThread(null);
          continue;
        }
        return { scenes, failed: { batch: b + 1, error: toAppError(error, "Gemini could not answer this batch.") } };
      }
    }

    let parsed = parseFullBatch(answerText, ids);
    const got = new Map(parsed.items.map((i) => [i.id, i]));
    if (parsed.missing.length > 0) {
      const missingScenes = group.filter((s) => parsed.missing.includes(s.id));
      try {
        const again = await ask(buildMissingMessage(`${batchId}-M1`, context, missingScenes, before), `${batchId}-M1`);
        parsed = parseFullBatch(again, parsed.missing);
        for (const item of parsed.items) got.set(item.id, item);
      } catch (error) {
        return { scenes, failed: { batch: b + 1, error: toAppError(error, "Gemini could not answer the missing scenes.") } };
      }
      const stillMissing = ids.filter((id) => !got.has(id));
      if (stillMissing.length > 0) {
        const kind = parsed.readable || got.size > 0 ? "MissingIds" : "InvalidJson";
        return { scenes, failed: { batch: b + 1, error: { message: "Gemini's answer did not contain every scene.", details: `${kind}: missing ${stillMissing.join(", ")}` } } };
      }
    }

    let fixedRows = 0;
    scenes = scenes.map((scene) => {
      const item = got.get(scene.id);
      if (!item) return scene;
      const { characters, location } = castOf(scene, context);
      const checked = verifyPrompt({ prompt: item.prompt, style: context.style, characters, location, detail: context.settings.detail });
      if (checked.fixes.length > 0) fixedRows += 1;
      const notes = [...checked.fixes, ...checked.checks.map((c) => `check: ${c}`)];
      return applyFullPrompt(scene, checked.prompt, item.motion, notes, context);
    });
    args.onScenes?.(scenes);

    if (thread) setThread({ ...(thread as ThreadRef), batches: (thread as ThreadRef).batches + 1 });
    if (fixedRows / Math.max(1, ids.length) > 0.3) {
      log(`${fixedRows} of ${ids.length} rows needed fixes: next batch starts a new thread`);
      setThread(null);
    }
  }
  return { scenes, failed: null };
}
