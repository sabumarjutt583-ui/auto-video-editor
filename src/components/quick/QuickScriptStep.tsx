import { Wand2 } from "lucide-react";
import { useMemo, useState } from "react";

import { isCancelled, toAppError } from "../../lib/errors";
import { groupSentencesWithAi } from "../../lib/scenes/aiGroups";
import { byGroups, bySentences, FALLBACK_PER_SCENE, isQuickId, keepFinishedWork, plainTexts, scenesFromTexts, splitTextSentences, type TextMode } from "../../lib/quick/textScenes";
import { runJob, selectJob, useJobStore } from "../../store/jobStore";
import { useProjectStore } from "../../store/projectStore";
import type { AppError, Project } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { Button, Card, Field, Select } from "../ui";
import { JobBar } from "../voice/JobBar";

const MODE_KEY = "quick.textMode";

function readStored(): { mode: TextMode; perScene: number } {
  try {
    const raw = JSON.parse(window.localStorage.getItem(MODE_KEY) ?? "null") as { mode?: unknown; perScene?: unknown } | null;
    const mode = raw?.mode === "line" || raw?.mode === "ai" ? raw.mode : "sentence";
    const perScene = typeof raw?.perScene === "number" && raw.perScene >= 1 && raw.perScene <= 4 ? Math.round(raw.perScene) : 1;
    return { mode, perScene };
  } catch {
    return { mode: "sentence", perScene: 1 };
  }
}

function store(mode: TextMode, perScene: number): void {
  try {
    window.localStorage.setItem(MODE_KEY, JSON.stringify({ mode, perScene }));
  } catch {
    // The choice is only a convenience.
  }
}

/** Quick mode, "Text only": paste a script and cut it into prompts without any timing. */
export function QuickScriptStep({ project }: { project: Project }) {
  const update = useProjectStore((state) => state.update);
  const job = useJobStore(selectJob(["ai"]));
  const [text, setText] = useState(project.script);
  const [{ mode, perScene }, setChoice] = useState(readStored);
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);

  const sentences = useMemo(() => splitTextSentences(text), [text]);
  const count = mode === "line" ? plainTexts(text, "line", 1).length : mode === "sentence" ? bySentences(sentences, perScene).length : null;
  const timed = project.words.length > 0 && !project.scenes.every((scene) => isQuickId(scene.id));
  const hasPrompts = project.scenes.some((scene) => scene.prompt.trim() !== "");

  function choose(nextMode: TextMode, nextPer: number) {
    setChoice({ mode: nextMode, perScene: nextPer });
    store(nextMode, nextPer);
  }

  function edit(value: string) {
    setText(value);
    update({ script: value });
  }

  async function build() {
    setError(null);
    setNotice(null);
    setBuilding(true);
    try {
      let texts: string[];
      if (mode === "ai") {
        const groups = await groupSentencesWithAi(sentences, (start) => runJob("ai", "Asking Gemini to group the sentences", start));
        if (groups) texts = byGroups(sentences, groups);
        else {
          texts = bySentences(sentences, FALLBACK_PER_SCENE);
          setNotice(`Gemini's grouping could not be used, so every ${FALLBACK_PER_SCENE} sentences became one prompt instead.`);
        }
      } else {
        texts = plainTexts(text, mode, perScene);
      }
      const current = useProjectStore.getState().project ?? project;
      const next = keepFinishedWork(scenesFromTexts(texts), current.scenes.filter((scene) => isQuickId(scene.id)));
      update({ script: text, scenes: next, mediaMap: {} });
    } catch (caught) {
      if (isCancelled(caught)) setNotice("Cancelled.");
      else setError(toAppError(caught, "The prompts could not be cut."));
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorNotice error={error} />}
      {notice && <p className="text-sm text-muted" role="status">{notice}</p>}
      <Card title="Your script" description="Paste a script, a story or a list of lines in any language. Nothing is uploaded until you generate prompts.">
        <div className="flex flex-col gap-4">
          <textarea
            dir="auto"
            aria-label="Script"
            rows={10}
            value={text}
            placeholder="Paste your script here…"
            onChange={(event) => edit(event.target.value)}
            className="w-full resize-y rounded-lg border border-line bg-surface-2 p-3 text-sm focus:border-accent"
          />
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Make one prompt for" htmlFor="quick-mode">
              <Select id="quick-mode" value={mode} onChange={(e) => choose(e.target.value as TextMode, perScene)}>
                <option value="sentence">Every sentence (or a few sentences)</option>
                <option value="line">Every line</option>
                <option value="ai">Every scene (the AI groups sentences by meaning)</option>
              </Select>
            </Field>
            {mode === "sentence" && (
              <Field label="Sentences per prompt" htmlFor="quick-per">
                <Select id="quick-per" value={perScene} onChange={(e) => choose(mode, Number(e.target.value))}>
                  {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
              </Field>
            )}
            <Button variant="primary" icon={Wand2} loading={building} disabled={text.trim() === "" || job !== null} onClick={() => void build()}>
              {project.scenes.some((scene) => isQuickId(scene.id)) ? "Build the prompts again" : "Build the prompts"}
            </Button>
            <span className="pb-2 text-sm text-muted">
              {count === null ? `${sentences.length} sentences found` : `${count} ${count === 1 ? "prompt" : "prompts"} will be made`}
            </span>
          </div>
          {timed && <p className="text-xs text-muted">This session has voice timing. Building from the text replaces the timed scenes with P01, P02 ... (no timecodes).</p>}
          {hasPrompts && <p className="text-xs text-muted">Prompts you already wrote are kept for lines that did not change.</p>}
        </div>
      </Card>
      {job && (
        <div className="flex flex-col gap-2">
          <JobBar job={job} />
        </div>
      )}
      {project.scenes.length > 0 && (
        <Card title={`${project.scenes.length} ${project.scenes.length === 1 ? "prompt" : "prompts"}`} description="Next: choose a style, then write the prompts.">
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto text-sm" aria-label="Built prompts">
            {project.scenes.map((scene) => (
              <li key={scene.id} className="flex gap-3">
                <span className="w-12 shrink-0 font-mono text-xs text-muted">{scene.id}</span>
                <span dir="auto" className="min-w-0 flex-1 truncate" title={scene.text}>{scene.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
