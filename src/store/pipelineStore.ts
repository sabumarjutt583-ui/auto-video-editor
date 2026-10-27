import { create } from "zustand";

import { isCancelled, toAppError } from "../lib/errors";
import { stageDone } from "../lib/pipeline/plan";
import { profileProblems, type ChannelProfile } from "../lib/pipeline/profile";
import { runPipeline } from "../lib/pipeline/runner";
import { STAGE_IDS, type StageId } from "../lib/pipeline/stages";
import { initialView, reduceView, restart, withDetail, type RunView } from "../lib/pipeline/view";
import { runStage } from "../lib/pipeline/impl";
import { writeScript, writeScriptForStep0 } from "../lib/script/write";
import { recordFromProject, scriptRecordFor, type ScriptRecord } from "../lib/script/step0.ts";
import { applyChannelProfile } from "../lib/pipeline/impl/applyProfile";
import { createProject } from "../lib/projects";
import type { AppError } from "../types";
import { requestCancel, useJobStore } from "./jobStore";
import { useProjectStore } from "./projectStore";

export interface MakeVideoInput {
  profile: ChannelProfile;
  name: string;
  script: string;
  /** What the video is about. When the script is empty and the channel has a script writer, the script is written from this. */
  topic?: string;
  /** Step 0 word count asked for from Claude, or undefined when none was asked. */
  wordCount?: number;
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
  /** The script writer is writing the script now. */
  writing: boolean;
  /** Step 0 audit record of the script of the video being made, or null when unknown. */
  scriptRecord: ScriptRecord | null;
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
    writing: false,
    scriptRecord: null,
    finished: null,
    running: false,

    start: async (input) => {
      if (get().running) return;
      const found = profileProblems(input.profile, { script: input.script, voiceFile: input.voiceFile, topic: input.topic });
      set({ problems: found });
      if (found.length > 0) return;
      set({ view: initialView(), error: null, finished: null, projectId: null, channelId: null, scriptRecord: null });
      try {
        // Step 0: the script is settled before any project is made, so a failed
        // writer leaves no empty project behind. A typed script is used as-is
        // and never calls Claude; an empty script with a topic calls Claude.
        let record: ScriptRecord | null = null;
        if (input.script.trim() !== "") {
          record = scriptRecordFor({ profile: input.profile, title: input.name.trim() || input.profile.name, topic: input.topic ?? "", wordCount: input.wordCount ?? null, script: input.script, source: "typed" });
        } else if (input.voiceFile === null) {
          set({ writing: true });
          try {
            if (input.wordCount !== undefined) {
              const written = await writeScriptForStep0(input.profile, { title: input.name, topic: input.topic ?? "", wordCount: input.wordCount });
              input = { ...input, script: written.script };
              record = written.record;
            } else {
              input = { ...input, script: await writeScript(input.profile, input.topic ?? "") };
              record = scriptRecordFor({ profile: input.profile, title: input.name.trim() || input.profile.name, topic: input.topic ?? "", wordCount: null, script: input.script, source: "claude" });
            }
          } catch (caught) {
            set({ error: toAppError(caught, "The script could not be written.") });
            return;
          } finally {
            set({ writing: false });
          }
        }
        set({ scriptRecord: record });
        const created = await createProject(input.name.trim() || input.profile.name);
        await useProjectStore.getState().open(created.id);
        const project = useProjectStore.getState().project;
        if (!project) throw new Error("The new project could not be opened.");
        applyChannelProfile(input.profile, input.script, record ?? undefined);
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
        set({ projectId, channelId: profile.id, view: initialView(), error: null, finished: null, problems: [], scriptRecord: recordFromProject(project) });
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
      set({ view: initialView(), projectId: null, channelId: null, error: null, finished: null, problems: [], waiting: null, scriptRecord: null });
    },
  };
});
