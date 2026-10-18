import { Layers } from "lucide-react";
import { useEffect, useState } from "react";

import { useFileDrop } from "../../lib/useFileDrop";
import { emptyScenes, unmatched } from "../../lib/media/place";
import { matchedCount } from "../../lib/media/validate";
import { useThumbStore } from "../../store/thumbStore";
import type { Project } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Card } from "../ui";
import { JobBar } from "../voice/JobBar";
import { BulkRenameModal } from "./BulkRenameModal";
import { ImportCard } from "./ImportCard";
import { PlaceholderCard } from "./PlaceholderCard";
import { SceneFiles } from "./SceneFiles";
import { UnmatchedTray } from "./UnmatchedTray";
import { useMediaActions } from "./useMediaActions";
import { ValidationCard } from "./ValidationCard";

/** Step 1 of the Auto Editor: bring in the pictures and clips and place them on the scenes. */
export function MediaStep({ project }: { project: Project }) {
  const actions = useMediaActions(project);
  const { editor, issues, exists, job, error, notice } = actions;
  const [renaming, setRenaming] = useState(false);
  const busy = job !== null;
  const { over } = useFileDrop((paths) => void actions.addPaths(paths), !renaming);

  // Thumbnails for everything in the project (already made ones are reused).
  useEffect(() => {
    void useThumbStore.getState().ensure(project.id, editor.media);
  }, [project.id, editor.media]);

  const free = unmatched(editor.media);
  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorNotice error={error} />}
      {notice && (
        <p className="text-sm text-muted" role="status">
          {notice}
        </p>
      )}
      <ImportCard
        over={over && !renaming}
        busy={busy}
        matched={matchedCount(project.scenes, editor, exists)}
        sceneCount={project.scenes.length}
        fileCount={editor.media.length}
        onFiles={() => void actions.chooseFiles()}
        onFolder={() => void actions.chooseFolder()}
        onRename={() => setRenaming(true)}
      />
      {job && <JobBar job={job} />}
      {free.length > 0 && (
        <UnmatchedTray
          files={free}
          scenes={project.scenes}
          emptyCount={emptyScenes(editor.media, project.scenes, exists).length}
          busy={busy}
          onAssign={actions.assign}
          onByOrder={actions.byOrder}
          onGemini={() => void actions.withGemini()}
        />
      )}
      <ValidationCard
        issues={issues}
        media={editor.media}
        mediaMap={project.mediaMap}
        onPick={actions.pick}
        onFileTime={actions.followFile}
        onProjectTime={actions.followProject}
        onRecheck={() => void actions.recheck()}
        onRemove={(path) => void actions.remove(path)}
      />
      <Card title="Scenes and their files" description="Each scene with the picture or clip that was placed on it." icon={Layers}>
        <SceneFiles scenes={project.scenes} media={editor.media} mediaMap={project.mediaMap} exists={exists} onRemove={(path) => void actions.remove(path)} />
      </Card>
      <PlaceholderCard value={editor.placeholder} onChange={actions.setPlaceholder} />
      {renaming && <BulkRenameModal scenes={project.scenes} onClose={() => setRenaming(false)} onConfirm={actions.renameImport} />}
    </div>
  );
}
