import type { InputHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export const INPUT_CLASSES =
  "h-10 w-full rounded-lg border border-line bg-surface-2 px-3 text-sm text-fg placeholder:text-muted/70 " +
  "transition-colors hover:border-accent/40 focus:border-accent disabled:cursor-not-allowed disabled:opacity-50";

export function TextInput({ className, type = "text", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type={type} className={cn(INPUT_CLASSES, className)} {...rest} />;
}
