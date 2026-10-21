import { useEffect, useState } from "react";

import { TextInput } from "../ui";

interface CommitInputProps {
  id: string;
  value: string;
  placeholder?: string;
  /** Called when the box loses focus (or Enter is pressed) with a changed text. */
  onCommit: (value: string) => void;
}

/** A text box that keeps what is typed and saves once, when you leave it. */
export function CommitInput({ id, value, placeholder, onCommit }: CommitInputProps) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  return (
    <TextInput
      id={id}
      value={text}
      placeholder={placeholder}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === "Enter" && commit()}
      autoComplete="off"
      spellCheck={false}
    />
  );
}
