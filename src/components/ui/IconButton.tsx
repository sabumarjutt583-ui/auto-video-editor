import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  icon: LucideIcon;
  /** Names the button for screen readers and shows as a tooltip. */
  label: string;
  danger?: boolean;
}

/** A small square button with just an icon. */
export function IconButton({ icon: Icon, label, danger = false, className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        danger ? "hover:bg-danger/10 hover:text-danger" : "hover:bg-surface-2 hover:text-fg",
        className,
      )}
      {...rest}
    >
      <Icon size={16} aria-hidden />
    </button>
  );
}
