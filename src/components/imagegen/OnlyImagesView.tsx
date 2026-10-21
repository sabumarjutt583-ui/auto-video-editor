import { FolderOpen, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { toAppError } from "../../lib/errors";
import { pickFolder } from "../../lib/dialog";
import { imagegenPause, imagegenRemoveJobs, imagegenResume, imagegenRetryFailed, imagegenStartFolder } from "../../lib/imagegen/api";
import { buildFolderJobs, parsePrompts } from "../../lib/imagegen/prompts";
import { useImageGenStore } from "../../store/imagegenStore";
import type { AppError } from "../../types";
import type { PictureAspect } from "../../types/imagegen";
import { ErrorNotice } from "../ErrorNotice";
import { Button, SegmentedControl } from "../ui";
import { Controls } from "./Controls";
import { FolderPictureCard } from "./FolderPictureCard";
import { PromptEditModal } from "./PromptEditModal";
import { useConsent } from "./useConsent";

const FOLDER_KEY = "imagegen.onlyImagesFolder";
const ASPECTS = [
  { value: "16:9", label: "16:9 wide" },
  { value: "9:16", label: "9:16 tall" },
  { value: "1:1", label: "1:1 square" },
] as const;

function readFolder(): string {
  try {
    return localStorage.getItem(FOLDER_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberFolder(folder: string): void {
  try {
    localStorage.setItem(FOLDER_KEY, folder);
  } catch {
    // Not remembering the folder is fine.
  }
}

/** "Only images" mode: type or paste prompts, pictures are saved in a folder. No project needed. */
export function OnlyImagesView() {
  const snapshot = useImageGenStore((state) => state.snapshot);
  const storeError = useImageGenStore((state) => state.error);
  const { ensure, dialog } = useConsent();
  const [folder, setFolder] = useState(readFolder);
  const [text, setText] = useState("");
  const [aspect, setAspect] = useState<PictureAspect>("16:9");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [info, setInfo] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);

  // Attach the folder to the engine (without starting) so its earlier pictures show up.
  useEffect(() => {
    if (folder === "") return;
    let live = true;
    void (async () => {
      try {
        await useImageGenStore.getState().init();
        if (useImageGenStore.getState().snapshot?.projectDir !== folder) await imagegenStartFolder(folder, [], false, false);
      } catch (failure) {
        if (live) setError(toAppError(failure, "This folder could not be opened."));
      }
    })();
    return () => {
      live = false;
    };
  }, [folder]);

  const attached = snapshot !== null && folder !== "" && snapshot.projectDir === folder;
  const jobs = useMemo(() => (attached ? (snapshot?.jobs ?? []) : []), [attached, snapshot?.jobs]);
  const prompts = useMemo(() => parsePrompts(text), [text]);
  const editingJob = jobs.find((job) => job.id === editing) ?? null;

  async function guarded(job: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (failure) {
      setError(toAppError(failure, "That did not work."));
    } finally {
      setBusy(false);
    }
  }

  function choose() {
    void guarded(async () => {
      const picked = await pickFolder("Folder for the pictures", folder || undefined);
      if (!picked) return;
      rememberFolder(picked);
      setFolder(picked);
      setSelected(new Set());
    });
  }

  function generate() {
    void guarded(async () => {
      if (folder === "" || prompts.length === 0 || !(await ensure())) return;
      const report = await imagegenStartFolder(folder, buildFolderJobs(prompts, aspect, jobs), false, true);
      setInfo(`${report.added} picture${report.added === 1 ? "" : "s"} added. They are saved in the "media" folder inside your folder.`);
      setText("");
    });
  }

  function again(id: string, prompt?: string) {
    void guarded(async () => {
      const job = jobs.find((item) => item.id === id);
      if (!job || !(await ensure())) return;
      await imagegenStartFolder(folder, [{ sceneId: id, fileName: job.fileName, prompt: prompt ?? job.prompt, aspect: job.aspect as PictureAspect }], true, true);
      setEditing(null);
    });
  }

  if (!snapshot) return storeError ? <ErrorNotice error={storeError} /> : <p className="text-sm text-muted">Loading…</p>;

  const stats = attached ? snapshot.stats : { total: 0, queued: 0, generating: 0, completed: 0, failed: 0 };

  return (
    <div className="flex flex-col gap-6">
      {dialog}
      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button icon={FolderOpen} onClick={choose} disabled={busy}>
            {folder ? "Change folder" : "Choose folder"}
          </Button>
          <span className="min-w-0 truncate text-sm text-muted" title={folder}>
            {folder || "Pictures are saved in the folder you choose."}
          </span>
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Your prompts
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={8}
            placeholder={"Prompt 1: a lonely lighthouse at dawn...\nPrompt 2: a fisherman mending his net...\n\nOr write one prompt on each line."}
            className="rounded-xl border border-line bg-surface-2 p-3 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl label="Picture shape" options={ASPECTS} value={aspect} onChange={setAspect} />
          <span className="text-sm text-muted">{prompts.length} prompt{prompts.length === 1 ? "" : "s"} found</span>
          <Button variant="primary" icon={Sparkles} onClick={generate} disabled={busy || folder === "" || prompts.length === 0}>
            Add and generate
          </Button>
        </div>
      </section>
      <Controls
        stats={stats}
        running={attached && snapshot.running}
        selected={selected.size}
        busy={busy}
        onPause={() => void guarded(imagegenPause)}
        onResume={() => void guarded(async () => ((await ensure()) ? imagegenResume() : undefined))}
        onRetryFailed={() => void guarded(async () => ((await ensure()) ? void (await imagegenRetryFailed([])) : undefined))}
        onRegenerateSelected={() => {
          for (const id of selected) again(id);
          setSelected(new Set());
        }}
      />
      {info && <p role="status" className="text-sm text-muted">{info}</p>}
      {error && <ErrorNotice error={error} />}
      {storeError && <ErrorNotice error={storeError} />}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {jobs.map((job) => (
          <FolderPictureCard
            key={job.id}
            job={job}
            folder={folder}
            selected={selected.has(job.id)}
            onSelect={(on) =>
              setSelected((current) => {
                const next = new Set(current);
                if (on) next.add(job.id);
                else next.delete(job.id);
                return next;
              })
            }
            onRegenerate={() => again(job.id)}
            onEdit={() => setEditing(job.id)}
            onRemove={() => void guarded(async () => void (await imagegenRemoveJobs([job.id])))}
          />
        ))}
      </ul>
      {editingJob && <PromptEditModal sceneId={editingJob.fileName} prompt={editingJob.prompt} saveOnly={false} onSave={(value) => again(editingJob.id, value)} onClose={() => setEditing(null)} />}
    </div>
  );
}
