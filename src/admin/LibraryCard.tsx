import { convertFileSrc } from "@tauri-apps/api/core";
import { Library, Play, Trash2 } from "lucide-react";
import { useState } from "react";

import { previewSound } from "../components/audio/useSfxLibrary";
import { Button, Card, IconButton, Select, TextInput } from "../components/ui";
import { adminImportCurrent, adminRemoveSound, adminUpdateSound, type AdminOverview } from "./api";
import { SOUND_CATEGORIES } from "./categories";

interface Props {
  overview: AdminOverview;
  act: <T>(action: () => Promise<T>) => Promise<T | undefined>;
}

/** The working library: listen, change category/tags/volume, remove. */
export function LibraryCard({ overview, act }: Props) {
  const [tagEdits, setTagEdits] = useState<Record<string, string>>({});
  const sounds = overview.sounds.sounds;
  const urlOf = (file: string) => convertFileSrc(`${overview.sfxDir.replace(/[\\/]+$/, "")}/${file}`);
  return (
    <Card title={`Your working library (${sounds.length} sounds)`} description="Changes here go into the next package you build." icon={Library}>
      {sounds.length === 0 && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted">Empty. You can start from the sounds and styles that are in the app now.</p>
          <Button onClick={() => void act(adminImportCurrent)}>Start from the current library</Button>
        </div>
      )}
      {overview.sounds.warnings.map((w) => <p key={w} className="text-xs text-muted">{w}</p>)}
      <ul className="flex flex-col gap-2">
        {sounds.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2" data-testid={`admin-sound-${s.id}`}>
            <IconButton icon={Play} label={`Listen to ${s.id}`} onClick={() => previewSound(urlOf(s.file), s.defaultGain)} />
            <span className="min-w-0 flex-1 truncate text-sm">{s.id} <span className="text-xs text-muted">{s.duration.toFixed(2)} s</span></span>
            <Select aria-label={`Category of ${s.id}`} className="w-40" value={s.category} onChange={(e) => void act(() => adminUpdateSound(s.id, e.target.value, s.tags, s.defaultGain))}>
              {SOUND_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
            </Select>
            <TextInput aria-label={`Tags of ${s.id}`} className="w-52" value={tagEdits[s.id] ?? s.tags.join(", ")} onChange={(e) => setTagEdits({ ...tagEdits, [s.id]: e.target.value })} onBlur={() => {
              const text = tagEdits[s.id];
              if (text !== undefined) void act(() => adminUpdateSound(s.id, s.category, text.split(",").map((t) => t.trim()).filter(Boolean), s.defaultGain));
            }} />
            <IconButton icon={Trash2} danger label={`Remove ${s.id}`} onClick={() => void act(() => adminRemoveSound(s.id))} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
