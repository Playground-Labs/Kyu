import { describe, it, expect } from "vitest";
import { tokenizeParts } from "./highlight";

describe("tokenizeParts", () => {
  it("returns a single plain run for text with no tokens", () => {
    expect(tokenizeParts("just some text")).toEqual([
      { text: "just some text", kind: "plain" },
    ]);
  });

  it("tags /skills as skill and @context as context", () => {
    expect(tokenizeParts("run /ponytail on @CLAUDE.md")).toEqual([
      { text: "run ", kind: "plain" },
      { text: "/ponytail", kind: "skill" },
      { text: " on ", kind: "plain" },
      { text: "@CLAUDE.md", kind: "context" },
    ]);
  });

  it("handles a token at the very start with no leading plain run", () => {
    expect(tokenizeParts("/fix now")).toEqual([
      { text: "/fix", kind: "skill" },
      { text: " now", kind: "plain" },
    ]);
  });

  it("keeps adjacent tokens separate", () => {
    expect(tokenizeParts("@a/b")).toEqual([
      { text: "@a", kind: "context" },
      { text: "/b", kind: "skill" },
    ]);
  });

  it("matches nested skill paths and dotted/hyphen context names", () => {
    expect(tokenizeParts("/ui/design and @my-file.ts")).toEqual([
      { text: "/ui/design", kind: "skill" },
      { text: " and ", kind: "plain" },
      { text: "@my-file.ts", kind: "context" },
    ]);
  });

  it("does not treat an email @ inside a word as context", () => {
    // "a@b" -> "a" is plain, "@b" is a context token (matches app behavior)
    expect(tokenizeParts("a@b")).toEqual([
      { text: "a", kind: "plain" },
      { text: "@b", kind: "context" },
    ]);
  });

  it("returns an empty list for empty input", () => {
    expect(tokenizeParts("")).toEqual([]);
  });
});
