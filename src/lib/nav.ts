import { AudioLines, Clapperboard, FolderOpen, Settings, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: "/projects", label: "Projects", icon: FolderOpen },
  { path: "/prompt-generator", label: "Prompt Generator", icon: Sparkles },
  { path: "/auto-editor", label: "Auto Editor", icon: Clapperboard },
  { path: "/sfx-library", label: "SFX Library", icon: AudioLines },
  { path: "/settings", label: "Settings", icon: Settings },
  // The Admin page exists only in the Admin Edition (the flag is fixed when the app is built).
  ...(import.meta.env.VITE_ADMIN === "true" ? [{ path: "/admin", label: "Admin", icon: ShieldCheck }] : []),
];

export const DEFAULT_PATH = "/projects";
