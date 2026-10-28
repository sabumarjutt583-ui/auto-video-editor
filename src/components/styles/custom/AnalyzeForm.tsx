import { Sparkles } from "lucide-react";
import { useId } from "react";

import { pickPictureFiles } from "../../../lib/dialog";
import { CATEGORIES, MY_STYLES } from "../../../lib/styleModel";
import { useFileDrop } from "../../../lib/useFileDrop";
import { selectJob, useJobStore } from "../../../store/jobStore";
import { ErrorNotice } from "../../ErrorNotice";
import { Button, Field, Select, TextInput } from "../../ui";
import { JobBar } from "../../voice/JobBar";
import { AREA_CLASSES } from "../StyleForm";
import { ANALYSIS_JOB, type useStyleCreator } from "./useStyleCreator";
import { ReferencePictures } from "./ReferencePictures";

type Creator = ReturnType<typeof useStyleCreator>;

interface AnalyzeFormProps {
  creator: Creator;
  onManual?: () => void;
  onCancel: () => void;
}

/** Step 1: the name, the 3 to 20 reference pictures, a few words about the look, and what should study them. */
export function AnalyzeForm({ creator, onManual, onCancel }: AnalyzeFormProps) {
  const ids = { name: useId(), category: useId(), description: useId(), engine: useId() };
  const job = useJobStore(selectJob([ANALYSIS_JOB]));
  const { over } = useFileDrop((paths) => void creator.addPictures(paths), !creator.busy);
  const categories = [MY_STYLES, ...CATEGORIES, ...(creator.category !== MY_STYLES && !(CATEGORIES as readonly string[]).includes(creator.category) ? [creator.category] : [])];
  const unavailable = creator.choices.find((c) => c.value === creator.engine)?.unavailable ?? null;

  async function choose() {
    const paths = await pickPictureFiles("Choose reference pictures");
    if (paths.length > 0) await creator.addPictures(paths);
  }

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void creator.analyze();
      }}
    >
      <p className="text-sm text-muted">Give 3 or more pictures (up to 20) that share one look. The AI studies the look they have in common (not what is in them) and writes the style for you.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Style name" htmlFor={ids.name}>
          <TextInput id={ids.name} value={creator.name} autoFocus maxLength={80} disabled={creator.busy} onChange={(e) => creator.setName(e.target.value)} placeholder="For example: Soft morning film" />
        </Field>
        <Field label="Category" htmlFor={ids.category}>
          <Select id={ids.category} value={creator.category} disabled={creator.busy} onChange={(e) => creator.setCategory(e.target.value)}>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Reference pictures (3 to 4)">
        <ReferencePictures images={creator.images} dragging={over} disabled={creator.busy} onChoose={() => void choose()} onRemove={creator.removeImage} />
      </Field>

      <Field label="Description (Recommended)" htmlFor={ids.description} hint="A few words about the look, the mood, or what to keep. For example: warm, grainy, calm, always a little blurry at the edges.">
        <textarea id={ids.description} value={creator.description} rows={2} maxLength={500} disabled={creator.busy} onChange={(e) => creator.setDescription(e.target.value)} className={AREA_CLASSES} />
      </Field>

      <Field label="Analyze with" htmlFor={ids.engine} hint="Gemini uses your own key (Settings). The Gemini web chat uses your Google accounts (Settings, Google accounts) and the ChatGPT web chat uses your ChatGPT accounts (Settings, ChatGPT accounts); neither web chat needs a key.">
        <Select id={ids.engine} value={creator.engine} disabled={creator.busy} onChange={(e) => creator.setEngine(e.target.value as typeof creator.engine)}>
          {creator.choices.map((choice) => (
            <option key={choice.value} value={choice.value} disabled={choice.unavailable !== null}>
              {choice.label}
              {choice.unavailable ? ` (${choice.unavailable})` : ""}
            </option>
          ))}
        </Select>
        {unavailable && <p className="text-xs text-warning">{unavailable}</p>}
      </Field>

      {creator.notice && (
        <p className="text-sm text-warning" role="status">
          {creator.notice}
        </p>
      )}
      {creator.error && <ErrorNotice error={creator.error} />}
      {job && creator.analyzing && <JobBar job={job} />}
      {creator.blocker && creator.name.trim() !== "" && creator.images.length > 0 && !creator.analyzing && (
        <p className="text-xs text-muted" role="status">
          {creator.blocker}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {onManual ? (
          <button type="button" onClick={onManual} disabled={creator.busy} className="cursor-pointer text-sm text-accent-fg hover:underline disabled:opacity-60">
            Write the fields by hand instead
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button onClick={onCancel} disabled={creator.analyzing}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon={Sparkles} loading={creator.analyzing} disabled={creator.blocker !== null || unavailable !== null || creator.busy}>
            Analyze with AI
          </Button>
        </div>
      </div>
    </form>
  );
}
