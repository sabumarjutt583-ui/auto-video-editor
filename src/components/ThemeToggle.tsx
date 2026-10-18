import { Moon, Sun } from "lucide-react";

import { useThemeStore } from "../store/themeStore";

/** Switches between the dark (default) and light theme. */
export function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface-2 text-muted transition-colors hover:text-fg"
    >
      <Icon size={18} aria-hidden />
    </button>
  );
}
