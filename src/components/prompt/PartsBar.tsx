import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { swapVoiceFiles } from "../../lib/audio";
import { cn } from "../../lib/cn";
import { toAppError } from "../../lib/errors";
import { activeId, addPartPatch, MAX_PARTS, nextPartName, partTabs, removePartPatch, renamePartPatch, switchPartPatch } from "../../lib/parts";
import { useProjectStore } from "../../store/projectStore";
import type { AppError, Project } from "../../types";
import { Button, TextInput } from "../ui";

/** Voice-over in several parts: one tab per part, a button for the next part, a name for each part. */
export function PartsBar({ project }: { project: Project }) {
  const update = useProjectStore((state) => state.update);
  const flush = useProjectStore((state) => state.flush);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [renaming, setRenaming] = useState(false);
  const tabs = partTabs(project);
  const current = activeId(project);
  const currentName = tabs.find((t) => t.active)?.name ?? "Part 1";
  const [draft, setDraft] = useState(currentName);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(toAppError(caught, "The part could not be changed."));
    } finally {
      setBusy(false);
    }
  }

  const open = (id: string) =>
    run(async () => {
      const patch = switchPartPatch(project, id);
      if (!patch) return;
      await swapVoiceFiles(project.id, current, id);
      update(patch);
      await flush();
    });

  const addNext = () =>
    run(async () => {
      await swapVoiceFiles(project.id, current, null);
      update(addPartPatch(project, nextPartName(project)));
      await flush();
    });

  function saveName() {
    update(renamePartPatch(project, current, draft));
    setRenaming(false);
  }

  function remove(id: string) {
    const patch = removePartPatch(project, id);
    if (patch) update(patch);
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface px-4 py-3" aria-label="Voice-over parts">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Voice-over parts:</span>
        {tabs.map((tab) => (
          <span key={tab.id} className="inline-flex items-center gap-1">
            <button
              type="button"
              disabled={busy || tab.active}
              onClick={() => void open(tab.id)}
              aria-current={tab.active ? "true" : undefined}
              className={cn("h-8 rounded-lg border px-3 text-sm", tab.active ? "border-accent bg-accent/15 text-fg" : "border-line text-muted hover:border-accent/60")}
            >
              {tab.name}
            </button>
            {!tab.active && (
              <button type="button" disabled={busy} onClick={() => remove(tab.id)} aria-label={`Remove ${tab.name}`} title={`Remove ${tab.name}`} className="rounded p-1 text-muted hover:text-danger">
                <Trash2 size={14} aria-hidden />
              </button>
            )}
          </span>
        ))}
        <Button icon={Plus} disabled={busy || tabs.length >= MAX_PARTS} onClick={() => void addNext()}>
          Add next part
        </Button>
        <Button
          icon={Pencil}
          disabled={busy}
          onClick={() => {
            setDraft(currentName);
            setRenaming((v) => !v);
          }}
        >
          Rename
        </Button>
      </div>
      {renaming && (
        <div className="flex items-center gap-2">
          <TextInput value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveName()} aria-label="Part name" className="max-w-xs" />
          <Button variant="primary" onClick={saveName}>
            Save name
          </Button>
        </div>
      )}
      {tabs.length > 1 && <p className="text-xs text-muted">You are working on “{currentName}”. Each part has its own voice, timing, scenes and prompts. Style, cast and settings are shared.</p>}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}
