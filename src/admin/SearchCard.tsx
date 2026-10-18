import { Download, Play, Search } from "lucide-react";
import { useState } from "react";

import { previewSound } from "../components/audio/useSfxLibrary";
import { Button, Card, IconButton, Select, TextInput } from "../components/ui";
import { JobBar } from "../components/voice/JobBar";
import { toAppError } from "../lib/errors";
import { runJob, selectJob, useJobStore } from "../store/jobStore";
import type { AppError } from "../types";
import { ErrorNotice } from "../components/ErrorNotice";
import { SOUND_CATEGORIES } from "./categories";
import { adminAddSound, adminSearch, type SearchPage, type SoundHit } from "./api";



interface Props {
  keySet: boolean;
  reload: () => Promise<void>;
}

/** Search Freesound (CC0 only), listen, choose category and tags, then download and normalize. */
export function SearchCard({ keySet, reload }: Props) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<SearchPage | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<SoundHit | null>(null);
  const [category, setCategory] = useState<string>("whoosh");
  const [tags, setTags] = useState("");
  const [trimStart, setTrimStart] = useState("0");
  const [trimEnd, setTrimEnd] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const job = useJobStore(selectJob(["admin-sound"]));

  const search = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      setPage(await adminSearch(query, 1));
    } catch (e) {
      setError(toAppError(e));
    } finally {
      setBusy(false);
    }
  };
  const choose = (hit: SoundHit) => {
    setChosen(hit);
    setTags(hit.tags.slice(0, 5).join(", "));
    setTrimStart("0");
    setTrimEnd("");
  };
  const add = async () => {
    if (!chosen) return;
    setError(null);
    try {
      const end = trimEnd.trim() === "" ? null : Number(trimEnd);
      const sound = await runJob("admin-sound", "Adding the sound", (id) =>
        adminAddSound({ freesoundId: chosen.id, name: chosen.name, username: chosen.username, license: chosen.license, previewUrl: chosen.previewUrl, category, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), trimStart: Number(trimStart) || 0, trimEnd: end !== null && Number.isFinite(end) ? end : null }, id),
      );
      setNotice(`Added “${sound.id}” (${sound.duration.toFixed(2)} s, normalized to -16 LUFS).`);
      setChosen(null);
      await reload();
    } catch (e) {
      setError(toAppError(e));
    }
  };

  return (
    <Card title="Find CC0 sounds" description="Only sounds with the CC0 (public domain) license are shown. The 10 ms fade and loudness are set for you." icon={Search}>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <TextInput aria-label="Search Freesound" placeholder="whoosh, impact, click…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button type="submit" variant="primary" loading={busy} disabled={!keySet || query.trim() === ""}>
          Search
        </Button>
      </form>
      {!keySet && <p className="text-xs text-muted">Save your Freesound key first.</p>}
      {error && <ErrorNotice error={error} />}
      {notice && <p className="text-sm" role="status">{notice}</p>}
      {page && <p className="text-xs text-muted">{page.hits.length} CC0 sounds on this page ({page.total} found in all).</p>}
      <ul className="flex flex-col gap-2">
        {page?.hits.map((hit) => (
          <li key={hit.id} className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2">
            <IconButton icon={Play} label={`Listen to ${hit.name}`} onClick={() => previewSound(hit.previewUrl)} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{hit.name}</p>
              <p className="truncate text-xs text-muted">{hit.duration.toFixed(1)} s · {hit.username} · {hit.tags.slice(0, 5).join(", ")}</p>
            </div>
            <Button icon={Download} onClick={() => choose(hit)}>Choose</Button>
          </li>
        ))}
      </ul>
      {chosen && (
        <div className="flex flex-col gap-3 rounded-xl border border-accent/40 bg-surface-2 p-4" data-testid="admin-add-form">
          <p className="text-sm font-medium">Add “{chosen.name}”</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
              {SOUND_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
            </Select>
            <TextInput aria-label="Tags (separated by commas)" placeholder="tags, like fast, air" value={tags} onChange={(e) => setTags(e.target.value)} className="sm:col-span-2" />
            <div className="flex gap-2">
              <TextInput aria-label="Trim start (seconds)" inputMode="decimal" value={trimStart} onChange={(e) => setTrimStart(e.target.value)} />
              <TextInput aria-label="Trim end (seconds)" inputMode="decimal" placeholder="end" value={trimEnd} onChange={(e) => setTrimEnd(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void add()} loading={job !== null}>Download and normalize</Button>
            <Button onClick={() => setChosen(null)}>Cancel</Button>
          </div>
          {job && <JobBar job={job} />}
        </div>
      )}
    </Card>
  );
}
