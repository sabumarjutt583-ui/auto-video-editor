import { voiceProviderMismatch, captureProviders, type ProviderSnapshot } from "../lib/pipeline/providers";
import { ttsOptions } from "../lib/tts/api";
import { useSettingsStore } from "./settingsStore";
import { create } from "zustand";
import { acquireProject } from "../lib/pipeline/activity.ts";

import { isCancelled, toAppError } from "../lib/errors";
import { pictureScenes, stageDone } from "../lib/pipeline/plan";
import { profileProblems, type ChannelProfile } from "../lib/pipeline/profile";
import { runPipeline } from "../lib/pipeline/runner";
import { STAGE_IDS, type StageId } from "../lib/pipeline/stages";
import { initialView, reduceView, withDetail, type RunView } from "../lib/pipeline/view";
import { runStage } from "../lib/pipeline/impl";
import { writeScriptForStep0 } from "../lib/script/write";
import { recordFromProject, scriptRecordFor, type ScriptRecord } from "../lib/script/step0.ts";
import { applyChannelProfile } from "../lib/pipeline/impl/applyProfile";
import { createProject } from "../lib/projects";
import type { AppError } from "../types";
import { requestCancel, useJobStore } from "./jobStore";
import { useProjectStore } from "./projectStore";

export interface MakeVideoInput {
  profile: ChannelProfile;
  providers?: ProviderSnapshot;
  name: string;
  script: string;
  scriptRecord?: ScriptRecord;
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
  /** The running video is paused between steps (persisted on the project, so it survives a restart). */
  paused: boolean;
  pause: () => void;
  resumeRun: () => void;
  start: (input: MakeVideoInput) => Promise<void>;
  /** Runs again on the same project: finished steps are skipped. */
  resume: () => Promise<void>;
  /** Continues any video of a channel (also one from an earlier session): its script and finished steps are read from the project. */
  continueProject: (projectId: string, profile: ChannelProfile, ensureConsent: () => Promise<boolean>, voiceFile?: string | null) => Promise<void>;
  cancel: () => void;
  answer: (go: boolean) => void;
  reset: () => void;
}

// The run lives in this store (not in a page), so it goes on while the person looks at another page.
let cancelFlag = false;
let pauseFlag = false;
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Writes the run state into the open project and saves it now, so a crash cannot lose it. */
async function persistRun(projectId: string, status: string, currentStage: string | null, failedScenes: string[]): Promise<void> {
  const project = useProjectStore.getState().project;
  if (!project || project.id !== projectId) throw new Error("The running project is no longer open.");
  const completedStages = STAGE_IDS.filter((stage) => stageDone(project, stage));
  useProjectStore.getState().update({
    makeVideoRun: { ...project.makeVideoRun, status, currentStage: currentStage ?? "", completedStages, failedScenes, updatedAt: new Date().toISOString() },
  });
  await useProjectStore.getState().flush();
  const saved = useProjectStore.getState();
  if (saved.saveState === "error") throw saved.saveError ?? new Error("The video progress could not be saved.");
}

function failedSceneIds(projectId: string): string[] {
  const project = useProjectStore.getState().project;
  if (!project || project.id !== projectId) return [];
  return pictureScenes(project).filter((scene) => !project.mediaMap[scene.id]).map((scene) => scene.id);
}
let answerFn: ((go: boolean) => void) | null = null;
let last: { input: MakeVideoInput; projectId: string } | null = null;
let currentStage: StageId | null = null;

async function providerChoices(profile: ChannelProfile): Promise<ProviderSnapshot> {
  if (!useSettingsStore.getState().settings) await useSettingsStore.getState().load();
  const settings = useSettingsStore.getState().settings;
  if (!settings) throw new Error("Your provider settings could not be loaded.");
  return captureProviders(settings, profile, await ttsOptions());
}

export const usePipelineStore = create<PipelineState>((set, get) => {
  async function execute(input: MakeVideoInput, id: string): Promise<void> {
    input = { ...input, profile: structuredClone(input.profile) };
    const savedProject = useProjectStore.getState().project;
    if (!Object.prototype.hasOwnProperty.call(input.profile.pauses, "script")) {
      input.profile.pauses = { ...input.profile.pauses, script: input.profile.pauses.scenes, scenes: false };
    }
    const providers = savedProject?.makeVideoRun?.providerSnapshot ?? input.providers ?? await providerChoices(input.profile);
    if (savedProject?.id === id) {
      useProjectStore.getState().update({ makeVideoRun: { status: "running", currentStage: "", completedStages: [], failedScenes: [], updatedAt: new Date().toISOString(), ...savedProject.makeVideoRun, profileSnapshot: input.profile, providerSnapshot: providers } });
    }
    pauseFlag = false;
    set({ running: true, paused: false, error: null, finished: null, view: initialView() });
    const ctx = {
      projectId: id,
      profile: input.profile,
      providers,
      voiceFile: input.voiceFile,
      say: (text: string) => {
        const stage = currentStage;
        if (stage) set((s) => ({ view: withDetail(s.view, stage, text) }));
      },
      cancelled: () => cancelFlag,
      finished: (result: Finished) => set({ finished: result }),
    };
    try {
      await persistRun(id, "running", null, []);
      const outcome = await runPipeline({
        stages: STAGE_IDS,
        isDone: (stage) => {
          const project = useProjectStore.getState().project;
          return project !== null && project.id === id && (stage === "script" && !project.script.trim() && (input.voiceFile !== null || Boolean(project.voiceOriginalPath)) || stageDone(project, stage));
        },
        run: async (stage) => {
          currentStage = stage;
          const project = useProjectStore.getState().project;
          if (project?.makeVideoRun) {
            const index = STAGE_IDS.indexOf(stage);
            useProjectStore.getState().update({ makeVideoRun: { ...project.makeVideoRun,
              approvedStages: (project.makeVideoRun.approvedStages ?? []).filter((item) => STAGE_IDS.indexOf(item as StageId) < index) } });
          }
          await persistRun(id, pauseFlag ? "paused" : "running", stage, failedSceneIds(id));
          // Pause takes effect between steps: wait here until resumed or cancelled.
          while (pauseFlag && !cancelFlag) {
            await sleep(500);
          }
          if (cancelFlag) return;
          if (stage === "images" && !(await input.ensureConsent())) throw new Error("The notice for the free picture engine was not accepted.");
          if (cancelFlag) return;
          await runStage(stage, ctx);
          await persistRun(id, "running", stage, failedSceneIds(id));
        },
        pauses: { ...input.profile.pauses, script: input.profile.pauses.script && Boolean(useProjectStore.getState().project?.script.trim()) },
        isApproved: (stage) => useProjectStore.getState().project?.makeVideoRun?.approvedStages?.includes(stage) ?? false,
        onApproved: async (stage) => {
          const project = useProjectStore.getState().project;
          if (!project?.makeVideoRun || project.id !== id) throw new Error("The running project is no longer open.");
          useProjectStore.getState().update({ makeVideoRun: { ...project.makeVideoRun,
            approvedStages: [...new Set([...(project.makeVideoRun.approvedStages ?? []), stage])] } });
          await persistRun(id, "running", stage, failedSceneIds(id));
        },
        confirm: async (stage) => {
          currentStage = stage;
          await persistRun(id, "waiting", stage, failedSceneIds(id));
          return new Promise<boolean>((resolve) => {
            set({ waiting: stage });
            answerFn = (go) => {
              set({ waiting: null });
              answerFn = null;
              resolve(go);
            };
          });
        },
        cancelRequested: () => cancelFlag,
        isCancel: isCancelled,
        onEvent: (event) => {
          if (event.type === "error") set({ error: toAppError(event.error, "A step of the video failed.") });
          set((s) => ({ view: reduceView(s.view, event) }));
        },
      });
      await persistRun(id, outcome === "cancelled" ? "stopped" : outcome, outcome === "finished" ? null : currentStage, failedSceneIds(id));
    } catch (caught) {
      await persistRun(id, "failed", currentStage, failedSceneIds(id));
      throw caught;
    } finally {
      currentStage = null;
      pauseFlag = false;
      await useProjectStore.getState().flush();
      set({ paused: false });
    }
  }

  return {
    view: initialView(),
    projectId: null,
    channelId: null,
    waiting: null,
    error: null,
    problems: [],
    paused: false,
    writing: false,
    scriptRecord: null,
    finished: null,
    running: false,

    start: async (input) => {
      if (get().running) return;
      cancelFlag = false;
      last = null;
      let release: (() => void) | undefined;
      set({ view: initialView(), error: null, finished: null, projectId: null, channelId: null });
      const found = profileProblems(input.profile, { script: input.script, voiceFile: input.voiceFile, topic: input.topic });
      set({ problems: found });
      if (found.length > 0) return;
      set({ running: true, view: initialView(), error: null, finished: null, projectId: null, channelId: null, scriptRecord: null });
      try {
        input = { ...input, profile: structuredClone(input.profile), providers: await providerChoices(input.profile) };
        // Step 0: the script is settled before any project is made, so a failed
        // writer leaves no empty project behind. A typed script is used as-is
        // and never calls Claude; an empty script with a topic calls Claude.
        let record: ScriptRecord | null = null;
        if (input.script.trim() !== "") {
          record = input.scriptRecord?.channelId === input.profile.id ? input.scriptRecord : scriptRecordFor({ profile: input.profile, title: input.name.trim() || input.profile.name, topic: input.topic ?? "", wordCount: input.wordCount ?? null, script: input.script, source: "typed" });
        } else if (input.voiceFile === null) {
          set({ writing: true });
          try {
            const written = await writeScriptForStep0(input.profile, { title: input.name, topic: input.topic ?? "", wordCount: input.wordCount ?? null });
            input = { ...input, script: written.script };
            record = written.record;
          } catch (caught) {
            set({ error: toAppError(caught, "The script could not be written.") });
            return;
          } finally {
            set({ writing: false });
          }
        }
        if (cancelFlag) return;
        set({ scriptRecord: record });
        const created = await createProject(input.name.trim() || input.profile.name);
        if (cancelFlag) return;
        release = acquireProject(created.id);
        await useProjectStore.getState().open(created.id);
        if (cancelFlag) return;
        const project = useProjectStore.getState().project;
        if (!project) throw new Error("The new project could not be opened.");
        applyChannelProfile(input.profile, input.script, record ?? undefined);
        useProjectStore.getState().update({ makeVideoRun: { status: "running", currentStage: "", completedStages: [],
          failedScenes: [], approvedStages: [], updatedAt: new Date().toISOString(),
          profileSnapshot: input.profile, providerSnapshot: input.providers } });
        // Publish the queue's resume target only after its script/settings are
        // durable; otherwise a restart could reopen an empty created project.
        await persistRun(created.id, "running", null, []);
        set({ projectId: created.id, channelId: input.profile.id });
        last = { input, projectId: created.id };
        if (cancelFlag) return;
        await execute(input, created.id);
      } catch (caught) {
        set({ error: toAppError(caught, "The project could not be made.") });
      } finally {
        release?.();
        set({ running: false, writing: false, paused: false });
      }
    },

    resume: async () => {
      if (!last || get().running) return;
      cancelFlag = false;
      set({ running: true });
      const run = last;
      let release: (() => void) | undefined;
      try {
        release = acquireProject(run.projectId);
        const open = useProjectStore.getState().project;
        if (!open || open.id !== run.projectId) await useProjectStore.getState().open(run.projectId);
        if (!cancelFlag) await execute(run.input, run.projectId);
      } catch (caught) {
        set({ error: toAppError(caught, "The video could not be continued.") });
      } finally {
        release?.();
        set({ running: false, paused: false });
      }
    },

    continueProject: async (projectId, profile, ensureConsent, voiceFile = null) => {
      if (get().running) return;
      cancelFlag = false;
      set({ running: true, error: null, finished: null, problems: [], projectId });
      let release: (() => void) | undefined;
      try {
        release = acquireProject(projectId);
        await useProjectStore.getState().open(projectId);
        if (cancelFlag) return;
        const project = useProjectStore.getState().project;
        if (!project) throw new Error("The project could not be opened.");
        let runProfile = project.makeVideoRun?.profileSnapshot ?? profile;
        const savedProviders = project.makeVideoRun?.providerSnapshot;
        // Repair only an invalid cross-provider snapshot, after an explicit channel choice.
        if (savedProviders && voiceProviderMismatch(savedProviders.voice) && !project.voiceOriginalPath && voiceFile === null) {
          if (!profile.voice.provider) throw new Error("This video's saved voice belongs to a different provider. In Channels > Settings, choose Microsoft or Gemini, select its voice, save, then continue this video.");
          runProfile = { ...runProfile, voice: structuredClone(profile.voice) };
          const corrected = await providerChoices(runProfile);
          useProjectStore.getState().update({ makeVideoRun: { ...project.makeVideoRun!, profileSnapshot: runProfile, providerSnapshot: { ...savedProviders, voice: corrected.voice } } });
        }
        const input: MakeVideoInput = { profile: runProfile, name: project.name, script: project.script, voiceFile, ensureConsent };
        last = { input, projectId };
        set({ projectId, channelId: profile.id, view: initialView(), error: null, finished: null, problems: [], scriptRecord: recordFromProject(project) });
        await execute(input, projectId);
      } catch (caught) {
        set({ error: toAppError(caught, "The video could not be continued.") });
      } finally {
        release?.();
        set({ running: false, paused: false });
      }
    },

    cancel: () => {
      cancelFlag = true;
      pauseFlag = false;
      for (const job of Object.values(useJobStore.getState().jobs)) requestCancel(job.id);
      answerFn?.(false);
    },

    pause: () => {
      if (!get().running) return;
      pauseFlag = true;
      set({ paused: true });
      const id = get().projectId;
      if (id) void persistRun(id, "paused", currentStage, failedSceneIds(id)).catch((error) => set({ error: toAppError(error) }));
    },
    resumeRun: () => {
      pauseFlag = false;
      set({ paused: false });
      const id = get().projectId;
      if (id) void persistRun(id, "running", currentStage, failedSceneIds(id)).catch((error) => set({ error: toAppError(error) }));
    },
    answer: (go) => answerFn?.(go),

    reset: () => {
      if (get().running) return;
      last = null;
      set({ view: initialView(), projectId: null, channelId: null, error: null, finished: null, problems: [], waiting: null, scriptRecord: null });
    },
  };
});
