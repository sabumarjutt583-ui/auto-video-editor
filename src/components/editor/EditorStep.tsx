import { useCallback, useEffect, useMemo, useState } from "react";

import { contextOf } from "../../lib/editor/context";
import { DEFAULT_OVERRIDE, overrideOf, readEditor } from "../../lib/editor/model";
import { fileOf } from "../../lib/editor/status";
import { sceneIndexAt, swapMedia } from "../../lib/editor/timeline";
import { useProjectDir } from "../../lib/editor/useProjectDir";
import { applyEdit } from "../../store/historyStore";
import { useProjectStore } from "../../store/projectStore";
import { usePlaybackStore } from "../../store/playbackStore";
import { useThumbStore } from "../../store/thumbStore";
import type { MediaFile, Project, Scene, SceneOverride } from "../../types";
import { AudioPanel, useAudio, useSfxLibrary } from "../audio";
import { CaptionsPanel, useCaptions } from "../captions";
import { ErrorNotice } from "../ErrorNotice";
import { RenderModal, useRender } from "../render";
import { useMediaActions } from "../media/useMediaActions";
import { SegmentedControl } from "../ui";
import { EditorTopBar } from "./EditorTopBar";
import { OverridesPanel } from "./OverridesPanel";
import { PreviewPlayer } from "./PreviewPlayer";
import { Storyboard } from "./Storyboard";
import { Timeline } from "./timeline/Timeline";
import { PlaybackContext, usePlayback } from "./usePlayback";
import { useEditorKeys } from "./useEditorKeys";
import { useSceneFocusStore } from "../../store/sceneFocusStore";

type Tab = "storyboard" | "scene" | "captions" | "audio";

/** Auto Editor step 2: storyboard, preview and timeline. */
export function EditorStep({ project }: { project: Project }) {
  const controls = usePlayback(project);
  const dir = useProjectDir(project.id);
  const actions = useMediaActions(project);
  const { editor, exists } = actions;
  const [tab, setTab] = useState<Tab>("storyboard");
  const [selectedId, setSelectedId] = useState<string | null>(project.scenes[0]?.id ?? null);
  const context = useMemo(() => contextOf(project), [project]);
  const captions = useCaptions(project, editor);
  const library = useSfxLibrary();
  const audio = useAudio(project, editor, captions.lines, library);
  const [renderOpen, setRenderOpen] = useState(false);
  useEffect(() => {
    useSceneFocusStore.getState().set(project.id, selectedId);
  }, [project.id, selectedId]);
  const render = useRender({ project, editor, exists, captionLines: captions.lines, captionStyle: captions.style, font: captions.font, cues: audio.cues });

  const files = useMemo(() => {
    const map: Record<string, MediaFile | undefined> = {};
    for (const scene of project.scenes) map[scene.id] = fileOf(scene, editor.media, project.mediaMap);
    return map;
  }, [project.scenes, project.mediaMap, editor.media]);

  // Thumbnails for the storyboard and the timeline.
  const paths = editor.media.map((m) => m.path).join("|");
  useEffect(() => {
    void useThumbStore.getState().ensure(project.id, editor.media);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, paths]);

  // The scene under the playhead is the selected one while the video plays.
  useEffect(
    () =>
      usePlaybackStore.subscribe((state, previous) => {
        if (!state.playing && previous.playing === state.playing) return;
        const scene = project.scenes[sceneIndexAt(project.scenes, state.time)];
        if (scene) setSelectedId((id) => (id === scene.id ? id : scene.id));
      }),
    [project.scenes],
  );

  const select = useCallback(
    (sceneId: string) => {
      setSelectedId(sceneId);
      const scene = project.scenes.find((s) => s.id === sceneId);
      if (scene) controls.seek(scene.start);
    },
    [project.scenes, controls],
  );
  const selectIndex = useCallback((index: number) => {
    const scene = project.scenes[index];
    if (scene) setSelectedId(scene.id);
  }, [project.scenes]);
  useEditorKeys(project.scenes, controls, project.voiceDuration, selectIndex);

  const setOverride = (sceneId: string, patch: Partial<SceneOverride> | null) => {
    const data = readEditor(useProjectStore.getState().project ?? project);
    const overrides = { ...data.overrides };
    if (patch === null) delete overrides[sceneId];
    else overrides[sceneId] = { ...overrideOf(data, sceneId), ...patch };
    applyEdit({ editor: { ...data, overrides } });
  };

  const changeBoundary = (scenes: Scene[]) => applyEdit({ scenes });
  const swap = (from: number, to: number) => {
    const a = project.scenes[from];
    const b = project.scenes[to];
    if (!a || !b) return;
    const next = swapMedia(editor.media, project.mediaMap, a.id, b.id);
    applyEdit({ editor: { ...editor, media: next.media }, mediaMap: next.mediaMap });
  };

  const selectedIndex = Math.max(0, project.scenes.findIndex((s) => s.id === selectedId));
  const selected = project.scenes[selectedIndex];
  const selectedFile = selected ? files[selected.id] : undefined;

  return (
    <PlaybackContext.Provider value={controls}>
      <div className="flex min-h-0 flex-col gap-4" data-testid="editor-step">
        <EditorTopBar project={project} onRender={() => setRenderOpen(true)} rendering={render.job !== null} />
        {renderOpen && <RenderModal project={project} editor={editor} view={render} onClose={() => setRenderOpen(false)} />}
        {actions.error && <ErrorNotice error={actions.error} />}
        {actions.notice && <p className="text-sm text-muted" role="status">{actions.notice}</p>}
        <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(320px,2fr)_minmax(0,3fr)]">
          <div className="flex min-h-0 flex-col gap-3">
            <SegmentedControl<Tab> label="Editor panels" value={tab} onChange={setTab} options={[{ value: "storyboard", label: "Storyboard" }, { value: "scene", label: "Scene settings" }, { value: "captions", label: "Captions" }, { value: "audio", label: "Audio" }]} />
            <div className="max-h-[calc(100vh-14rem)] overflow-y-auto pr-1">
              {tab === "storyboard" && (
                <Storyboard
                  project={project}
                  editor={editor}
                  exists={exists}
                  selectedId={selected?.id ?? null}
                  onSelect={select}
                  onReplace={(id) => { setSelectedId(id); void actions.replace(id); }}
                  onMotion={(id) => { setSelectedId(id); setTab("scene"); }}
                  onRemoveMedia={(id) => { const file = files[id]; if (file) actions.assign(file.path, null); }}
                />
              )}
              {tab === "captions" && <CaptionsPanel project={project} view={captions} />}
              {tab === "audio" && <AudioPanel project={project} view={audio} library={library} />}
              {tab === "scene" && selected && (
                <OverridesPanel
                  sceneId={selected.id}
                  value={editor.overrides[selected.id] ?? DEFAULT_OVERRIDE}
                  isVideo={selectedFile?.kind === "video"}
                  isFirst={selectedIndex === 0}
                  onChange={(patch) => setOverride(selected.id, patch)}
                  onReset={() => setOverride(selected.id, null)}
                />
              )}
            </div>
          </div>
          <div className="flex min-h-0 min-w-0 flex-col gap-4">
            <PreviewPlayer project={project} editor={editor} dir={dir} overlay={captions.overlay} />
            <Timeline scenes={project.scenes} context={context} files={files} captionLines={captions.style.preset === "none" ? [] : captions.lines} audio={editor.audio} cues={audio.cues} selectedCue={audio.selectedCue} onSelectCue={(id) => { audio.selectCue(id); setTab("audio"); }} onMoveCue={(id, time) => audio.editCue(id, { time })} onDeleteCue={audio.deleteCue} selectedId={selected?.id ?? null} onSelect={setSelectedId} onBoundary={changeBoundary} onSwap={swap} />
          </div>
        </div>
      </div>
    </PlaybackContext.Provider>
  );
}
