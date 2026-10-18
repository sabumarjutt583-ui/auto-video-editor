/** Everything the Auto Editor adds to a project. Stored in `project.editor` (see src-tauri model.rs). */

export type MediaKind = "image" | "video";

/** How a file came to belong to its scene. */
export type MatchHow = "name" | "number" | "order" | "gemini" | "manual" | "rename";

/** A picture or clip copied into the project's media folder. */
export interface MediaFile {
  /** Inside the project, e.g. "media/S01_000.0-005.1.png". Also the file's identity. */
  path: string;
  name: string;
  kind: MediaKind;
  width: number;
  height: number;
  /** Seconds. 0 for pictures. */
  duration: number;
  /** When the original file was last changed (seconds since 1970). Used to sort by date. */
  modified: number;
  /** The scene it is matched to, or null while it is unmatched. */
  sceneId: string | null;
  /** The timecode written in the file name, if there was one. */
  start: number | null;
  end: number | null;
  how: MatchHow | null;
  /** Gemini's confidence, 0 to 1. */
  confidence: number | null;
}

/** Which time to follow when a file's timecode differs from the project's scene. */
export type TimeChoice = "file" | "project";

/** What to show for a scene that has no media. */
export type Placeholder = "hold" | "black" | "blur";

export type KenBurns = "auto" | "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "pan_up" | "none";
export type VideoFit = "crop" | "blur";
export type Transition = "auto" | "cut" | "fade" | "dissolve" | "slide" | "zoom" | "whip";

/** Per-scene choices that differ from the automatic ones. */
export interface SceneOverride {
  kenBurns: KenBurns;
  videoFit: VideoFit;
  /** Playback speed of a clip that is shorter than its scene (1 = normal, 0.5 = half speed). */
  speed: number;
  /** The transition into this scene. */
  transition: Transition;
  /** The scene is marked as an important moment (used for sound effects). */
  emphasis: boolean;
}

export type CaptionPreset = "clean" | "highlight" | "pop" | "boxed" | "documentary" | "none";
export type CaptionPosition = "bottom" | "middle" | "top";
/** The writing system of the narration. Decides the line length and the font. */
export type CaptionScript = "latin" | "korean" | "japanese" | "chinese" | "devanagari" | "arabic" | "urdu" | "other";
/** A bundled font, or "auto" to pick it from the script. */
export type CaptionFont = "auto" | "noto_sans" | "noto_kr" | "noto_jp" | "noto_sc" | "noto_devanagari" | "noto_arabic";

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

/** What is on screen from `start` to `end`: up to two lines of text. */
export interface CaptionLine {
  id: string;
  start: number;
  end: number;
  /** The words with their times. A line break in the text is a "\n". */
  text: string;
  words: CaptionWord[];
  /** Index of the word that starts the second line (null for one line). */
  breakAt: number | null;
}

export interface CaptionStyle {
  preset: CaptionPreset;
  font: CaptionFont;
  /** Percent of the short side of the frame. */
  fontSize: number;
  primary: string;
  highlight: string;
  /** 0 to 8 */
  outline: number;
  /** 0 to 8 */
  shadow: number;
  position: CaptionPosition;
  uppercase: boolean;
}

export interface CaptionData {
  style: CaptionStyle;
  /** The lines the user has edited, or null while they are built from the voice. */
  lines: CaptionLine[] | null;
}

export type DuckingPreset = "off" | "light" | "normal" | "strong";
export type MusicMode = "loop" | "fade";
export type SfxIntensity = "low" | "normal" | "high";
export type SfxCategory = "whoosh" | "hit" | "pop" | "riser" | "ambience" | "soft_swell" | "click" | "transition";
/** Why a sound effect is where it is. */
export type SfxReason = "whoosh" | "pop" | "hit" | "riser" | "ambience" | "manual";

/** A music file copied into the project's music folder. */
export interface MusicTrack {
  id: string;
  /** Inside the project, e.g. "music/theme.mp3". */
  path: string;
  name: string;
  /** Seconds. */
  duration: number;
}

/** A sound of the built-in library (resources/sfx/index.json). */
export interface SfxSound {
  id: string;
  file: string;
  category: SfxCategory;
  tags: string[];
  duration: number;
  /** 0 to 1 */
  defaultGain: number;
}

/** One sound effect on the timeline. */
export interface SfxCue {
  id: string;
  soundId: string;
  /** Seconds from the start of the video. */
  time: number;
  /** 0 to 1 */
  gain: number;
  reason: SfxReason;
}

/** What the last audio mix measured. */
export interface MixInfo {
  path: string;
  integrated: number;
  truePeak: number;
  range: number;
  /** When it was built (ISO time). */
  builtAt: string;
}

export interface AudioData {
  tracks: MusicTrack[];
  /** Percent, 0 to 100. */
  musicVolume: number;
  /** Seconds. */
  fadeIn: number;
  fadeOut: number;
  mode: MusicMode;
  ducking: DuckingPreset;
  autoSfx: boolean;
  intensity: SfxIntensity;
  /** Percent, 0 to 100: the master volume of all sound effects. */
  sfxVolume: number;
  /** The sound effects the user has edited, or null while they are planned by the rules. */
  cues: SfxCue[] | null;
  /** Sounds added by hand from the SFX Library while the effects are still planned by the rules. */
  addedCues: SfxCue[];
  /** Bring the final audio to -14 LUFS. */
  normalize: boolean;
  mix: MixInfo | null;
}

export type RenderFps = 24 | 30 | 60;
/** "cut": no transitions. "fade": cross-fades. "mixed": mostly cuts, some fades and slides. */
export type TransitionMode = "cut" | "fade" | "mixed";

/** The output choices of the final render (aspect ratio and quality are in `project.settings`). */
export interface RenderData {
  fps: RenderFps;
  transitions: TransitionMode;
  kenBurns: boolean;
}

export interface EditorData {
  media: MediaFile[];
  timeChoices: Record<string, TimeChoice>;
  placeholder: Placeholder;
  overrides: Record<string, SceneOverride>;
  captions: CaptionData;
  audio: AudioData;
  render: RenderData;
}

/** What `scan_media` returns for one file (nothing is copied yet). */
export interface SourceMedia {
  path: string;
  name: string;
  kind: MediaKind;
  width: number;
  height: number;
  duration: number;
  modified: number;
  size: number;
}

export interface SkippedFile {
  name: string;
  reason: string;
  details: string;
}

export interface ScanResult {
  files: SourceMedia[];
  skipped: SkippedFile[];
}

export interface ImportItem {
  source: string;
  /** The name for the copy (Bulk Rename). Leave out to keep the original name. */
  name?: string;
}

export interface ImportedMedia {
  source: string;
  name: string;
  path: string;
  kind: MediaKind;
  width: number;
  height: number;
  duration: number;
  modified: number;
}

export interface ImportResult {
  imported: ImportedMedia[];
  failed: SkippedFile[];
}

export interface ThumbItem {
  path: string;
  kind: MediaKind;
  duration: number;
}

export interface ThumbResult {
  path: string;
  thumbs: string[];
}

export interface FileMatch {
  sceneId: string;
  file: string;
  confidence: number;
}
