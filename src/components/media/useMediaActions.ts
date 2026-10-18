import { useCallback, useEffect, useMemo, useState } from "react";

import { pickFolder, pickMediaFiles } from "../../lib/dialog";
import { followFileTime } from "../../lib/editor/boundaries";
import { contextOf } from "../../lib/editor/context";
import { readEditor } from "../../lib/editor/model";
import { isCancelled, toAppError } from "../../lib/errors";
import { checkMedia, importMedia, matchMediaWithGemini, removeMedia, scanMedia } from "../../lib/media/api";
import { fromImported, sortSources, type SortBy } from "../../lib/media/files";
import { addFiles, assignFile, chooseFor, emptyScenes, matchByOrder, unmatched, type Placement } from "../../lib/media/place";
import type { RenameRow } from "../../lib/media/rename";
import { validate, type Issue } from "../../lib/media/validate";
import { applyEdit } from "../../store/historyStore";
import { runJob, selectJob, useJobStore, type JobInfo } from "../../store/jobStore";
import { useProjectStore } from "../../store/projectStore";
import { useThumbStore } from "../../store/thumbStore";
import type { AppError, EditorData, MediaFile, Project, ProjectPatch, Scene } from "../../types";

export interface MediaActions {
  editor: EditorData;
  issues: Issue[];
  exists: Record<string, boolean>;
  job: JobInfo | null;
  error: AppError | null;
  notice: string | null;
  addPaths: (paths: string[]) => Promise<void>;
  chooseFiles: () => Promise<void>;
  chooseFolder: () => Promise<void>;
  assign: (path: string, sceneId: string | null) => void;
  pick: (sceneId: string, path: string) => void;
  remove: (path: string) => Promise<void>;
  byOrder: (sort: SortBy) => void;
  withGemini: () => Promise<void>;
  replace: (sceneId: string) => Promise<void>;
  followFile: (sceneId: string) => void;
  followProject: (sceneId: string) => void;
  setPlaceholder: (value: EditorData["placeholder"]) => void;
  renameImport: (rows: readonly RenameRow[]) => Promise<boolean>;
  recheck: () => Promise<void>;
}

interface Change {
  media?: MediaFile[];
  mediaMap?: Record<string, string>;
  scenes?: Scene[];
  extra?: Partial<EditorData>;
}

/** Everything the Media step does: import, match, rename, validate. */
export function useMediaActions(project: Project): MediaActions {
  const job = useJobStore(selectJob(["media"]));
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exists, setExists] = useState<Record<string, boolean>>({});
  const editor = useMemo(() => readEditor(project), [project]);
  const projectId = project.id;

  /** Applies a change to the newest project (not the one this render saw) and remembers it for Undo. */
  const commit = useCallback(
    (make: (current: Project, data: EditorData) => Change | null) => {
      const current = useProjectStore.getState().project;
      if (!current || current.id !== projectId) return;
      const data = readEditor(current);
      const change = make(current, data);
      if (!change) return;
      const patch: ProjectPatch = { editor: { ...data, ...(change.extra ?? {}), ...(change.media ? { media: change.media } : {}) } };
      if (change.mediaMap) patch.mediaMap = change.mediaMap;
      if (change.scenes) patch.scenes = change.scenes;
      applyEdit(patch);
    },
    [projectId],
  );

  const place = (placement: Placement): Change => ({ media: placement.media, mediaMap: placement.mediaMap });

  const recheck = useCallback(async () => {
    const current = useProjectStore.getState().project;
    if (!current || current.id !== projectId) return;
    const files = readEditor(current).media;
    if (files.length === 0) {
      setExists({});
      return;
    }
    try {
      const answer = await checkMedia(projectId, files.map((f) => f.path));
      setExists(Object.fromEntries(files.map((f, i) => [f.path, answer[i] !== false])));
    } catch {
      // If the check itself fails, do not claim anything is missing.
    }
  }, [projectId]);

  // Look at the folder when the step opens, when files change, and when the window gets focus back.
  const paths = editor.media.map((m) => m.path).join("|");
  useEffect(() => {
    void recheck();
  }, [recheck, paths]);
  useEffect(() => {
    const onFocus = () => void recheck();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [recheck]);

  const fail = (caught: unknown, fallback: string) => {
    if (isCancelled(caught)) setNotice("Cancelled.");
    else setError(toAppError(caught, fallback));
  };

  const addPaths = useCallback(
    async (dropped: string[]) => {
      setError(null);
      setNotice(null);
      try {
        const scan = await runJob("media", "Reading the files", (id) => scanMedia(dropped, id));
        if (scan.files.length === 0) {
          setNotice(scan.skipped.length > 0 ? `Nothing could be used. ${scan.skipped[0]?.reason ?? ""}` : "No pictures or clips were found there.");
          return;
        }
        const result = await runJob("media", "Copying into the project", (id) => importMedia(projectId, scan.files.map((f) => ({ source: f.path })), id));
        commit((current, data) => place(addFiles(data, current.mediaMap, current.scenes, result.imported.map(fromImported))));
        const failed = [...scan.skipped, ...result.failed];
        const matched = (() => {
          const current = useProjectStore.getState().project;
          if (!current) return 0;
          const names = new Set(result.imported.map((i) => i.path));
          return readEditor(current).media.filter((m) => names.has(m.path) && m.sceneId !== null).length;
        })();
        setNotice(`Added ${result.imported.length} files. ${matched} were placed on their scenes by name.${failed.length > 0 ? ` ${failed.length} could not be used.` : ""}`);
        if (failed.length > 0) setError({ message: `${failed.length} file${failed.length === 1 ? "" : "s"} could not be used.`, details: failed.map((f) => `${f.name}: ${f.reason} ${f.details}`).join("\n") });
        const current = useProjectStore.getState().project;
        if (current) void useThumbStore.getState().ensure(projectId, readEditor(current).media);
      } catch (caught) {
        fail(caught, "The files could not be added.");
      }
    },
    [projectId, commit],
  );

  const chooseFiles = useCallback(async () => {
    const picked = await pickMediaFiles("Choose pictures and clips");
    if (picked.length > 0) await addPaths(picked);
  }, [addPaths]);

  const chooseFolder = useCallback(async () => {
    const folder = await pickFolder("Choose the folder with your pictures and clips");
    if (folder) await addPaths([folder]);
  }, [addPaths]);

  const assign = (path: string, sceneId: string | null) =>
    commit((current, data) => place(assignFile(data, current.mediaMap, current.scenes, path, sceneId)));

  const pick = (sceneId: string, path: string) => commit((current) => ({ mediaMap: chooseFor(current.mediaMap, sceneId, path) }));

  const remove = async (path: string) => {
    setError(null);
    try {
      await removeMedia(projectId, [path]);
    } catch (caught) {
      setError(toAppError(caught, "The file could not be removed."));
    }
    commit((current, data) => {
      const media = data.media.filter((m) => m.path !== path);
      const mediaMap = Object.fromEntries(Object.entries(current.mediaMap).filter(([, p]) => p !== path));
      // A scene that loses its chosen file takes another file of the same scene, if there is one.
      for (const scene of current.scenes) {
        if (mediaMap[scene.id] === undefined) {
          const other = media.find((m) => m.sceneId === scene.id);
          if (other) mediaMap[scene.id] = other.path;
        }
      }
      return { media, mediaMap };
    });
    useThumbStore.getState().forget([path]);
  };

  const byOrder = (sort: SortBy) =>
    commit((current, data) => {
      const free = unmatched(data.media);
      const ordered = sortSources(free, sort);
      const pairs = matchByOrder(data.media, current.scenes, ordered, exists);
      if (pairs.length === 0) {
        setNotice(emptyScenes(data.media, current.scenes, exists).length === 0 ? "Every scene already has a file." : "There are no unmatched files.");
        return null;
      }
      let state: Placement = { media: data.media, mediaMap: current.mediaMap };
      for (const pair of pairs) state = assignFile({ media: state.media }, state.mediaMap, current.scenes, pair.path, pair.sceneId, "order");
      setNotice(`Matched ${pairs.length} files by order. Check them in the list below.`);
      return place(state);
    });

  const withGemini = async () => {
    setError(null);
    setNotice(null);
    const current = useProjectStore.getState().project;
    if (!current) return;
    const data = readEditor(current);
    const files = unmatched(data.media);
    const scenes = emptyScenes(data.media, current.scenes, exists);
    if (files.length === 0 || scenes.length === 0) {
      setNotice(files.length === 0 ? "There are no unmatched files." : "Every scene already has a file.");
      return;
    }
    try {
      const matches = await runJob("media", "Asking Gemini to match the files", (id) =>
        matchMediaWithGemini(projectId, files.map((f) => ({ name: f.name, path: f.path, kind: f.kind, duration: f.duration })), scenes.map((s) => ({ id: s.id, text: s.text })), id),
      );
      const byName = new Map(files.map((f) => [f.name, f]));
      commit((latest, latestData) => {
        let state: Placement = { media: latestData.media, mediaMap: latest.mediaMap };
        let count = 0;
        for (const match of matches) {
          const file = byName.get(match.file);
          if (!file) continue;
          state = assignFile({ media: state.media }, state.mediaMap, latest.scenes, file.path, match.sceneId, "gemini", match.confidence);
          count += 1;
        }
        setNotice(`Gemini matched ${count} of ${files.length} files. Please check the ones marked with low confidence.`);
        return place(state);
      });
    } catch (caught) {
      fail(caught, "Gemini could not match the files.");
    }
  };

  /** Lets the user choose one file for a scene; it is copied into the project and put on that scene. */
  const replace = async (sceneId: string) => {
    setError(null);
    setNotice(null);
    const [source] = await pickMediaFiles("Choose the picture or clip for this scene");
    if (!source) return;
    try {
      const scan = await runJob("media", "Reading the file", (id) => scanMedia([source], id));
      if (scan.files.length === 0) {
        setNotice(scan.skipped[0]?.reason ?? "That file could not be used.");
        return;
      }
      const result = await runJob("media", "Copying into the project", (id) => importMedia(projectId, scan.files.map((f) => ({ source: f.path })), id));
      const added = result.imported.map(fromImported)[0];
      if (!added) return;
      commit((current, data) => {
        const state = addFiles(data, current.mediaMap, current.scenes, [added]);
        return place(assignFile({ media: state.media }, state.mediaMap, current.scenes, added.path, sceneId));
      });
      const current = useProjectStore.getState().project;
      if (current) void useThumbStore.getState().ensure(projectId, readEditor(current).media);
    } catch (caught) {
      fail(caught, "The file could not be added.");
    }
  };

  const followFile = (sceneId: string) =>
    commit((current, data) => {
      const index = current.scenes.findIndex((s) => s.id === sceneId);
      const file = data.media.find((m) => m.path === current.mediaMap[sceneId]);
      if (index < 0 || !file || file.start === null || file.end === null) return null;
      const scenes = followFileTime(current.scenes, index, file.start, file.end, contextOf(current));
      return { scenes, extra: { timeChoices: { ...data.timeChoices, [sceneId]: "file" } } };
    });

  const followProject = (sceneId: string) => commit((_current, data) => ({ extra: { timeChoices: { ...data.timeChoices, [sceneId]: "project" } } }));

  const setPlaceholder = (value: EditorData["placeholder"]) => commit(() => ({ extra: { placeholder: value } }));

  /** Bulk Rename: copies the files under their new names and puts each on its scene. */
  const renameImport = async (rows: readonly RenameRow[]): Promise<boolean> => {
    setError(null);
    setNotice(null);
    const usable = rows.filter((r) => r.newName !== null && r.sceneId !== null);
    if (usable.length === 0) return false;
    try {
      const result = await runJob("media", "Copying renamed files", (id) =>
        importMedia(projectId, usable.map((r) => ({ source: r.file.path, name: r.newName ?? undefined })), id),
      );
      commit((current, data) => {
        const files = result.imported.map(fromImported);
        let state = addFiles(data, current.mediaMap, current.scenes, files);
        // The renamed copy is the one to use for its scene.
        for (const item of result.imported) {
          const row = usable.find((r) => r.file.path === item.source);
          if (row?.sceneId) state = { media: state.media, mediaMap: { ...state.mediaMap, [row.sceneId]: item.path } };
        }
        return place(state);
      });
      setNotice(`Made ${result.imported.length} renamed copies in the project. Your original files were not changed.${result.failed.length > 0 ? ` ${result.failed.length} could not be copied.` : ""}`);
      if (result.failed.length > 0) setError({ message: `${result.failed.length} files could not be copied.`, details: result.failed.map((f) => `${f.name}: ${f.reason} ${f.details}`).join("\n") });
      const latest = useProjectStore.getState().project;
      if (latest) void useThumbStore.getState().ensure(projectId, readEditor(latest).media);
      return true;
    } catch (caught) {
      fail(caught, "The files could not be renamed.");
      return false;
    }
  };

  const issues = useMemo(() => validate(project.scenes, editor, project.mediaMap, exists), [project.scenes, editor, project.mediaMap, exists]);

  return { editor, issues, exists, job, error, notice, addPaths, chooseFiles, chooseFolder, assign, pick, remove, byOrder, withGemini, replace, followFile, followProject, setPlaceholder, renameImport, recheck };
}
