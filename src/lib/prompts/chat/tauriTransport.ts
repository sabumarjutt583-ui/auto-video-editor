import { invoke } from "@tauri-apps/api/core";

import type { ChatTransport } from "./runner.ts";

interface ThreadAnswer {
  text: string;
  code: string[];
  accountId: string;
  accountName: string;
  threadUrl: string;
}

/** Sends the messages through Gemini's web chat (the Google accounts of the Image Generator). */
export function webChatTransport(jobId: string): ChatTransport {
  return {
    async send(message, { thread, batchId }) {
      const answer = await invoke<ThreadAnswer>("imagegen_chat_thread", {
        prompt: message,
        accountId: thread?.accountId ?? null,
        threadUrl: thread?.url ?? null,
        batchId,
        jobId,
      });
      return { text: answer.text, accountId: answer.accountId, accountName: answer.accountName, threadUrl: answer.threadUrl };
    },
  };
}
