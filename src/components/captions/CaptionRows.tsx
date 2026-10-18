import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "../../lib/cn";
import type { CaptionLine } from "../../types";
import { IconButton } from "../ui";

interface RowProps {
  line: CaptionLine;
  index: number;
  rtl: boolean;
  active: boolean;
  onSeek: (time: number) => void;
  onText: (index: number, text: string) => void;
  onTimes: (index: number, start: number, end: number) => void;
  onRemove: (index: number) => void;
}

function TimeBox({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => void }) {
  const [text, setText] = useState(value.toFixed(2));
  useEffect(() => setText(value.toFixed(2)), [value]);
  const commit = () => {
    const parsed = Number(text);
    if (Number.isFinite(parsed) && parsed >= 0) onCommit(parsed);
    else setText(value.toFixed(2));
  };
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className="h-7 w-16 rounded-md border border-line bg-surface px-1.5 text-xs tabular-nums"
    />
  );
}

/** One caption: its times and its text (a new line in the box makes a two-line caption). */
function Row({ line, index, rtl, active, onSeek, onText, onTimes, onRemove }: RowProps) {
  const [text, setText] = useState(line.text);
  useEffect(() => setText(line.text), [line.text]);
  return (
    <li className={cn("flex flex-col gap-1.5 rounded-xl border bg-surface-2 p-2", active ? "border-accent" : "border-line")} data-testid="caption-row" data-line={line.id}>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <button type="button" className="cursor-pointer font-mono hover:text-fg" onClick={() => onSeek(line.start)} title="Jump here">
          {line.id}
        </button>
        <TimeBox label={`Start of ${line.id}`} value={line.start} onCommit={(start) => onTimes(index, start, line.end)} />
        <span>to</span>
        <TimeBox label={`End of ${line.id}`} value={line.end} onCommit={(end) => onTimes(index, line.start, end)} />
        <span className="flex-1" />
        <IconButton icon={Trash2} danger label={`Delete caption ${line.id}`} onClick={() => onRemove(index)} />
      </div>
      <textarea
        aria-label={`Text of ${line.id}`}
        dir={rtl ? "rtl" : "auto"}
        rows={Math.min(3, text.split("\n").length)}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== line.text && onText(index, text)}
        className="w-full resize-none rounded-md border border-line bg-surface px-2 py-1 text-sm"
      />
    </li>
  );
}

interface CaptionRowsProps {
  lines: readonly CaptionLine[];
  rtl: boolean;
  time: number;
  onSeek: (time: number) => void;
  onText: (index: number, text: string) => void;
  onTimes: (index: number, start: number, end: number) => void;
  onRemove: (index: number) => void;
}

export function CaptionRows({ lines, rtl, time, onSeek, onText, onTimes, onRemove }: CaptionRowsProps) {
  if (lines.length === 0) return <p className="text-sm text-muted">There are no captions yet.</p>;
  return (
    <ul className="flex flex-col gap-2" aria-label="Captions">
      {lines.map((line, index) => (
        <Row key={line.id} line={line} index={index} rtl={rtl} active={time >= line.start && time < line.end} onSeek={onSeek} onText={onText} onTimes={onTimes} onRemove={onRemove} />
      ))}
    </ul>
  );
}
