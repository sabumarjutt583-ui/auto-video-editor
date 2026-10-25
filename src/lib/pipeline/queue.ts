/** The queue of videos waiting to be made one after another (pure logic). */

export type QueueStatus = "waiting" | "running" | "done" | "failed";

export interface QueueItem {
  id: string;
  channelId: string;
  name: string;
  script: string;
  /** The person's own voice file, or null to make the voice from the script. */
  voiceFile: string | null;
  status: QueueStatus;
  /** The project made for this item (set when the work starts), so a retry continues it. */
  projectId: string | null;
  /** Why it failed, in simple words. */
  note: string;
}

export const MAX_QUEUE = 200;
export const MAX_SCRIPT_CHARS = 200_000;

const STATUSES: readonly QueueStatus[] = ["waiting", "running", "done", "failed"];

/** Splits pasted text into videos. A line with only --- (or ===) separates them. A first line starting with # is the title. */
export function parseScripts(text: string): { name: string; script: string }[] {
  const blocks = text.replace(/\r\n?/g, "\n").split(/^\s*(?:-{3,}|={3,})\s*$/m);
  const result: { name: string; script: string }[] = [];
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    let name = "";
    if (lines[0]?.trim().startsWith("#")) {
      name = (lines.shift() ?? "").trim().replace(/^#+\s*/, "").slice(0, 80);
    }
    const script = lines.join("\n").trim().slice(0, MAX_SCRIPT_CHARS);
    if (script !== "") result.push({ name, script });
  }
  return result;
}

/** New waiting items for a channel. Empty names become "<fallback> 1", "<fallback> 2" ... counted from what is queued. */
export function addScripts(queue: readonly QueueItem[], channelId: string, fallbackName: string, parsed: readonly { name: string; script: string }[], newId: () => string): QueueItem[] {
  const room = Math.max(0, MAX_QUEUE - queue.length);
  let counter = queue.filter((item) => item.channelId === channelId).length;
  const added = parsed.slice(0, room).map((entry): QueueItem => {
    counter += 1;
    return { id: newId(), channelId, name: entry.name || `${fallbackName} ${counter}`, script: entry.script, voiceFile: null, status: "waiting", projectId: null, note: "" };
  });
  return [...queue, ...added];
}

export function nextWaiting(queue: readonly QueueItem[]): QueueItem | null {
  return queue.find((item) => item.status === "waiting") ?? null;
}

export function setItem(queue: readonly QueueItem[], id: string, patch: Partial<QueueItem>): QueueItem[] {
  return queue.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

export function removeItem(queue: readonly QueueItem[], id: string): QueueItem[] {
  return queue.filter((item) => item.id !== id);
}

/** Takes finished videos off the list. */
export function clearDone(queue: readonly QueueItem[]): QueueItem[] {
  return queue.filter((item) => item.status !== "done");
}

/** Failed videos wait again (they continue where they stopped). */
export function retryFailed(queue: readonly QueueItem[]): QueueItem[] {
  return queue.map((item) => (item.status === "failed" ? { ...item, status: "waiting", note: "" } : item));
}

export interface QueueCounts {
  waiting: number;
  running: number;
  done: number;
  failed: number;
}

export function queueCounts(queue: readonly QueueItem[]): QueueCounts {
  const counts: QueueCounts = { waiting: 0, running: 0, done: 0, failed: 0 };
  for (const item of queue) counts[item.status] += 1;
  return counts;
}

/** The saved queue from any JSON. Damaged items are dropped; a video that was running when the app closed waits again. */
export function readQueue(value: unknown): QueueItem[] {
  if (!Array.isArray(value)) return [];
  const result: QueueItem[] = [];
  const seen = new Set<string>();
  for (const raw of value.slice(0, MAX_QUEUE)) {
    if (typeof raw !== "object" || raw === null) continue;
    const o = raw as Record<string, unknown>;
    if (typeof o.id !== "string" || o.id === "" || seen.has(o.id) || typeof o.script !== "string") continue;
    seen.add(o.id);
    const status = STATUSES.find((s) => s === o.status) ?? "waiting";
    result.push({
      id: o.id,
      channelId: typeof o.channelId === "string" ? o.channelId : "",
      name: typeof o.name === "string" ? o.name.slice(0, 80) : "",
      script: o.script.slice(0, MAX_SCRIPT_CHARS),
      voiceFile: typeof o.voiceFile === "string" && o.voiceFile !== "" ? o.voiceFile : null,
      status: status === "running" ? "waiting" : status,
      projectId: typeof o.projectId === "string" && o.projectId !== "" ? o.projectId : null,
      note: typeof o.note === "string" ? o.note.slice(0, 300) : "",
    });
  }
  return result;
}
