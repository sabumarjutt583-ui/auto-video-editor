import { useCallback, useRef, useState } from "react";

import { isCancelled, toAppError } from "../../lib/errors";
import { createProject } from "../../lib/projects";
import { stageDone } from "../../lib/pipeline/plan";
import { profileEditor, profileProblems, profileToPatch, type ChannelProfile } from "../../lib/pipeline/profile";
import { runPipeline } from "../../lib/pipeline/runner";
import { STAGE_IDS, type StageId } from "../../lib/pipeline/stages";
import { runStage } from "../../lib/pipeline/impl";
import { initialView, reduceView, restart, withDetail, type RunView } from "../../lib/pipeline/view";
import { readEditor } from "../../lib/editor/model";
import { requestCancel, useJobStore } from "../../store/jobStore";
import { useProjectStore } from "../../store/projectStore";
import type { AppError } from "../../types";

export interface MakeVideoInput {
  profile: ChannelProfile;
  name: string;
  script: string;
  /** The person's own voice file, or null to make the voice from the script. */
  voiceFile: string | null;
  /** Called before the pictures step; resolves false when the person refuses the notice. */
  ensureConsent: () => Promise<boolean>;
}

export interface Finished {
  path: string;
  copyPath: string | null;
  seconds: number;
  sizeBytes: number;
}

export interface MakeVideo {
  view: RunView;
  projectId: string | null;
  /** The step that waits for "Continue" (a pause set in the profile), or null. */
  waiting: StageId | null;
  error: AppError | null;
  problems: string[];
  finished: Finished | null;
  running: boolean;
  start: (input: MakeVideoInput) => Promise<void>;
  /** Runs again on the same project: finished steps are skipped. */
  resume: () => Promise<void>;
  cancel: () => void;
  answer: (go: boolean) => void;
  reset: () => void;
}

/** Runs "Make video": a new project from the profile, then every step in order. */
export function useMakeVideo(): MakeVideo {
  const [view, setView] = useState<RunView>(initialView());
  const [projectId, setProjectId] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<StageId | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [running, setRunning] = useState(false);
  const cancelFlag = useRef(false);
  const answerRef = useRef<((go: boolean) => void) | null>(null);
  const last = useRef<{ input: MakeVideoInput; projectId: string } | null>(null);
  const current = useRef<StageId | null>(null);

  const execute = useCallback(async (input: MakeVideoInput, id: string) => {
    cancelFlag.current = false;
    setRunning(true);
    setError(null);
    setFinished(null);
    setView((v) => restart(v));
    const ctx = {
      projectId: id,
      profile: input.profile,
      voiceFile: input.voiceFile,
      say: (text: string) => {
        const stage = current.current;
        if (stage) setView((v) => withDetail(v, stage, text));
      },
      cancelled: () => cancelFlag.current,
      finished: (result: Finished) => setFinished(result),
    };
    try {
      const outcome = await runPipeline({
        stages: STAGE_IDS,
        isDone: (stage) => {
          const project = useProjectStore.getState().project;
          return project !== null && project.id === id && stageDone(project, stage);
        },
        run: async (stage) => {
          current.current = stage;
          if (stage === "images" && !(await input.ensureConsent())) throw new Error("The notice for the free picture engine was not accepted.");
          await runStage(stage, ctx);
        },
        pauses: input.profile.pauses,
        confirm: (stage) =>
          new Promise<boolean>((resolve) => {
            setWaiting(stage);
            answerRef.current = (go) => {
              setWaiting(null);
              answerRef.current = null;
              resolve(go);
            };
          }),
        cancelRequested: () => cancelFlag.current,
        isCancel: isCancelled,
        onEvent: (event) => {
          if (event.type === "error") setError(toAppError(event.error, "A step of the video failed."));
          setView((v) => reduceView(v, event));
        },
      });
      void outcome;
    } finally {
      current.current = null;
      setRunning(false);
      await useProjectStore.getState().flush();
    }
  }, []);

  const start = useCallback(
    async (input: MakeVideoInput) => {
      const found = profileProblems(input.profile, { script: input.script, voiceFile: input.voiceFile });
      setProblems(found);
      if (found.length > 0) return;
      setView(initialView());
      setError(null);
      try {
        const created = await createProject(input.name.trim() || input.profile.name);
        await useProjectStore.getState().open(created.id);
        const project = useProjectStore.getState().project;
        if (!project) throw new Error("The new project could not be opened.");
        const editor = readEditor(project);
        useProjectStore.getState().update({
          ...profileToPatch(input.profile),
          script: input.script,
          editor: { ...editor, ...profileEditor(input.profile, editor) },
        });
        setProjectId(created.id);
        last.current = { input, projectId: created.id };
        await execute(input, created.id);
      } catch (caught) {
        setError(toAppError(caught, "The project could not be made."));
      }
    },
    [execute],
  );

  const resume = useCallback(async () => {
    const run = last.current;
    if (!run) return;
    const open = useProjectStore.getState().project;
    if (!open || open.id !== run.projectId) await useProjectStore.getState().open(run.projectId);
    await execute(run.input, run.projectId);
  }, [execute]);

  const cancel = useCallback(() => {
    cancelFlag.current = true;
    for (const job of Object.values(useJobStore.getState().jobs)) requestCancel(job.id);
    answerRef.current?.(false);
  }, []);

  const answer = useCallback((go: boolean) => answerRef.current?.(go), []);

  const reset = useCallback(() => {
    setView(initialView());
    setProjectId(null);
    setError(null);
    setFinished(null);
    setProblems([]);
    last.current = null;
  }, []);

  return { view, projectId, waiting, error, problems, finished, running, start, resume, cancel, answer, reset };
}
