import { invoke } from "@tauri-apps/api/core";

export type QueuedPrompt = {
  id: string;
  body: string;
  createdAt: string;
};

type KyuStore = {
  prompts: QueuedPrompt[];
  shortcut: string;
  showMenuBar: boolean;
  startAtLogin: boolean;
  windowPosition: { x: number; y: number } | null;
};

const fallbackKey = "kyu-dev-store";
const defaultStore: KyuStore = {
  prompts: [],
  shortcut: "CommandOrControl+Space",
  showMenuBar: true,
  startAtLogin: false,
  windowPosition: null,
};

type LegacyStore = Partial<KyuStore>;

function isTauri() {
  return "__TAURI_INTERNALS__" in window;
}

function readFallback(): LegacyStore {
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
  return normalizeStore(readFallback());
}

export async function savePrompt(body: string): Promise<QueuedPrompt[]> {
  if (isTauri()) return invoke<QueuedPrompt[]>("save_prompt", { body });

  const store = normalizeStore(readFallback());
  store.prompts = [
    ...store.prompts,
    {
      id: crypto.randomUUID(),
      body,
      createdAt: new Date().toISOString(),
    },
  ];
  writeFallback(store);
  return store.prompts;
}

export async function deletePrompt(id: string): Promise<QueuedPrompt[]> {
  if (isTauri()) return invoke<QueuedPrompt[]>("delete_prompt", { id });

  const store = normalizeStore(readFallback());
  store.prompts = store.prompts.filter((prompt) => prompt.id !== id);
  writeFallback(store);
  return store.prompts;
}

export async function releasePrompts(ids: string[]): Promise<string> {
  if (isTauri()) return invoke<string>("release_prompts", { ids });

  const store = normalizeStore(readFallback());
  const selected = ids.length ? store.prompts.filter((prompt) => ids.includes(prompt.id)) : store.prompts;
  const bundle = ids.length ? (selected[0]?.body.trim() ?? "") : formatPromptBundle(selected);
  store.prompts = store.prompts.filter((prompt) => !selected.some((released) => released.id === prompt.id));
  writeFallback(store);
  await navigator.clipboard.writeText(bundle);
  return bundle;
}

export async function setShortcut(shortcut: string): Promise<string> {
  if (isTauri()) return invoke<string>("set_shortcut", { shortcut });

  const store = normalizeStore(readFallback());
  store.shortcut = shortcut;
  writeFallback(store);
  return shortcut;
}

export async function setPreference(key: "showMenuBar" | "startAtLogin", value: boolean): Promise<KyuStore> {
  if (isTauri()) return invoke<KyuStore>("set_preference", { key, value });

  const store = normalizeStore(readFallback());
  store[key] = value;
  writeFallback(store);
  return store;
}

export function formatPromptBundle(prompts: QueuedPrompt[]) {
  const items = prompts
    .map((prompt, index) => `${index + 1}. """\n${prompt.body.trim()}\n"""`)
    .join("\n\n");

  return [
    "Exported from Kyu (a prompt queuing app). Execute them in FIFO order.",
    items,
  ].join("\n\n");
}

function normalizeStore(store: LegacyStore): KyuStore {
  return {
    ...defaultStore,
    ...store,
  };
}
