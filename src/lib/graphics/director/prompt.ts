import type { Density } from "../brand/model.ts";
import { DENSITY_RATIO } from "./density.ts";
import { MAIN_TYPES, SPEC_GUIDE } from "./guide.ts";
import type { SceneInput, Trigger } from "./types.ts";

export interface DirectorScene extends SceneInput {
  index: number;
  /** The English description of the scene's picture (may be empty). */
  description: string;
  triggers: readonly Trigger[];
}

export interface DirectorSettings {
  density: Density;
  /** The narration language, e.g. "Urdu". On-screen text is written in it. */
  language: string;
  styleName: string;
  /** One line about the brand kit (colours, corners, entrances). */
  kitSummary: string;
}

const cut = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
const round = (n: number, digits = 2): number => Math.round(n * 10 ** digits) / 10 ** digits;

/** What the AI is told once per project (the rules of the director). */
export function buildSystem(settings: DirectorSettings): string {
  const range = DENSITY_RATIO[settings.density];
  return `You are the motion graphics director of a faceless YouTube channel. For each scene you decide whether ONE graphic helps the viewer and, when it does, you write it as GraphicSpec JSON. An app draws it: you decide WHAT is shown, not how it is drawn.

RULES
1. At most one main graphic per scene. Many scenes need none: answer null for them. The channel density is "${settings.density}": graphics on about ${Math.round(range.min * 100)} to ${Math.round(range.max * 100)} percent of all scenes. Keep clean scenes clean.
2. Each scene comes with candidate triggers (numbers, money, percentages, dates, places, people, lists, quotes, comparisons) found in the narration, each with the second it is spoken ("at"). Start the graphic on the trigger it is about: answer "trigger": the index "i" of that trigger. The graphic ends before its scene ends (the app also cuts it to fit).
3. Show what the narrator says; never invent facts. Use the numbers, names and places of the narration. If nothing deserves a graphic, answer null.
4. On-screen text is written in the narration language (${settings.language}) unless it is a number, a symbol or a proper name that stays as it is. Keep text short (a few words per line).
5. No brand names, no artist or studio names, no logos. Flags and maps only to inform, never to mock a person, a country or a group, and no political symbols.
6. Use colour NAMES (primary, accent, secondary, text ...) and leave "enter" and "exit" out unless the story needs a special one: the brand kit decides the look.
7. Vary the graphic types. Do not use the same type for more than two scenes in a row (the "earlier" list shows what was used before).
8. Allowed main types: ${MAIN_TYPES.join(", ")}. Helpers (shape plates, icons, particles) are allowed inside a graphic. Icons only from the "icons" list.
9. Visual style of the video: ${settings.styleName}. ${settings.kitSummary}

${SPEC_GUIDE}

ANSWER FORMAT: only JSON, no explanation, no code fence:
{"scenes":[{"id":"S01","graphic":null},{"id":"S02","trigger":0,"graphic":{ "schemaVersion":1, ... }}]}
One entry per scene of the request. "graphic": null means no graphic.`;
}

export interface BatchPromptInput {
  scenes: readonly DirectorScene[];
  /** Icon names ("lucide:users") the AI may use, best matches first. */
  icons: readonly string[];
  /** Graphics chosen so far, to vary the types. */
  earlier: ReadonlyArray<{ id: string; type: string }>;
  /** Scene id -> what was wrong with the last answer (a retry). */
  problems?: Readonly<Record<string, string>>;
}

/** The request for one batch of scenes (at most 20 are sent at a time). */
export function buildBatchPrompt(input: BatchPromptInput): string {
  const scenes = input.scenes.map((scene) => ({
    id: scene.id,
    seconds: round(scene.end - scene.start, 1),
    text: cut(scene.text.trim(), 400),
    ...(scene.description.trim() !== "" ? { picture: cut(scene.description.trim(), 160) } : {}),
    triggers: scene.triggers.slice(0, 8).map((t, i) => ({
      i,
      kind: t.kind,
      text: cut(t.text, 80),
      at: round(Math.max(0, t.time - scene.start)),
      ...(t.value !== undefined ? { value: t.value } : {}),
      ...(t.currency ? { currency: t.currency } : {}),
      ...(t.code ? { country: t.code } : {}),
      ...(t.city ? { city: t.city, lat: round(t.lat ?? 0), lon: round(t.lon ?? 0) } : {}),
    })),
  }));
  const body: Record<string, unknown> = { scenes, icons: input.icons.slice(0, 30), earlier: input.earlier.slice(-12) };
  if (input.problems && Object.keys(input.problems).length > 0) {
    body.problems = input.problems;
    body.note = "The graphics of these scenes could not be used. Fix them (the problems are listed) and answer again for these scenes only.";
  }
  return JSON.stringify(body);
}
