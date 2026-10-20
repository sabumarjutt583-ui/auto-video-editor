import { FlaskConical, Download, Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import sampleStory from "../../resources/style-test/sample_story.txt?raw";
import { ErrorNotice } from "../components/ErrorNotice";
import { Button, Card, Select } from "../components/ui";
import { JobBar } from "../components/voice/JobBar";
import { generateText } from "../lib/ai";
import { copyText } from "../lib/clipboard";
import { pickSavePath } from "../lib/dialog";
import { isCancelled, toAppError } from "../lib/errors";
import { writeTextFile } from "../lib/files";
import { generatePrompts } from "../lib/prompts/generate";
import { sampleScenes, styleTestText } from "../lib/prompts/styleTest";
import { isComplete } from "../lib/styleModel";
import { runJob, selectJob, useJobStore } from "../store/jobStore";
import { useStyleStore } from "../store/styleStore";
import type { AppError, Scene } from "../types";

/** Runs the real prompt pipeline (Gemini) on a fixed 5-sentence story, so a new style can be judged. */
export function StyleTestCard() {
  const styles = useStyleStore((state) => state.styles);
  const loaded = useStyleStore((state) => state.loaded);
  const job = useJobStore(selectJob(["style-test"]));
  const [styleId, setStyleId] = useState("");
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!loaded) void useStyleStore.getState().load();
  }, [loaded]);

  const usable = useMemo(() => styles.filter(isComplete), [styles]);
  const chosen = usable.find((s) => s.id === styleId) ?? usable[0] ?? null;
  const written = scenes.filter((s) => s.prompt.trim() !== "").length;

  async function run() {
    if (!chosen) return;
    setError(null);
    setNotice(null);
    setRunning(true);
    const base = sampleScenes(sampleStory);
    setScenes([]);
    try {
      const result = await runJob("style-test", "Writing the 5 test prompts with Gemini", (jobId) =>
        generatePrompts({
          scenes: base,
          targetIds: new Set(base.map((s) => s.id)),
          context: {
            style: chosen,
            characters: [],
            locations: [],
            settings: { outputType: "image", detail: "medium", tool: "generic" },
            aspect: "16:9",
          },
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

  async function copyAll() {
    const ok = await copyText(styleTestText(scenes));
    setNotice(ok ? "Copied." : "The text could not be copied. Use Export TXT instead.");
  }

  async function exportTxt() {
    try {
      const path = await pickSavePath("Export TXT", `style_test_${chosen?.id ?? "style"}.txt`, "TXT", ["txt"]);
      if (!path) return;
      await writeTextFile(path, styleTestText(scenes));
      setNotice(`Saved ${path}`);
    } catch (caught) {
      setError(toAppError(caught, "The file could not be saved."));
    }
  }

  return (
    <Card title="Style Test" description="Writes prompts for a fixed 5-sentence story with the real pipeline (needs your Gemini key). Only complete styles can be tested." icon={FlaskConical}>
      {error && <ErrorNotice error={error} />}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-72">
          <Select aria-label="Style to test" value={chosen?.id ?? ""} onChange={(e) => setStyleId(e.target.value)} disabled={running}>
            {usable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <Button variant="primary" disabled={!chosen || running} onClick={() => void run()}>
          Run test
        </Button>
        <Button icon={Copy} disabled={written === 0 || running} onClick={() => void copyAll()}>
          Copy
        </Button>
        <Button icon={Download} disabled={written === 0 || running} onClick={() => void exportTxt()}>
          Export TXT
        </Button>
      </div>
      {job && <JobBar job={job} />}
      {notice && (
        <p className="text-sm text-muted" role="status">
          {notice}
        </p>
      )}
      {scenes.length > 0 && (
        <ol className="flex flex-col gap-2" aria-label="Test prompts">
          {scenes.map((s) => (
            <li key={s.id} className="rounded-lg border border-line bg-surface-2 p-3 text-sm">
              <p className="mb-1 text-xs text-muted">
                {s.id}: {s.text}
              </p>
              <p>{s.prompt || "…"}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
