import { CircleCheck, FlaskConical, TriangleAlert } from "lucide-react";
import { useState } from "react";

import sampleStory from "../../../../resources/style-test/sample_story.txt?raw";
import { generateText } from "../../../lib/ai";
import { endsWithLock, SAMPLE_PROMPTS } from "../../../lib/customStyle/model";
import { isCancelled, toAppError } from "../../../lib/errors";
import { generatePrompts } from "../../../lib/prompts/generate";
import { sampleScenes } from "../../../lib/prompts/styleTest";
import { runJob, selectJob, useJobStore } from "../../../store/jobStore";
import type { AppError, Scene, StyleProfile } from "../../../types";
import { ErrorNotice } from "../../ErrorNotice";
import { Button } from "../../ui";
import { JobBar } from "../../voice/JobBar";

const TEST_JOB = "custom-style-test";

/** "Test style": writes 3 prompts for the fixed sample story with the style as it is now, and shows them. */
export function SamplePrompts({ style, disabled }: { style: StyleProfile; disabled: boolean }) {
  const job = useJobStore(selectJob([TEST_JOB]));
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setError(null);
    setNotice(null);
    setRunning(true);
    const base = sampleScenes(sampleStory).slice(0, SAMPLE_PROMPTS);
    setScenes([]);
    try {
      const result = await runJob(TEST_JOB, `Writing ${SAMPLE_PROMPTS} test prompts`, (jobId) =>
        generatePrompts({
          scenes: base,
          targetIds: new Set(base.map((s) => s.id)),
          context: { style, characters: [], locations: [], settings: { outputType: "image", detail: "medium", tool: "generic" }, aspect: "16:9" },
          call: async (system, prompt) => (await generateText(prompt, system, true, jobId)).text,
          onScenes: setScenes,
        }),
      );
      setScenes(result.scenes);
      if (result.failed) setError(toAppError(result.failed.error, "The test prompts could not be written."));
    } catch (caught) {
      if (isCancelled(caught)) setNotice("Cancelled.");
      else setError(toAppError(caught, "The test prompts could not be written."));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Test style</h3>
          <p className="text-xs text-muted">Writes {SAMPLE_PROMPTS} prompts for a short sample story, so you can see this style at work. It uses your text engine from Settings.</p>
        </div>
        <Button icon={FlaskConical} onClick={() => void run()} loading={running} disabled={disabled || running}>
          Test style
        </Button>
      </div>
      {error && <ErrorNotice error={error} />}
      {job && running && <JobBar job={job} />}
      {notice && (
        <p className="text-sm text-muted" role="status">
          {notice}
        </p>
      )}
      {scenes.length > 0 && (
        <ol className="flex flex-col gap-2" aria-label="Test prompts">
          {scenes.map((scene) => (
            <li key={scene.id} className="rounded-lg border border-line bg-surface p-3 text-sm">
              <p className="mb-1 text-xs text-muted">
                {scene.id}: {scene.text}
              </p>
              <p>{scene.prompt || "…"}</p>
              {scene.prompt !== "" &&
                (endsWithLock(scene.prompt, style) ? (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-success">
                    <CircleCheck size={12} aria-hidden /> Ends with the style lock
                  </p>
                ) : (
                  <p className="mt-1.5 flex items-center gap-1 text-xs text-warning">
                    <TriangleAlert size={12} aria-hidden /> Does not end with the style lock
                  </p>
                ))}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
