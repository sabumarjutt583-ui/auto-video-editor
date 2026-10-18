import type { ReactNode } from "react";

interface FieldProps {
  label: string;
  /** Must match the id of the control inside, so the label is clickable. */
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}

/** A label above a control, with an optional hint below. */
export function Field({ label, htmlFor, hint, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
