import { create } from "zustand";

import { readEditor } from "../lib/editor/model";
import { isCancelled, toAppError } from "../lib/errors";
import { stageDone } from "../lib/pipeline/plan";
import { profileEditor, profileProblems, profileToPatch, type ChannelProfile } from "../lib/pipeline/profile";
import { runPipeline } from "../lib/pipeline/runner";
import { STAGE_IDS, type StageId } from "../lib/pipeline/stages";
import { initialView, reduceView, restart, withDetail, type RunView } from "../lib/pipeline/view";
import { runStage } from "../lib/pipeline/impl";
import { createProject } from "../lib/projects";
import type { AppError } from "../types";
import { requestCancel, useJobStore } from "./jobStore";
import { useProjectStore } from "./projectStore";

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

interface PipelineState {
  view: RunView;
  /** The video that is being made (or was made last), and the channel it belongs to. */
  projectId: string | null;
  channelId: string | null;
  /** The step that waits for "Continue" (a pause set in the profile), or null. */
  waiting: StageId | null;
  error: AppError | null;
  problems: string[];
  finished: Finished | null;
  running: boolean;
  start: (input: MakeVideoInput) => Promise<void>;
  /** Runs again on the same project: finished steps are skipped. */
  resume: () => Promise<void>;
  /** Continues any video of a channel (also one from an earlier session): its script and finished steps are read from the project. */
  continueProject: (projectId: string, profile: ChannelProfile, ensureConsent: () => Promise<boolean>) => Promise<void>;
  cancel: () => void;
  answer: (go: boolean) => void;
  reset: () => void;
}

// The run lives in this store (not in a page), so it goes on while the person looks at another page.
let cancelFlag = false;
let answerFn: ((go: boolean) => void) | null = null;
let last: { input: MakeVideoInput; projectId: string } | null = null;
let currentStage: StageId | null = null;

export const usePipelineStore = create<PipelineState>((set, get) => {
  async function execute(input: MakeVideoInput, id: string): Promise<void> {
    cancelFlag = false;
    set((s) => ({ running: true, error: null, finished: null, view: restart(s.view) }));
    const ctx = {
      projectId: id,
      profile: input.profile,
      voiceFile: input.voiceFile,
      say: (text: string) => {
        const stage = currentStage;
        if (stage) set((s) => ({ view: withDetail(s.view, stage, text) }));
      },
      cancelled: () => cancelFlag,
      finished: (result: Finished) => set({ finished: result }),
    };
    try {
      await runPipeline({
        stages: STAGE_IDS,
        isDone: (stage) => {
          const project = useProjectStore.getState().project;
          return project !== null && project.id === id && stageDone(project, stage);
        },
        run: async (stage) => {
          currentStage = stage;
          if (stage === "images" && !(await input.ensureConsent())) throw new Error("The notice for the free picture engine was not accepted.");
          await runStage(stage, ctx);
        },
        pauses: input.profile.pauses,
        confirm: (stage) =>
          new Promise<boolean>((resolve) => {
            set({ waiting: stage });
            answerFn = (go) => {
              set({ waiting: null });
              answerFn = null;
              resolve(go);
            };
          }),
        cancelRequested: () => cancelFlag,
        isCancel: isCancelled,
        onEvent: (event) => {
          if (event.type === "error") set({ error: toAppError(event.error, "A step of the video failed.") });
          set((s) => ({ view: reduceView(s.view, event) }));
        },
      });
    } finally {
      currentStage = null;
      set({ running: false });
      await useProjectStore.getState().flush();
    }
  }

  return {
    view: initialView(),
    projectId: null,
    channelId: null,
    waiting: null,
    error: null,
    problems: [],
    finished: null,
    running: false,

    start: async (input) => {
      if (get().running) return;
      const found = profileProblems(input.profile, { script: input.script, voiceFile: input.voiceFile });
      set({ problems: found });
      if (found.length > 0) return;
      set({ view: initialView(), error: null, finished: null });
      try {
        const created = await createProject(input.name.trim() || input.profile.name);
        await useProjectStore.getState().open(created.id);
        const project = useProjectStore.getState().project;
        if (!project) throw new Error("The new project could not be opened.");
        const editor = readEditor(project);
        useProjectStore.getState().update({
          ...profileToPatch(input.profile),
          channelId: input.profile.id,
          script: input.script,
          editor: { ...editor, ...profileEditor(input.profile, editor) },
        });
        set({ projectId: created.id, channelId: input.profile.id });
        last = { input, projectId: created.id };
        await execute(input, created.id);
      } catch (caught) {
        set({ error: toAppError(caught, "The project could not be made.") });
      }
    },

    resume: async () => {
      if (!last || get().running) return;
      const run = last;
      const open = useProjectStore.getState().project;
      if (!open || open.id !== run.projectId) await useProjectStore.getState().open(run.projectId);
      await execute(run.input, run.projectId);
    },

    continueProject: async (projectId, profile, ensureConsent) => {
      if (get().running) return;
      try {
        await useProjectStore.getState().open(projectId);
        const project = useProjectStore.getState().project;
        if (!project) throw new Error("The project could not be opened.");
        const input: MakeVideoInput = { profile, name: project.name, script: project.script, voiceFile: null, ensureConsent };
        last = { input, projectId };
        set({ projectId, channelId: profile.id, view: initialView(), error: null, finished: null, problems: [] });
        await execute(input, projectId);
      } catch (caught) {
        set({ error: toAppError(caught, "The video could not be continued.") });
      }
    },

    cancel: () => {
      cancelFlag = true;
      for (const job of Object.values(useJobStore.getState().jobs)) requestCancel(job.id);
      answerFn?.(false);
    },

    answer: (go) => answerFn?.(go),

    reset: () => {
      if (get().running) return;
      last = null;
      set({ view: initialView(), projectId: null, channelId: null, error: null, finished: null, problems: [], waiting: null });
    },
  };
});
