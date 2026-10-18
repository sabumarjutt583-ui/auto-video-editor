import { useState } from "react";

import type { ModelOption } from "../../lib/models";
import { Select, TextInput } from "../ui";

const CUSTOM = "__custom__";

interface ModelPickerProps {
  id: string;
  value: string;
  options: readonly ModelOption[];
  onChange: (value: string) => void;
}

/** A dropdown of suggested models plus an "Other" choice that reveals a text box for any model name. */
export function ModelPicker({ id, value, options, onChange }: ModelPickerProps) {
  const [chooseOther, setChooseOther] = useState(false);
  const isSuggested = options.some((option) => option.value === value);
  const showTextBox = chooseOther || !isSuggested;

  return (
    <div className="flex flex-col gap-2">
      <Select
        id={id}
        value={showTextBox ? CUSTOM : value}
        onChange={(event) => {
          if (event.target.value === CUSTOM) {
            setChooseOther(true);
          } else {
            setChooseOther(false);
            onChange(event.target.value);
          }
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        <option value={CUSTOM}>Other (type a model name)…</option>
      </Select>
      {showTextBox && (
        <TextInput
          aria-label="Model name"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="For example: gemini-3.8-flash"
          autoComplete="off"
          spellCheck={false}
        />
      )}
    </div>
  );
}
