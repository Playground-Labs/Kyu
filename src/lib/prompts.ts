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

export async function loadStore(): Promise<KyuStore> {
  return invoke<KyuStore>("load_store");
}

export async function savePrompt(body: string): Promise<QueuedPrompt[]> {
  return invoke<QueuedPrompt[]>("save_prompt", { body });
}

export async function deletePrompt(id: string): Promise<QueuedPrompt[]> {
  return invoke<QueuedPrompt[]>("delete_prompt", { id });
}

export async function releasePrompts(ids: string[]): Promise<string> {
  return invoke<string>("release_prompts", { ids });
}

export async function setShortcut(shortcut: string): Promise<string> {
  return invoke<string>("set_shortcut", { shortcut });
}

export async function suspendShortcut(): Promise<void> {
  return invoke("suspend_shortcut");
}

export async function resumeShortcut(): Promise<void> {
  return invoke("resume_shortcut");
}

export async function setPreference(key: "showMenuBar" | "startAtLogin", value: boolean): Promise<KyuStore> {
  return invoke<KyuStore>("set_preference", { key, value });
}
