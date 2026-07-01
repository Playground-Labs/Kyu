import { describe, it, expect } from "vitest";
import { shortcutFromKey, type KeyInput } from "./shortcut";

const key = (over: Partial<KeyInput>): KeyInput => ({
  code: "KeyK", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over,
});

describe("shortcutFromKey", () => {
  it("builds a combo from modifiers + a letter", () => {
    expect(shortcutFromKey(key({ code: "KeyK", metaKey: true, shiftKey: true })))
      .toEqual({ combo: "Cmd+Shift+K" });
  });

  it("orders modifiers Cmd, Ctrl, Option, Shift", () => {
    expect(shortcutFromKey(key({ code: "KeyA", metaKey: true, ctrlKey: true, altKey: true, shiftKey: true })))
      .toEqual({ combo: "Cmd+Ctrl+Option+Shift+A" });
  });

  it("supports Space and Enter as the final key", () => {
    expect(shortcutFromKey(key({ code: "Space", metaKey: true, shiftKey: true })))
      .toEqual({ combo: "Cmd+Shift+Space" });
    expect(shortcutFromKey(key({ code: "Enter", ctrlKey: true })))
      .toEqual({ combo: "Ctrl+Enter" });
  });

  it("ignores a lone modifier keypress (returns null)", () => {
    expect(shortcutFromKey(key({ code: "MetaLeft", metaKey: true }))).toBeNull();
    expect(shortcutFromKey(key({ code: "ShiftRight", shiftKey: true }))).toBeNull();
  });

  it("hints when there is no modifier (would hijack a plain key)", () => {
    expect(shortcutFromKey(key({ code: "KeyK" })))
      .toEqual({ hint: "Add a modifier (⌘ ⌃ ⌥)" });
  });

  it("hints when the main key is unsupported by the Rust parser", () => {
    expect(shortcutFromKey(key({ code: "Digit1", metaKey: true })))
      .toEqual({ hint: "Use a letter, Space, or Enter" });
    expect(shortcutFromKey(key({ code: "F1", metaKey: true })))
      .toEqual({ hint: "Use a letter, Space, or Enter" });
  });
});
