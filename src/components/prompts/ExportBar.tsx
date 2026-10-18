import { ArrowRight, Check, ClipboardCopy, FileJson, FileSpreadsheet, FileText } from "lucide-react";

import { Button } from "../ui";

interface ExportBarProps {
  disabled: boolean;
  copied: boolean;
  onCopyAll: () => void;
  onExport: (kind: "txt" | "csv" | "json") => void;
  onSend: () => void;
}

/** Copy All, the three exports, and the hand-over to the Auto Editor. */
export function ExportBar({ disabled, copied, onCopyAll, onExport, onSend }: ExportBarProps) {
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
      <Button variant="primary" icon={ArrowRight} disabled={disabled} onClick={onSend}>
        Send to Auto Editor
      </Button>
    </div>
  );
}
