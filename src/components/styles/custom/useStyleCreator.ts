import { useCallback, useEffect, useMemo, useState } from "react";

import { analyzeStyle, prepareStyleImage, saveStyleWithRefs } from "../../../lib/customStyle/api";
import { analyzeBlocker, analyzeWithRetry, checkDraft, defaultEngine, engineChoices, fileName, finishDraft, splitPictures, MAX_IMAGES } from "../../../lib/customStyle/model";
import { isCancelled, toAppError } from "../../../lib/errors";
import { MY_STYLES, newCustomId } from "../../../lib/styleModel";
import { useKeyStore } from "../../../store/keyStore";
import { runJob } from "../../../store/jobStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useStyleStore } from "../../../store/styleStore";
import type { AnalyzeEngine, AppError, PreparedImage, StyleProfile, StyleRefs } from "../../../types";

export type Step = "form" | "review";

export type CreatorStart = { mode: "create" } | { mode: "edit"; style: StyleProfile; refs: StyleRefs | null; step: Step };

export const ANALYSIS_JOB = "style-analysis";

/** All the state and actions of the "Create custom style" window. */
export function useStyleCreator(start: CreatorStart, onSaved: (style: StyleProfile) => void) {
  const editing = start.mode === "edit" ? start.style : null;
  const keys = useKeyStore((state) => state.status);
  const refreshKeys = useKeyStore((state) => state.refreshAll);
  const settings = useSettingsStore((state) => state.settings);
  const styles = useStyleStore((state) => state.styles);
  const loadStyles = useStyleStore((state) => state.load);

  const keysSet = useMemo(() => ({ gemini: keys.gemini === "set", openai: keys.openai === "set" }), [keys]);
  const [step, setStep] = useState<Step>(start.mode === "edit" ? start.step : "form");
  const [name, setName] = useState(editing?.name ?? "");
  const [category, setCategory] = useState(editing?.category ?? MY_STYLES);
  const [description, setDescription] = useState(start.mode === "edit" ? (start.refs?.description ?? "") : "");
  const savedEngine = start.mode === "edit" ? start.refs?.engine : undefined;
  const hadEngine = savedEngine === "gemini" || savedEngine === "openai" || savedEngine === "chat";
  const [chosenEngine, setChosenEngine] = useState<AnalyzeEngine | null>(hadEngine ? (savedEngine as AnalyzeEngine) : null);
  // Until the person picks one, the engine follows what is set up (keys and Settings), which is only known a moment after opening.
  const engine = chosenEngine ?? defaultEngine(keysSet, settings?.textViaChat ?? false);
  const setEngine = setChosenEngine;
  const [images, setImages] = useState<PreparedImage[]>(start.mode === "edit" ? (start.refs?.images ?? []) : []);
  const [draft, setDraft] = useState<StyleProfile | null>(start.mode === "edit" && start.step === "review" ? start.style : null);
  const [retried, setRetried] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void refreshKeys();
  }, [refreshKeys]);

  const choices = useMemo(() => engineChoices(keysSet), [keysSet]);
  const problems = useMemo(() => (draft ? checkDraft(draft) : []), [draft]);
  const blocker = analyzeBlocker(name, images.length);
  const busy = analyzing || saving || adding;

  const addPictures = useCallback(
    async (paths: string[]) => {
      setError(null);
      const split = splitPictures(paths, images.length);
      const messages: string[] = [];
      if (split.notPictures.length > 0) messages.push(`Not a PNG, JPG or WebP picture: ${split.notPictures.map(fileName).join(", ")}.`);
      if (split.tooMany.length > 0) messages.push(`Only ${MAX_IMAGES} pictures fit. Left out: ${split.tooMany.map(fileName).join(", ")}.`);
      setAdding(true);
      const added: PreparedImage[] = [];
      for (const path of split.accepted) {
        try {
          added.push(await prepareStyleImage(path));
        } catch (caught) {
          messages.push(toAppError(caught, `“${fileName(path)}” could not be used.`).message);
        }
      }
      setImages((current) => [...current, ...added].slice(0, MAX_IMAGES));
      setNotice(messages.length > 0 ? messages.join(" ") : null);
      setAdding(false);
    },
    [images.length],
  );

  const removeImage = useCallback((index: number) => {
    setImages((current) => current.filter((_, i) => i !== index));
    setNotice(null);
  }, []);

  const analyze = useCallback(async () => {
    if (blocker || busy) return;
    setError(null);
    setNotice(null);
    setAnalyzing(true);
    const id = editing ? editing.id : newCustomId(name, styles.map((s) => s.id));
    const paths = images.map((i) => i.path);
    try {
      const result = await analyzeWithRetry(
        (retryProblems, previous) =>
          runJob(ANALYSIS_JOB, "Studying the pictures", (jobId) => analyzeStyle(jobId, { images: paths, name: name.trim(), description, engine, problems: retryProblems, previous })),
        (answer) => finishDraft(answer, { id, name, category }),
      );
      setDraft(result.style);
      setRetried(result.retried);
      setStep("review");
    } catch (caught) {
      if (isCancelled(caught)) setNotice("Cancelled.");
      else setError(toAppError(caught, "The pictures could not be analyzed."));
    } finally {
      setAnalyzing(false);
    }
  }, [blocker, busy, editing, name, styles, images, description, engine, category]);

  const save = useCallback(async () => {
    if (!draft || busy) return;
    setError(null);
    setSaving(true);
    try {
      const saved = await saveStyleWithRefs({ ...draft, name: name.trim(), category: category.trim() || MY_STYLES }, images.map((i) => i.path), description, engine);
      await loadStyles();
      onSaved(saved);
    } catch (caught) {
      setError(toAppError(caught, "The style could not be saved."));
      setSaving(false);
    }
  }, [draft, busy, name, category, images, description, engine, loadStyles, onSaved]);

  const change = useCallback((patch: Partial<StyleProfile>) => setDraft((current) => (current ? { ...current, ...patch } : current)), []);

  return {
    step, setStep, name, setName, category, setCategory, description, setDescription, engine, setEngine, choices,
    images, addPictures, removeImage, draft, change, problems, retried, notice, error, analyzing, saving, adding, busy,
    blocker, analyze, save, editing: editing !== null,
  };
}
