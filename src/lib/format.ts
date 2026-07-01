// Render a stored shortcut string (e.g. "CommandOrControl+Shift+Space") as Mac
// glyphs ("⌘ ⇧ Space") for display.
export function prettyShortcut(value: string): string {
  return value
    .replace(/CommandOrControl|Command|Cmd|Mod/gi, "⌘")
    .replace(/Control|Ctrl/gi, "⌃")
    .replace(/Option|Alt/gi, "⌥")
    .replace(/Shift/gi, "⇧")
    .replace(/\+/g, " ");
}

// created_at is stored as epoch-millis (Rust SystemTime); older entries may be
// an ISO string. Accept both.
export function formatCreatedAt(value: string): string {
  const timestamp = /^\d+$/.test(value) ? Number(value) : value;
  return new Date(timestamp).toLocaleString();
}
