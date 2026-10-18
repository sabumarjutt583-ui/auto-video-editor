/** Seconds as "005.1": one decimal, at least three digits before the dot. */
export function formatSeconds(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return safe.toFixed(1).padStart(5, "0");
}

/** Scene number 5 -> "S05"; with a part (1 -> "a") -> "S05a". */
export function sceneId(number: number, part?: number): string {
  const base = `S${String(number).padStart(2, "0")}`;
  return part === undefined ? base : base + String.fromCharCode(97 + part);
}

/** "S01_000.0-005.1". Never contains a colon, so it is a valid file name everywhere. */
export function formatTimecode(id: string, start: number, end: number): string {
  return `${id}_${formatSeconds(start)}-${formatSeconds(end)}`;
}

export interface ParsedTimecode {
  id: string;
  start: number;
  end: number;
}

/** Reads a timecode from the start of a name such as "S07_032.4-038.9.png". */
export function parseTimecode(name: string): ParsedTimecode | null {
  const match = /^(S\d{2,}[a-z]?)_(\d{3,}\.\d)-(\d{3,}\.\d)(?![\d])/.exec(name);
  if (!match) return null;
  return { id: match[1] ?? "", start: Number(match[2]), end: Number(match[3]) };
}

/** Splits an id such as "S05b" into its number (5) and part letter index (1). */
export function parseSceneId(id: string): { number: number; part: number | null } {
  const match = /^S(\d+)([a-z]?)$/.exec(id);
  if (!match) return { number: 0, part: null };
  const letter = match[2] ?? "";
  return { number: Number(match[1]), part: letter === "" ? null : letter.charCodeAt(0) - 97 };
}
