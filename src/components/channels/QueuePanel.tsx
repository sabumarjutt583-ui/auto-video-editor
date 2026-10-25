import { Check, ListPlus, Loader2, Play, RotateCw, Square, Trash2, X } from "lucide-react";
import { useState } from "react";

import { parseScripts, queueCounts, type QueueItem, type QueueStatus } from "../../lib/pipeline/queue";
import { useQueueStore } from "../../store/queueStore";
import { Button, Card, Field } from "../ui";
import type { ConsentFn } from "./types";

const TEXT: Record<QueueStatus, string> = { waiting: "Waiting", running: "Making now", done: "Finished", failed: "Failed" };

interface Props {
  /** Only this channel's videos are listed and added; null = every channel. */
  channelId: string | null;
  channelName: (id: string) => string;
  ensureConsent: ConsentFn;
}

/** Paste many scripts, and the app makes the videos one after another. */
export function QueuePanel({ channelId, channelName, ensureConsent }: Props) {
  const { items, running, add, remove, clearDone, retryFailed, run, stop } = useQueueStore();
  const [text, setText] = useState("");
  const parsed = parseScripts(text);
  const shown = channelId === null ? items : items.filter((item) => item.channelId === channelId);
  const counts = queueCounts(items);

  function addAll() {
    if (channelId === null || parsed.length === 0) return;
    add(channelId, channelName(channelId), parsed);
    setText("");
  }

  return (
    <div className="flex flex-col gap-4">
      {channelId !== null && (
        <Card title="Add videos to the queue" description="Paste one script per video. Put a line with only --- between them. A first line starting with # is the video title.">
          <Field label="Scripts" htmlFor="queue-text" hint={parsed.length > 0 ? `${parsed.length} ${parsed.length === 1 ? "video" : "videos"} found.` : "Nothing found yet."}>
            <textarea
              id="queue-text"
              value={text}
              rows={8}
              onChange={(e) => setText(e.target.value)}
              placeholder={"# Video one\nThe first script...\n---\n# Video two\nThe second script..."}
              className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm"
            />
          </Field>
          <div>
            <Button icon={ListPlus} disabled={parsed.length === 0} onClick={addAll}>
              Add {parsed.length > 0 ? parsed.length : ""} to the queue
            </Button>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted" aria-live="polite">
          {counts.waiting} waiting · {counts.running} making · {counts.done} finished · {counts.failed} failed
        </p>
        <div className="flex flex-wrap gap-2">
          {running ? (
            <Button variant="danger" icon={Square} onClick={stop}>
              Stop the queue
            </Button>
          ) : (
            <Button variant="primary" icon={Play} disabled={counts.waiting === 0} onClick={() => void run(ensureConsent)}>
              Start the queue
            </Button>
          )}
          <Button icon={RotateCw} disabled={running || counts.failed === 0} onClick={retryFailed}>
            Try failed again
          </Button>
          <Button icon={Trash2} disabled={counts.done === 0} onClick={clearDone}>
            Clear finished
          </Button>
        </div>
      </div>
      {running && <p className="text-xs text-muted">The queue keeps going when you open another page. Close the app and it stops after the video that is being made. No step waits for you to press Continue.</p>}

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">The queue is empty.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((item, index) => (
            <Row key={item.id} item={item} position={index + 1} channel={channelId === null ? channelName(item.channelId) : null} locked={running && item.status === "running"} onRemove={() => remove(item.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ item, position, channel, locked, onRemove }: { item: QueueItem; position: number; channel: string | null; locked: boolean; onRemove: () => void }) {
  const tone = item.status === "done" ? "text-success" : item.status === "failed" ? "text-danger" : item.status === "running" ? "text-accent" : "text-muted";
  return (
    <li className="flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3" data-state={item.status}>
      <span className="mt-0.5 w-5 text-xs text-muted">{position}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.name}</p>
        <p className="truncate text-xs text-muted">
          {channel ? `${channel} · ` : ""}
          {item.script.length.toLocaleString()} characters
        </p>
        {item.note && <p className="text-xs text-danger">{item.note}</p>}
      </div>
      <span className={`flex items-center gap-1.5 text-sm ${tone}`}>
        {item.status === "running" && <Loader2 size={14} className="animate-spin" aria-hidden />}
        {item.status === "done" && <Check size={14} aria-hidden />}
        {TEXT[item.status]}
      </span>
      <button type="button" disabled={locked} onClick={onRemove} aria-label={`Remove ${item.name} from the queue`} className="rounded-lg p-1 text-muted hover:text-fg disabled:opacity-40">
        <X size={16} aria-hidden />
      </button>
    </li>
  );
}
