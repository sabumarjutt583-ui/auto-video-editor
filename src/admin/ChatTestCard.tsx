import { MessageSquare } from "lucide-react";
import { useState } from "react";

import { ErrorNotice } from "../components/ErrorNotice";
import { Button, Card, TextInput } from "../components/ui";
import { toAppError } from "../lib/errors";
import { imagegenChatAsk, type ChatAnswer } from "../lib/imagegen/api";
import type { AppError } from "../types";

const SAMPLE = "Write a small HTML file with a red ball that bounces. Send it in one ```html code block.";

/** Asks the web chat one real question, to check that the page selectors in the engine settings still work. */
export function ChatTestCard() {
  const [prompt, setPrompt] = useState(SAMPLE);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<ChatAnswer | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [seconds, setSeconds] = useState(0);

  async function run() {
    setBusy(true);
    setError(null);
    setAnswer(null);
    const started = Date.now();
    try {
      setAnswer(await imagegenChatAsk(prompt));
    } catch (failure) {
      setError(toAppError(failure, "The chat did not answer."));
    } finally {
      setSeconds(Math.round((Date.now() - started) / 1000));
      setBusy(false);
    }
  }

  return (
    <Card title="Chat test" description="Asks Gemini's web chat one question with the next free Google account. If it fails, update the chat selectors in the engine settings." icon={MessageSquare}>
      <TextInput value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={busy} aria-label="Question" />
      <Button loading={busy} disabled={!prompt.trim()} onClick={() => void run()}>Ask</Button>
      {error && <ErrorNotice error={error} />}
      {answer && (
        <div role="status" className="flex flex-col gap-2 text-xs">
          <p className="text-success">Answered in {seconds} s. Text: {answer.text.length} characters, code blocks: {answer.code.length}.</p>
          <pre className="max-h-60 overflow-auto rounded-lg bg-surface-2 p-2 whitespace-pre-wrap">{answer.code[0] ?? answer.text}</pre>
        </div>
      )}
    </Card>
  );
}
