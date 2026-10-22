import { ImagePlus, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { pickFile } from "../../lib/dialog";

import { toAppError } from "../../lib/errors";
import { CATEGORIES, REQUIRED_FIELDS } from "../../lib/styleModel";
import type { AppError, StyleProfile } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Field, Modal, Select, TextInput } from "../ui";

interface StyleFormProps {
  title: string;
  initial: StyleProfile;
  /** `picture` is the file chosen with Upload thumbnail, or null. */
  onSave: (style: StyleProfile, picture: string | null) => Promise<void>;
  onClose: () => void;
}

export const AREA_CLASSES =
  "w-full resize-y rounded-lg border border-line bg-surface-2 p-3 text-sm text-fg placeholder:text-muted/70 transition-colors hover:border-accent/40 focus:border-accent";

/** Create or edit a custom style. Every field of the profile can be filled in. */
export function StyleForm({ title, initial, onSave, onClose }: StyleFormProps) {
  const [style, setStyle] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  const [picture, setPicture] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (style.name.trim() === "") {
      setProblem("Please give the style a name.");
      return;
    }
    setProblem(null);
    setBusy(true);
    setError(null);
    try {
      await onSave(style, picture);
    } catch (caught) {
      setError(toAppError(caught, "The style could not be saved."));
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={busy ? () => undefined : onClose} wide>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="style-name">
            <TextInput id="style-name" value={style.name} autoFocus maxLength={80} onChange={(e) => setStyle({ ...style, name: e.target.value })} aria-invalid={problem !== null} />
            {problem && (
              <p className="text-xs text-danger" role="alert">
                {problem}
              </p>
            )}
          </Field>
          <Field label="Category" htmlFor="style-category">
            <Select id="style-category" value={style.category} onChange={(e) => setStyle({ ...style, category: e.target.value })}>
              {[...CATEGORIES, ...(CATEGORIES.some((c) => c === style.category) ? [] : [style.category])].map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {REQUIRED_FIELDS.map(({ key, label, hint }) => (
          <Field key={key} label={label} htmlFor={`style-${key}`} hint={hint}>
            <textarea id={`style-${key}`} value={style[key]} rows={key === "style_lock" ? 2 : 3} onChange={(e) => setStyle({ ...style, [key]: e.target.value })} className={AREA_CLASSES} />
          </Field>
        ))}
        <Field label="Thumbnail (optional)" htmlFor="style-thumbnail" hint="A PNG, JPG or WebP picture. It is cropped to 4:3 and shrunk. Without one, the gallery shows a colour card.">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              id="style-thumbnail"
              icon={ImagePlus}
              disabled={busy}
              onClick={() => void pickFile("Choose a thumbnail picture", "Pictures", ["png", "jpg", "jpeg", "webp"]).then((file) => file && setPicture(file))}
            >
              Upload thumbnail
            </Button>
            {picture ? (
              <>
                <span className="max-w-72 truncate text-sm text-muted" title={picture}>
                  {picture.split(/[\\/]/).pop()}
                </span>
                <Button icon={X} onClick={() => setPicture(null)} disabled={busy}>
                  Remove
                </Button>
              </>
            ) : (
              <span className="text-sm text-muted">{style.thumbnail ? "This style already has a picture." : "No picture chosen."}</span>
            )}
          </div>
        </Field>
        {error && <ErrorNotice error={error} />}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Save style
          </Button>
        </div>
      </form>
    </Modal>
  );
}
