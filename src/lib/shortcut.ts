export const MODIFIER_CODES = [
  "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight",
  "ControlLeft", "ControlRight", "AltLeft", "AltRight",
];

export interface KeyInput {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

// null  -> ignore this keypress (a lone modifier; wait for the real key)
// hint  -> invalid combo, show the hint to the user
// combo -> a parseable shortcut string, e.g. "Cmd+Shift+K"
export type ShortcutResult = { combo: string } | { hint: string } | null;

export function shortcutFromKey(event: KeyInput): ShortcutResult {
  if (MODIFIER_CODES.includes(event.code)) return null;

  let mainKey: string | null = null;
  if (/^Key[A-Z]$/.test(event.code)) mainKey = event.code.slice(3);
  else if (event.code === "Space") mainKey = "Space";
  else if (event.code === "Enter") mainKey = "Enter";

  const modifiers: string[] = [];
  if (event.metaKey) modifiers.push("Cmd");
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Option");
  if (event.shiftKey) modifiers.push("Shift");

  if (!mainKey) return { hint: "Use a letter, Space, or Enter" };
  if (modifiers.length === 0) return { hint: "Add a modifier (⌘ ⌃ ⌥)" };
  return { combo: [...modifiers, mainKey].join("+") };
}
