import { Play, Plus, Search, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { previewSound, useSfxLibrary } from "../components/audio/useSfxLibrary";
import { ErrorNotice } from "../components/ErrorNotice";
import { LibraryStatusCard } from "../components/library";
import { Button, IconButton, SegmentedControl, TextInput } from "../components/ui";
import { cueForScene } from "../lib/audio/addCue";
import { readEditor } from "../lib/editor/model";
import { matchesSearch } from "../lib/library/text";
import { applyEdit } from "../store/historyStore";
import { useLibraryStore } from "../store/libraryStore";
import { useProjectStore } from "../store/projectStore";
import { useSceneFocusStore } from "../store/sceneFocusStore";
import { useSettingsStore } from "../store/settingsStore";
import type { SfxSound } from "../types";

const ORDER = ["whoosh", "hit", "pop", "riser", "ambience", "soft_swell", "click", "transition"] as const;
type View = "grid" | "list";

export function SfxLibraryPage() {
  const library = useSfxLibrary();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [view, setView] = useState<View>("grid");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);
  const project = useProjectStore((s) => s.project);
  const focus = useSceneFocusStore();
  const refreshStatus = useLibraryStore((s) => s.refresh);
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const favorites = useMemo(() => new Set(settings?.sfxFavorites ?? []), [settings?.sfxFavorites]);
  const visible = library.sounds.filter((s) => (category === "all" || s.category === category) && (!onlyFavorites || favorites.has(s.id)) && matchesSearch(s, query));
  const groups = ORDER.map((c) => ({ category: c, sounds: visible.filter((s) => s.category === c) })).filter((g) => g.sounds.length > 0);

  const scene = project && focus.projectId === project.id ? project.scenes.find((s) => s.id === focus.sceneId) ?? project.scenes[0] : project?.scenes[0];
  const toggleFavorite = (id: string) => {
    const next = new Set(favorites);
    if (!next.delete(id)) next.add(id);
    updateSettings({ sfxFavorites: [...next] });
  };
  const addToScene = (sound: SfxSound) => {
    const current = useProjectStore.getState().project;
    const target = current?.scenes.find((s) => s.id === scene?.id);
    if (!current || !target) return;
    const data = readEditor(current);
    const cue = cueForScene(target, sound, [...data.audio.addedCues, ...(data.audio.cues ?? [])], current.voiceDuration);
    // When the effects were edited by hand, the new sound goes into that list; otherwise it joins the planned ones.
    const audio = data.audio.cues ? { ...data.audio, cues: [...data.audio.cues, cue].sort((a, b) => a.time - b.time) } : { ...data.audio, addedCues: [...data.audio.addedCues, cue] };
    applyEdit({ editor: { ...data, audio } });
    setNotice(`Added “${sound.id.replace(/_/g, " ")}” at the start of ${target.id} (${cue.time.toFixed(1)} s). You can move it in the Audio tab of the Auto Editor.`);
  };

  const card = (s: SfxSound) => (
    <li key={s.id} className={`flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 ${view === "grid" ? "" : "sm:col-span-2"}`} data-testid={`sound-${s.id}`}>
      <IconButton icon={Play} label={`Listen to ${s.id}`} onClick={() => previewSound(library.urlOf(s.file), s.defaultGain)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{s.id.replace(/_/g, " ")}</p>
        <p className="truncate text-xs text-muted">{s.duration.toFixed(1)} s · {s.tags.join(", ")}</p>
      </div>
      <IconButton icon={Star} label={favorites.has(s.id) ? `Remove ${s.id} from favorites` : `Add ${s.id} to favorites`} aria-pressed={favorites.has(s.id)} className={favorites.has(s.id) ? "text-accent" : ""} onClick={() => toggleFavorite(s.id)} />
      <IconButton icon={Plus} label={`Add ${s.id} to current scene`} disabled={!scene} onClick={() => addToScene(s)} />
    </li>
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6" data-testid="sfx-library">
      <header>
        <h1 className="text-2xl font-semibold">SFX Library</h1>
        <p className="mt-1 text-sm text-muted">
          Listen to sounds, mark favorites, and add one to the scene that is selected in the Auto Editor
          {scene ? ` (now: ${scene.id})` : " (open a project with scenes first)"}.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <TextInput aria-label="Search sounds by name or tag" placeholder="Search by tag, e.g. fast, boom, soft" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Button aria-pressed={onlyFavorites} icon={Star} onClick={() => setOnlyFavorites(!onlyFavorites)} variant={onlyFavorites ? "primary" : "secondary"}>
          Favorites
        </Button>
        <SegmentedControl
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: "grid", label: "Grid" },
            { value: "list", label: "List" },
          ]}
        />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Category">
        {["all", ...ORDER].map((c) => (
          <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)} className={`cursor-pointer rounded-full border px-3 py-1 text-xs capitalize ${category === c ? "border-accent bg-accent-soft text-accent-fg" : "border-line text-muted hover:border-accent/50"}`}>
            {c.replace("_", " ")}
          </button>
        ))}
      </div>

      {notice && <p className="text-sm" role="status" data-testid="sfx-notice">{notice}</p>}
      {library.error && <ErrorNotice error={library.error} />}
      {library.warnings.map((w) => (
        <p key={w} className="text-sm text-muted">{w}</p>
      ))}
      {library.loading && <p className="text-sm text-muted">Loading…</p>}
      {!library.loading && groups.length === 0 && <p className="text-sm text-muted" data-testid="sfx-empty">No sounds match.</p>}

      {groups.map((g) => (
        <section key={g.category} className="rounded-2xl border border-line bg-surface p-5 shadow-card" aria-label={g.category}>
          <h2 className="mb-3 text-sm font-semibold capitalize">{g.category.replace("_", " ")}</h2>
          <ul className={`grid gap-2 ${view === "grid" ? "sm:grid-cols-2" : ""}`}>{g.sounds.map(card)}</ul>
        </section>
      ))}

      <LibraryStatusCard />
    </div>
  );
}
