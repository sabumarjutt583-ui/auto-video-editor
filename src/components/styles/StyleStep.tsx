import { Palette, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { toAppError } from "../../lib/errors";
import { addRecent, toggleId } from "../../lib/styleGallery";
import { blankStyle, duplicateStyle, isComplete, newCustomId } from "../../lib/styleModel";
import { setCustomStyleThumbnail } from "../../lib/styles";
import { useProjectStore } from "../../store/projectStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useStyleStore } from "../../store/styleStore";
import type { AppError, Project, StyleProfile } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Card } from "../ui";
import { StyleDetails } from "./StyleDetails";
import { StyleForm } from "./StyleForm";
import { StyleCurrentCard } from "./StyleCurrentCard";
import { StyleGallery } from "./StyleGallery";

type FormState = { mode: "create" | "edit" | "duplicate"; style: StyleProfile } | null;

/** Step 4 (first half): choose the look of every picture. */
export function StyleSection({ project }: { project: Project }) {
  const update = useProjectStore((state) => state.update);
  const { styles, warnings, loaded, error, load, save, remove } = useStyleStore();
  const [viewing, setViewing] = useState<string | null>(project.styleId);
  const [form, setForm] = useState<FormState>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [pictureError, setPictureError] = useState<AppError | null>(null);
  const settings = useSettingsStore((state) => state.settings);
  const updateSettings = useSettingsStore((state) => state.update);
  const favorites = settings?.styleFavorites ?? [];
  const recent = settings?.recentStyles ?? [];

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const current = useMemo(() => styles.find((style) => style.id === viewing) ?? null, [styles, viewing]);
  const ids = useMemo(() => styles.map((style) => style.id), [styles]);
  const usedStyle = styles.find((style) => style.id === project.styleId) ?? null;

  function choose(id: string) {
    setViewing(id);
    setConfirmDelete(false);
    const style = styles.find((item) => item.id === id);
    // Only a finished style can be used. An unfinished one can still be looked at.
    if (style && isComplete(style)) {
      update({ styleId: id });
      updateSettings({ recentStyles: addRecent(recent, id) });
    }
  }

  function chooseFromGallery(id: string) {
    choose(id);
    setGalleryOpen(false);
  }

  async function saveForm(style: StyleProfile, picture: string | null) {
    const toSave = form?.mode === "edit" ? style : { ...style, id: newCustomId(style.name, ids) };
    let saved = await save(toSave);
    if (picture) {
      // The style itself is saved; a picture that cannot be converted is reported but does not undo the save.
      try {
        saved = await setCustomStyleThumbnail(saved.id, picture);
        await load();
      } catch (caught) {
        setPictureError(toAppError(caught, "The style was saved, but its picture could not be used."));
      }
    }
    setForm(null);
    setConfirmDelete(false);
    // choose() only knows the list from before saving, so the saved style is handled here.
    if (isComplete(saved)) {
      update({ styleId: saved.id });
      updateSettings({ recentStyles: addRecent(recent, saved.id) });
    }
    setViewing(saved.id);
  }

  async function deleteCurrent() {
    if (!current || current.builtin) return;
    await remove(current.id);
    if (project.styleId === current.id) update({ styleId: null });
    setViewing(null);
    setConfirmDelete(false);
  }

  return (
    <Card title="Style" description="Pick the look of every picture. The same style words are added to the end of every prompt." icon={Palette}>
      {error && <ErrorNotice error={error} />}
      {warnings.length > 0 && (
        <p className="text-xs text-warning" role="status">
          {warnings.length} style {warnings.length === 1 ? "file was" : "files were"} skipped: {warnings[0]}
        </p>
      )}

      {pictureError && <ErrorNotice error={pictureError} />}

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-72 flex-1">
          <StyleCurrentCard style={usedStyle} onChange={() => setGalleryOpen(true)} />
        </div>
        <Button icon={Plus} onClick={() => setForm({ mode: "create", style: blankStyle() })}>
          Create custom style
        </Button>
      </div>

      {galleryOpen && (
        <StyleGallery
          styles={styles}
          selectedId={project.styleId}
          favorites={favorites}
          recent={recent}
          onSelect={chooseFromGallery}
          onToggleFavorite={(id) => updateSettings({ styleFavorites: toggleId(favorites, id) })}
          onCreate={() => {
            setGalleryOpen(false);
            setForm({ mode: "create", style: blankStyle() });
          }}
          onClose={() => setGalleryOpen(false)}
        />
      )}

      {project.styleId !== null && !usedStyle && loaded && (
        <p className="text-sm text-warning" role="alert">
          The style chosen for this project could not be found. Please choose another one.
        </p>
      )}
      {usedStyle && (
        <p className="text-sm text-muted" role="status">
          This project uses <span className="font-medium text-fg">{usedStyle.name}</span>.
        </p>
      )}

      {current && (
        <StyleDetails
          style={current}
          inUse={project.styleId === current.id}
          onDuplicate={() => setForm({ mode: "duplicate", style: duplicateStyle(current, ids) })}
          onEdit={() => setForm({ mode: "edit", style: current })}
          onDelete={() => setConfirmDelete(true)}
        />
      )}

      {confirmDelete && current && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/40 bg-danger/10 p-4" role="alertdialog" aria-label="Delete style">
          <p className="text-sm">Delete “{current.name}”? This cannot be undone.</p>
          <div className="flex gap-2">
            <Button onClick={() => setConfirmDelete(false)}>Keep it</Button>
            <Button variant="danger" onClick={() => void deleteCurrent()}>
              Delete style
            </Button>
          </div>
        </div>
      )}

      {form && (
        <StyleForm
          title={form.mode === "edit" ? "Edit custom style" : form.mode === "duplicate" ? "Duplicate style" : "Create custom style"}
          initial={form.style}
          onSave={saveForm}
          onClose={() => setForm(null)}
        />
      )}
    </Card>
  );
}
