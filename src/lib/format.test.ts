import { describe, it, expect } from "vitest";
import { prettyShortcut, formatCreatedAt } from "./format";

describe("prettyShortcut", () => {
  it("renders the default as Mac glyphs", () => {
    expect(prettyShortcut("CommandOrControl+Shift+Space")).toBe("⌘ ⇧ Space");
  });

  it("maps every modifier alias to its glyph", () => {
    expect(prettyShortcut("Cmd+Ctrl+Option+Shift+K")).toBe("⌘ ⌃ ⌥ ⇧ K");
    expect(prettyShortcut("Command+Control+Alt+Shift+A")).toBe("⌘ ⌃ ⌥ ⇧ A");
  });

  it("leaves a plain combo readable", () => {
    expect(prettyShortcut("Ctrl+Enter")).toBe("⌃ Enter");
  });
});

describe("formatCreatedAt", () => {
  it("parses epoch-millis strings", () => {
    const ms = Date.UTC(2026, 0, 2, 3, 4, 5).toString();
    expect(formatCreatedAt(ms)).toBe(new Date(Number(ms)).toLocaleString());
  });

  it("accepts legacy ISO strings", () => {
    const iso = "2026-01-02T03:04:05.000Z";
    expect(formatCreatedAt(iso)).toBe(new Date(iso).toLocaleString());
  });
});
