import { invoke } from "@tauri-apps/api/core";

export type AgentTarget = "clipboard" | "claude" | "gemini" | "cursor" | "codex";
export type SessionMode = "lastSession" | "newSession";
export type SessionPreferences = Record<Exclude<AgentTarget, "clipboard">, SessionMode>;

export type QueuedPrompt = {
  id: string;
  body: string;
  createdAt: string;
};

type KyuStore = {
  prompts: QueuedPrompt[];
  shortcut: string;
  agent: AgentTarget;
  showMenuBar: boolean;
  startAtLogin: boolean;
  sessionPreferences: SessionPreferences;
};

const fallbackKey = "kyu-dev-store";
const defaultStore: KyuStore = {
  prompts: [],
  shortcut: "CommandOrControl+Space",
  agent: "clipboard",
  showMenuBar: true,
  startAtLogin: false,
  sessionPreferences: {
    claude: "lastSession",
    gemini: "lastSession",
    cursor: "lastSession",
    codex: "lastSession",
  },
};

function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

function readFallback(): KyuStore {
  const raw = window.localStorage.getItem(fallbackKey);
  if (!raw) return defaultStore;

  try {
    return { ...defaultStore, ...JSON.parse(raw) };
  } catch {
    return defaultStore;
  }
}

function writeFallback(store: KyuStore) {
  window.localStorage.setItem(fallbackKey, JSON.stringify(store));
}

export async function loadStore(): Promise<KyuStore> {
  if (isTauri()) return invoke<KyuStore>("load_store");
  return readFallback();
}

export async function savePrompt(body: string): Promise<QueuedPrompt[]> {
  if (isTauri()) return invoke<QueuedPrompt[]>("save_prompt", { body });

  const store = readFallback();
  store.prompts = [
    {
      id: crypto.randomUUID(),
      body,
      createdAt: new Date().toISOString(),
    },
    ...store.prompts,
  ];
  writeFallback(store);
  return store.prompts;
}

export async function deletePrompt(id: string): Promise<QueuedPrompt[]> {
  if (isTauri()) return invoke<QueuedPrompt[]>("delete_prompt", { id });

  const store = readFallback();
  store.prompts = store.prompts.filter((prompt) => prompt.id !== id);
  writeFallback(store);
  return store.prompts;
}

export async function releasePrompts(ids: string[], agent: AgentTarget): Promise<string> {
  if (isTauri()) return invoke<string>("release_prompts", { ids, agent });

  const store = readFallback();
  const selected = ids.length ? store.prompts.filter((prompt) => ids.includes(prompt.id)) : store.prompts;
  const bundle = formatPromptBundle(selected, agent);
  store.prompts = store.prompts.filter((prompt) => !selected.some((released) => released.id === prompt.id));
  store.agent = agent;
  writeFallback(store);
  await navigator.clipboard.writeText(bundle);
  return bundle;
}

export async function installedTargets(): Promise<AgentTarget[]> {
  if (isTauri()) return invoke<AgentTarget[]>("installed_targets");
  return ["clipboard", "claude", "gemini", "cursor", "codex"];
}

export async function setShortcut(shortcut: string): Promise<string> {
  if (isTauri()) return invoke<string>("set_shortcut", { shortcut });

  const store = readFallback();
  store.shortcut = shortcut;
  writeFallback(store);
  return shortcut;
}

export async function setAgent(agent: AgentTarget): Promise<AgentTarget> {
  if (isTauri()) return invoke<AgentTarget>("set_agent", { agent });

  const store = readFallback();
  store.agent = agent;
  writeFallback(store);
  return agent;
}

export async function setPreference(key: "showMenuBar" | "startAtLogin", value: boolean): Promise<KyuStore> {
  if (isTauri()) return invoke<KyuStore>("set_preference", { key, value });

  const store = readFallback();
  store[key] = value;
  writeFallback(store);
  return store;
}

export async function setSessionPreference(target: Exclude<AgentTarget, "clipboard">, mode: SessionMode): Promise<KyuStore> {
  if (isTauri()) return invoke<KyuStore>("set_session_preference", { target, mode });

  const store = readFallback();
  store.sessionPreferences = {
    ...defaultStore.sessionPreferences,
    ...store.sessionPreferences,
    [target]: mode,
  };
  writeFallback(store);
  return store;
}

export function formatPromptBundle(prompts: QueuedPrompt[], agent: AgentTarget) {
  const label = agentLabel(agent);
  return prompts
    .map((prompt, index) => `Prompt ${index + 1} for ${label}\n\n${prompt.body.trim()}`)
    .join("\n\n---\n\n");
}

export function agentLabel(agent: AgentTarget) {
  const labels: Record<AgentTarget, string> = {
    clipboard: "Clipboard",
    claude: "Claude",
    gemini: "Gemini",
    cursor: "Cursor",
    codex: "Codex",
  };
  return labels[agent];
}

export function sessionModeLabel(mode: SessionMode) {
  return mode === "lastSession" ? "last session" : "new session";
}
