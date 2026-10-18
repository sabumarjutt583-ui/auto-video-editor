import type { InputHTMLAttributes } from "react";

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
}

export function Checkbox({ label, ...rest }: CheckboxProps) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
      <input type="checkbox" className="h-4 w-4 cursor-pointer accent-accent" {...rest} />
      {label}
    </label>
  );
}
