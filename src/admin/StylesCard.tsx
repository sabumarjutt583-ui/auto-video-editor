import { Palette, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button, Card, IconButton } from "../components/ui";
import { adminReadStyle, adminRemoveStyle, adminSaveStyle, type AdminOverview } from "./api";

interface Props {
  overview: AdminOverview;
  act: <T>(action: () => Promise<T>) => Promise<T | undefined>;
}

/** Add or change a style profile (its JSON) for the next styles package. */
export function StylesCard({ overview, act }: Props) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <Card title={`Style profiles (${overview.styles.length})`} description="Paste a style's JSON and save it. A style with an existing id replaces that style." icon={Palette}>
      <ul className="flex flex-wrap gap-2">
        {overview.styles.map((s) => (
          <li key={s.id} className="flex items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pr-1 pl-3 text-xs">
            <button type="button" className="cursor-pointer hover:text-accent" onClick={() => void act(() => adminReadStyle(s.id)).then((t) => t !== undefined && setText(t))}>
              {s.name || s.id}
            </button>
            <IconButton icon={Trash2} danger label={`Remove style ${s.id}`} onClick={() => void act(() => adminRemoveStyle(s.id))} />
          </li>
        ))}
      </ul>
      <textarea aria-label="Style JSON" className="h-48 w-full rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} placeholder='{ "id": "my_style", "name": "My style", "category": "…", … }' />
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={text.trim() === ""} onClick={() => void act(() => adminSaveStyle(text)).then((id) => id !== undefined && setSaved(id))}>
          Save style
        </Button>
        {saved && <span className="text-sm" role="status">Saved “{saved}”.</span>}
      </div>
    </Card>
  );
}
