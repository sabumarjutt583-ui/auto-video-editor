import type { Context } from "../scenes/edit.ts";
import { splitSentences } from "../sentences.ts";
import type { Project } from "../../types/project.ts";

/** What the scene-editing functions need to know about a project. */
export function contextOf(project: Pick<Project, "words" | "voiceDuration" | "sceneSettings">): Context {
  return { words: project.words, sentences: splitSentences(project.words), voiceDuration: project.voiceDuration, maxVideoSeconds: project.sceneSettings.maxVideoSeconds };
}
