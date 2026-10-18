import { Trash2 } from "lucide-react";

import type { Character, Location } from "../../types";
import { IconButton, TextInput } from "../ui";

const AREA =
  "w-full resize-y rounded-lg border border-line bg-surface p-2.5 text-sm text-fg placeholder:text-muted/70 transition-colors hover:border-accent/40 focus:border-accent disabled:cursor-not-allowed disabled:opacity-60";

interface CardProps<T> {
  item: T;
  scenes: number;
  locked: boolean;
  onChange: (item: T) => void;
  onDelete: () => void;
}

/** One person: name, role and the fixed English description used in every prompt. */
export function CharacterCard({ item, scenes, locked, onChange, onDelete }: CardProps<Character>) {
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-4" data-testid="character-card">
      <div className="flex items-center gap-2">
        <TextInput aria-label="Character name" placeholder="Name" value={item.name} disabled={locked} onChange={(e) => onChange({ ...item, name: e.target.value })} className="h-9 font-medium" />
        <TextInput aria-label="Character role" placeholder="Role (e.g. grandmother)" value={item.role} disabled={locked} onChange={(e) => onChange({ ...item, role: e.target.value })} className="h-9" />
        <IconButton icon={Trash2} label={`Delete ${item.name || "character"}`} danger disabled={locked} onClick={onDelete} />
      </div>
      <textarea
        aria-label={`Appearance of ${item.name || "character"}`}
        rows={4}
        value={item.appearance}
        disabled={locked}
        placeholder="One fixed English description: age, gender, face, hair, body, clothing, one distinctive detail."
        onChange={(e) => onChange({ ...item, appearance: e.target.value })}
        className={AREA}
      />
      <p className="text-xs text-muted">
        {item.id} · appears in {scenes} {scenes === 1 ? "scene" : "scenes"}
      </p>
    </li>
  );
}

/** One place with its fixed English description. */
export function LocationCard({ item, scenes, locked, onChange, onDelete }: CardProps<Location>) {
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2 p-4" data-testid="location-card">
      <div className="flex items-center gap-2">
        <TextInput aria-label="Location name" placeholder="Name" value={item.name} disabled={locked} onChange={(e) => onChange({ ...item, name: e.target.value })} className="h-9 font-medium" />
        <IconButton icon={Trash2} label={`Delete ${item.name || "location"}`} danger disabled={locked} onClick={onDelete} />
      </div>
      <textarea
        aria-label={`Description of ${item.name || "location"}`}
        rows={3}
        value={item.description}
        disabled={locked}
        placeholder="One fixed English description of the place."
        onChange={(e) => onChange({ ...item, description: e.target.value })}
        className={AREA}
      />
      <select
        aria-label={`Sound mood of ${item.name || "location"}`}
        value={item.mood ?? ""}
        disabled={locked}
        onChange={(e) => onChange({ ...item, mood: e.target.value })}
        className="h-9 rounded-lg border border-line bg-surface px-2 text-sm"
      >
        <option value="">No background sound</option>
        <option value="calm">Calm background sound</option>
        <option value="tense">Tense background sound</option>
        <option value="nature">Nature background sound</option>
      </select>
      <p className="text-xs text-muted">
        {item.id} · used in {scenes} {scenes === 1 ? "scene" : "scenes"}
      </p>
    </li>
  );
}
