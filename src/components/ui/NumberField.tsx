import { useEffect, useState } from "react";

import { cn } from "../../lib/cn";
import { INPUT_CLASSES } from "./TextInput";

interface NumberFieldProps {
  id: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  /** Called only with a number inside min..max. */
  onChange: (value: number) => void;
}

/** A number box that lets you type freely (like "-" on the way to "-40") and only reports valid numbers. */
export function NumberField({ id, value, min, max, step = 1, disabled, onChange }: NumberFieldProps) {
  const [text, setText] = useState(String(value));
  const parsed = Number(text);
  const valid = text.trim() !== "" && Number.isFinite(parsed) && parsed >= min && parsed <= max;

  // Show the stored value again when it is changed from outside.
  useEffect(() => {
    setText((current) => (Number(current) === value ? current : String(value)));
  }, [value]);

  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      value={text}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      aria-invalid={!valid}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const number = Number(next);
        if (next.trim() !== "" && Number.isFinite(number) && number >= min && number <= max) onChange(number);
      }}
      onBlur={() => {
        if (!valid) setText(String(value));
      }}
      className={cn(INPUT_CLASSES, !valid && "border-danger")}
    />
  );
}
