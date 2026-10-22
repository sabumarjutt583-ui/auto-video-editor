import { ArrowRight, Check, ClipboardCopy, FileJson, FileSpreadsheet, FileText } from "lucide-react";

import { Button, Checkbox, Select } from "../ui";

interface ExportBarProps {
  disabled: boolean;
  copied: boolean;
  onCopyAll: () => void;
  onExport: (kind: "txt" | "csv" | "json") => void;
  onSend: () => void;
  emptyLines: number;
  includeIds: boolean;
  onEmptyLines: (count: number) => void;
  onIncludeIds: (on: boolean) => void;
  /** Quick mode has no editor to send to. */
  hideSend?: boolean;
}

/** Copy All, the three exports, and the hand-over to the Auto Editor. */
export function ExportBar({ disabled, copied, onCopyAll, onExport, onSend, emptyLines, includeIds, onEmptyLines, onIncludeIds, hideSend = false }: ExportBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button icon={copied ? Check : ClipboardCopy} disabled={disabled} onClick={onCopyAll}>
        {copied ? "Copied" : "Copy all"}
      </Button>
      <Button icon={FileText} disabled={disabled} onClick={() => onExport("txt")}>
        Export TXT
      </Button>
      <Button icon={FileSpreadsheet} disabled={disabled} onClick={() => onExport("csv")}>
        Export CSV
      </Button>
      <Button icon={FileJson} disabled={disabled} onClick={() => onExport("json")}>
        Export JSON
      </Button>
      <div className="flex-1" />
      {!hideSend && (
        <Button variant="primary" icon={ArrowRight} disabled={disabled} onClick={onSend}>
          Send to Auto Editor
        </Button>
      )}
      <div className="flex basis-full flex-wrap items-center gap-4" aria-label="Copy and TXT options">
        <label className="flex items-center gap-2 text-sm text-muted">
          Empty lines between prompts
          <Select aria-label="Empty lines between prompts" className="h-9 w-20" value={emptyLines} onChange={(e) => onEmptyLines(Number(e.target.value))}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </label>
        <Checkbox label="Include IDs" checked={includeIds} onChange={(e) => onIncludeIds(e.target.checked)} />
      </div>
    </div>
  );
}
