import { Clapperboard, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ErrorNotice } from "../components/ErrorNotice";
import {
  DeleteProjectDialog,
  NameDialog,
  ProjectCard,
  ProjectsToolbar,
  UnreadableProjects,
  useProjectList,
} from "../components/projects";
import { useProfiles } from "../components/pipeline";
import { Button } from "../components/ui";
import { applyChannelProfile } from "../lib/pipeline/impl/applyProfile";
import { toAppError } from "../lib/errors";
import { filterAndSort, type ProjectSort } from "../lib/projectList";
import { createProject, deleteProject, duplicateProject, renameProject } from "../lib/projects";
import { useProjectStore } from "../store/projectStore";
import type { AppError } from "../types";

type Dialog =
  | { kind: "new" }
  | { kind: "rename"; id: string; name: string }
  | { kind: "delete"; id: string; name: string };

export function ProjectsPage() {
  const navigate = useNavigate();
  const { list, loading, error: loadError, reload } = useProjectList();
  const profiles = useProfiles();
  const currentId = useProjectStore((state) => state.project?.id ?? null);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProjectSort>("newest");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [actionError, setActionError] = useState<AppError | null>(null);

  const visible = useMemo(() => filterAndSort(list.projects, query, sort), [list.projects, query, sort]);

  /** Runs a button action, showing a friendly error if it fails. */
  async function attempt(action: () => Promise<void>, fallback: string) {
    setActionError(null);
    try {
      await action();
    } catch (caught) {
      setActionError(toAppError(caught, fallback));
    }
  }

  const openProject = (id: string) =>
    attempt(async () => {
      await useProjectStore.getState().open(id);
      navigate("/prompt-generator");
    }, "The project could not be opened.");

  const duplicate = (id: string) =>
    attempt(async () => {
      // A project that is open may have a change that has not been saved yet.
      if (id === currentId) await useProjectStore.getState().flush();
      await duplicateProject(id);
      await reload();
    }, "The project could not be copied.");

  async function create(name: string, channelId: string) {
    const made = await createProject(name);
    const profile = profiles.profiles.find((p) => p.id === channelId);
    if (profile) {
      // The new video starts with the channel's settings and stays linked to it.
      const store = useProjectStore.getState();
      await store.flush();
      await store.open(made.id);
      applyChannelProfile(profile);
      await store.flush();
    }
    await reload();
    setDialog(null);
  }

  async function rename(id: string, name: string) {
    const store = useProjectStore.getState();
    if (id === currentId) {
      // The open project is renamed through the store, so the top bar changes at once.
      store.update({ name });
      await store.flush();
      const { saveState, saveError } = useProjectStore.getState();
      if (saveState === "error" && saveError) throw saveError;
    } else {
      await renameProject(id, name);
    }
    await reload();
    setDialog(null);
  }

  async function remove(id: string) {
    await deleteProject(id);
    if (id === currentId) useProjectStore.getState().discard();
    await reload();
    setDialog(null);
  }

  const hasProjects = list.projects.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <ProjectsToolbar
        query={query}
        sort={sort}
        onQueryChange={setQuery}
        onSortChange={setSort}
        onNewProject={() => setDialog({ kind: "new" })}
      />

      {loadError && <ErrorNotice error={loadError} />}
      {actionError && <ErrorNotice error={actionError} />}

      {loading ? (
        <p className="text-sm text-muted">Loading projects…</p>
      ) : visible.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-5">
          {visible.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isCurrent={project.id === currentId}
              channelName={profiles.profiles.find((p) => p.id === project.channelId)?.name ?? null}
              onOpen={() => void openProject(project.id)}
              onRename={() => setDialog({ kind: "rename", id: project.id, name: project.name })}
              onDuplicate={() => void duplicate(project.id)}
              onDelete={() => setDialog({ kind: "delete", id: project.id, name: project.name })}
            />
          ))}
        </div>
      ) : hasProjects ? (
        <p className="text-sm text-muted">No projects match “{query.trim()}”.</p>
      ) : (
        !loadError && (
          <section className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface p-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent-fg">
              <Clapperboard size={22} aria-hidden />
            </span>
            <h2 className="text-base font-semibold tracking-tight">No projects yet</h2>
            <p className="max-w-sm text-sm text-muted">
              A project holds one video: its voice-over, scenes, prompts and media.
            </p>
            <Button variant="primary" icon={Plus} onClick={() => setDialog({ kind: "new" })}>
              Create your first project
            </Button>
          </section>
        )
      )}

      <UnreadableProjects
        projects={list.unreadable}
        onDelete={(project) => setDialog({ kind: "delete", id: project.id, name: `Unreadable project (${project.id})` })}
      />

      {dialog?.kind === "new" && (
        <NameDialog
          title="New project"
          confirmLabel="Create"
          initialName="My new video"
          channels={profiles.profiles}
          initialChannelId={profiles.chosen?.id ?? ""}
          onSubmit={create}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "rename" && (
        <NameDialog
          title="Rename project"
          confirmLabel="Rename"
          initialName={dialog.name}
          onSubmit={(name) => rename(dialog.id, name)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteProjectDialog
          name={dialog.name}
          onConfirm={() => remove(dialog.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
