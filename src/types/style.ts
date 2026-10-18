/** A style profile (mirrors src-tauri/src/styles.rs). Every text field may be empty in a placeholder. */
export interface StyleProfile {
  id: string;
  name: string;
  category: string;
  version: string;
  core_identity: string;
  medium: string;
  lighting: string;
  color_palette: string;
  camera: string;
  composition: string;
  texture: string;
  characters: string;
  mood: string;
  negative: string;
  motion_rules: string;
  style_lock: string;
  example_prompt: string;
  /** Optional path to a preview picture. */
  thumbnail: string;
  /** True for styles that ship with the app. */
  builtin: boolean;
}

export interface StyleLibrary {
  styles: StyleProfile[];
  warnings: string[];
}

export type StyleTextField = Exclude<keyof StyleProfile, "id" | "name" | "category" | "builtin">;
