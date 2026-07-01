export type TokenKind = "plain" | "skill" | "context";

export interface Token {
  text: string;
  kind: TokenKind;
}

// Split prompt text into runs, tagging /skills and @context mentions so the
// input backdrop can colour them. Everything else is "plain".
export function tokenizeParts(text: string): Token[] {
  const parts: Token[] = [];
  const re = /(@[\w.-]*|\/[\w/-]*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), kind: "plain" });
    parts.push({ text: m[0], kind: m[0].startsWith("@") ? "context" : "skill" });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), kind: "plain" });
  return parts;
}
