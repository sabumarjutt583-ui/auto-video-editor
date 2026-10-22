import type { ThreadRef } from "./runner.ts";

const KEY = "chatThreads";

type Store = Record<string, ThreadRef>;

function read(): Store {
  try {
    const raw = window.localStorage.getItem(KEY);
    const data: unknown = raw ? JSON.parse(raw) : {};
    return typeof data === "object" && data !== null ? (data as Store) : {};
  } catch {
    return {};
  }
}

/** The chat thread of a project or quick session (kept only on this computer, so it can be reused). */
export function loadThread(projectId: string): ThreadRef | null {
  const t = read()[projectId];
  return t && typeof t.url === "string" && typeof t.accountId === "string" ? t : null;
}

export function saveThread(projectId: string, thread: ThreadRef | null): void {
  try {
    const store = read();
    if (thread) store[projectId] = thread;
    else delete store[projectId];
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Storage may be blocked: the thread is then simply not reused after a restart.
  }
}
