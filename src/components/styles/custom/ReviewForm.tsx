import { ArrowLeft, RefreshCw, Save, TriangleAlert } from "lucide-react";
import { useId } from "react";

import { CATEGORIES, isComplete, MY_STYLES, REQUIRED_FIELDS } from "../../../lib/styleModel";
import { selectJob, useJobStore } from "../../../store/jobStore";
import { ErrorNotice } from "../../ErrorNotice";
import { Button, Field, Select, TextInput } from "../../ui";
import { JobBar } from "../../voice/JobBar";
import { AREA_CLASSES } from "../StyleForm";
import { ReferencePictures } from "./ReferencePictures";
import { SamplePrompts } from "./SamplePrompts";
import { ANALYSIS_JOB, type useStyleCreator } from "./useStyleCreator";

type Creator = ReturnType<typeof useStyleCreator>;

/** Step 2: every field of the written style can be changed. Regenerate asks the AI again; Test style shows it at work. */
export function ReviewForm({ creator, onCancel }: { creator: Creator; onCancel: () => void }) {
  const ids = { name: useId(), category: useId() };
  const job = useJobStore(selectJob([ANALYSIS_JOB]));
  const { draft } = creator;
  if (!draft) return null;
  const categories = [MY_STYLES, ...CATEGORIES, ...(creator.category !== MY_STYLES && !(CATEGORIES as readonly string[]).includes(creator.category) ? [creator.category] : [])];
  const canSave = isComplete(draft) && creator.name.trim() !== "" && !creator.busy;

  return (
    <div className="flex flex-col gap-4">
      {creator.problems.length === 0 ? (
        <p className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm" role="status">
          {creator.retried ? "The AI fixed its first answer. The style follows all the writing rules." : "The style follows all the writing rules."} Read it, change anything you like, then save.
        </p>
      ) : (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" role="alert">
          <p className="flex items-center gap-1.5 font-medium">
            <TriangleAlert size={14} aria-hidden /> {creator.retried ? "Still not following every rule after a second try:" : "Some writing rules are not met yet:"}
          </p>
          <ul className="mt-1.5 list-disc pl-5 text-xs">
            {creator.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-muted">You can fix the fields below by hand, press Regenerate, or save the style as it is. It still works.</p>
        </div>
      )}

      <ReferencePictures images={creator.images} dragging={false} disabled onChoose={() => undefined} onRemove={() => undefined} readOnly />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={ids.name}>
          <TextInput id={ids.name} value={creator.name} maxLength={80} onChange={(e) => creator.setName(e.target.value)} />
        </Field>
        <Field label="Category" htmlFor={ids.category}>
          <Select id={ids.category} value={creator.category} onChange={(e) => creator.setCategory(e.target.value)}>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {REQUIRED_FIELDS.map(({ key, label, hint }) => (
        <Field key={key} label={label} htmlFor={`custom-${key}`} hint={hint}>
          <textarea id={`custom-${key}`} value={draft[key]} rows={key === "style_lock" || key === "medium" ? 2 : 3} onChange={(e) => creator.change({ [key]: e.target.value })} className={AREA_CLASSES} />
        </Field>
      ))}

      <SamplePrompts style={draft} disabled={!isComplete(draft) || creator.busy} />

      {creator.notice && (
        <p className="text-sm text-muted" role="status">
          {creator.notice}
        </p>
      )}
      {creator.error && <ErrorNotice error={creator.error} />}
      {job && creator.analyzing && <JobBar job={job} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button icon={ArrowLeft} onClick={() => creator.setStep("form")} disabled={creator.busy}>
            Back to the pictures
          </Button>
          <Button icon={RefreshCw} onClick={() => void creator.analyze()} loading={creator.analyzing} disabled={creator.busy || creator.blocker !== null}>
            Regenerate
          </Button>
        </div>
        <div className="flex gap-2">
          <Button onClick={onCancel} disabled={creator.busy}>
            Cancel
          </Button>
          <Button variant="primary" icon={Save} onClick={() => void creator.save()} loading={creator.saving} disabled={!canSave}>
            Save style
          </Button>
        </div>
      </div>
    </div>
  );
}
