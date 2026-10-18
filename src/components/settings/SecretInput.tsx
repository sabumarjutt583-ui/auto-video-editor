import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";

import { TextInput } from "../ui";

interface SecretInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Called when Enter is pressed. */
  onSubmit?: () => void;
  placeholder?: string;
  disabled?: boolean;
}

/** A password field with an eye button to show or hide what was typed. */
export function SecretInput({ id, value, onChange, onSubmit, placeholder, disabled }: SecretInputProps) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  // Hide the text again once the field has been emptied (for example after saving).
  useEffect(() => {
    if (value === "") setVisible(false);
  }, [value]);

  return (
    <div className="relative">
      <TextInput
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSubmit?.();
        }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="pr-11"
      />
      <button
        type="button"
        onClick={() => setVisible((shown) => !shown)}
        aria-label={visible ? "Hide key" : "Show key"}
        aria-pressed={visible}
        className="absolute top-1/2 right-1.5 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:text-fg"
      >
        <Icon size={16} aria-hidden />
      </button>
    </div>
  );
}
