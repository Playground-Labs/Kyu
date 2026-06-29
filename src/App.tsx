import { FormEvent, PointerEvent, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Check,
  Clipboard,
  CornerDownLeft,
  Keyboard,
  ListPlus,
  ListTodo,
  Send,
  Settings2,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from "lucide-react";
import { SiClaude, SiGooglegemini, SiOpenai } from "react-icons/si";
import type { IconType } from "react-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  AgentTarget,
  DeliveryMode,
  QueuedPrompt,
  SessionMode,
  agentLabel,
  deletePrompt,
  deliveryModeLabel,
  installedTargets,
  loadStore,
  releasePrompts,
  setDeliveryMode,
  savePrompt,
  setPreference,
  setSessionMode,
  setShortcut,
  sessionModeLabel,
} from "@/lib/prompts";

type ReleaseIntent = {
  ids: string[];
  key: string;
};

type StatusMessage = {
  id: number;
  text: string;
};

const releaseTargets: AgentTarget[] = ["clipboard", "claude", "gemini", "cursor", "codex"];

const targetIcons: Record<AgentTarget, IconType | typeof Clipboard> = {
  clipboard: Clipboard,
  claude: SiClaude,
  gemini: SiGooglegemini,
  cursor: CursorLogo,
  codex: SiOpenai,
};

export function App() {
  const isNative = "__TAURI_INTERNALS__" in window;
  const [prompt, setPrompt] = useState("");
  const [queue, setQueue] = useState<QueuedPrompt[]>([]);
  const [availableTargets, setAvailableTargets] = useState<AgentTarget[]>(["clipboard"]);
  const [shortcut, setShortcutValue] = useState("CommandOrControl+Space");
  const [shortcutDraft, setShortcutDraft] = useState("CommandOrControl+Space");
  const [showMenuBar, setShowMenuBar] = useState(true);
  const [startAtLogin, setStartAtLogin] = useState(false);
  const [sessionMode, setSessionModeValue] = useState<SessionMode>("lastSession");
  const [deliveryMode, setDeliveryModeValue] = useState<DeliveryMode>("copyOnly");
  const [showQueue, setShowQueue] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [releaseIntent, setReleaseIntent] = useState<ReleaseIntent | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startCursorX: number;
    startCursorY: number;
    startWindowX: number;
    startWindowY: number;
  } | null>(null);
  const statusTimeoutRef = useRef<number | null>(null);

  function showStatus(text: string, persistent = false) {
    if (statusTimeoutRef.current) {
      window.clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = null;
    }

    setStatus({ id: Date.now(), text });

    if (!persistent) {
      statusTimeoutRef.current = window.setTimeout(() => {
        setStatus(null);
        statusTimeoutRef.current = null;
      }, 2600);
    }
  }

  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) window.clearTimeout(statusTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    loadStore().then((store) => {
      setQueue(store.prompts);
      setShortcutValue(store.shortcut);
      setShortcutDraft(store.shortcut);
      setShowMenuBar(store.showMenuBar);
      setStartAtLogin(store.startAtLogin);
      setSessionModeValue(store.sessionMode);
      setDeliveryModeValue(store.deliveryMode);
    });

    installedTargets().then((targets) => {
      setAvailableTargets(targets.length ? targets : ["clipboard"]);
    });
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!isNative || !shellRef.current) return;

    const shell = shellRef.current;

    const resizeToShell = () => {
      const rect = shell.getBoundingClientRect();
      void invoke("resize_window_to", {
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height),
      }).catch(() => undefined);
    };

    resizeToShell();
    const observer = new ResizeObserver(resizeToShell);
    observer.observe(shell);

    return () => observer.disconnect();
  }, [isNative, showQueue, showSettings, queue.length, releaseIntent?.key]);

  useEffect(() => {
    if (!isNative) return;

    const unlisteners = Promise.all([
      listen("kyu-focus", () => inputRef.current?.focus()),
      listen("kyu-release-all", () => {
        startRelease([]);
      }),
    ]);

    return () => {
      void unlisteners.then((callbacks) => callbacks.forEach((unlisten) => unlisten()));
    };
  }, [isNative, queue]);

  const queueSummary = useMemo(() => {
    if (queue.length === 0) return "Queue empty";
    if (queue.length === 1) return "1 prompt waiting";
    return `${queue.length} prompts waiting`;
  }, [queue.length]);

  const visibleTargets = useMemo(
    () => releaseTargets.filter((target) => availableTargets.includes(target)),
    [availableTargets],
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await queuePrompt();
  }

  async function queuePrompt() {
    const body = prompt.trim();
    if (!body) return;

    const prompts = await savePrompt(body);
    setQueue(prompts);
    setPrompt("");
    showStatus("Saved");
    setShowQueue(true);
    setShowSettings(false);
    setReleaseIntent(null);
  }

  function startRelease(ids: string[]) {
    const releasedCount = ids.length || queue.length;
    if (!releasedCount) return;

    setShowQueue(true);
    setShowSettings(false);
    setReleaseIntent({ ids, key: ids.length ? ids.join(":") : "all" });
    showStatus("Release to...", true);
  }

  async function release(agent: AgentTarget, ids: string[]) {
    const releasedCount = ids.length || queue.length;
    if (!releasedCount) return;

    const result = await releasePrompts(ids, agent);
    await navigator.clipboard.writeText(result.bundle).catch(() => undefined);
    setQueue((current) => (ids.length ? current.filter((item) => !ids.includes(item.id)) : []));
    setReleaseIntent(null);
    const deliveryText =
      agent === "clipboard" || result.delivery === "copyOnly"
        ? "copied"
        : result.submitted
          ? "sent"
          : "pasted";
    const sessionText = agent === "clipboard" ? "" : `, ${sessionModeLabel(sessionMode)}`;
    showStatus(`${releasedCount} prompt${releasedCount === 1 ? "" : "s"} ${deliveryText} to ${agentLabel(agent)}${sessionText}`);
  }

  async function remove(id: string) {
    const prompts = await deletePrompt(id);
    setQueue(prompts);
    setReleaseIntent((current) => (current?.ids.includes(id) ? null : current));
    showStatus("Removed");
  }

  async function saveShortcut() {
    const nextShortcut = shortcutDraft.trim();
    if (!nextShortcut) return;

    const saved = await setShortcut(nextShortcut);
    setShortcutValue(saved);
    showStatus(`Shortcut set to ${saved}`);
  }

  async function updatePreference(key: "showMenuBar" | "startAtLogin", value: boolean) {
    const store = await setPreference(key, value);
    setShowMenuBar(store.showMenuBar);
    setStartAtLogin(store.startAtLogin);
    showStatus(key === "showMenuBar" ? "Menu bar saved" : "Login saved");
  }

  async function updateSessionMode(mode: SessionMode) {
    const store = await setSessionMode(mode);
    setSessionModeValue(store.sessionMode);
    showStatus(`Session: ${sessionModeLabel(mode)}`);
  }

  async function updateDeliveryMode(mode: DeliveryMode) {
    const store = await setDeliveryMode(mode);
    setDeliveryModeValue(store.deliveryMode);
    showStatus(`Delivery: ${deliveryModeLabel(mode)}`);
  }

  async function startWindowDrag(event: PointerEvent<HTMLElement>) {
    if (!isNative || event.button !== 0) return;

    const target = event.target as HTMLElement;
    if (target.closest("button, select, textarea, a, [role='button'], [data-no-window-drag]")) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    try {
      await invoke("start_native_drag");
      return;
    } catch {
      // Fall back to explicit positioning when native dragging is unavailable.
    }

    const [x, y] = await invoke<[number, number]>("window_position");

    dragRef.current = {
      pointerId: event.pointerId,
      startCursorX: event.screenX,
      startCursorY: event.screenY,
      startWindowX: x,
      startWindowY: y,
    };
  }

  function moveWindow(event: PointerEvent<HTMLElement>) {
    if (!isNative || dragRef.current?.pointerId !== event.pointerId) return;

    const drag = dragRef.current;
    void invoke("move_window_to", {
      x: Math.round(drag.startWindowX + event.screenX - drag.startCursorX),
      y: Math.round(drag.startWindowY + event.screenY - drag.startCursorY),
    }).catch(() => undefined);
  }

  function stopWindowDrag(event: PointerEvent<HTMLElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <main
      className={cn(
        "flex min-h-[100dvh] items-start justify-center",
        !isNative && "bg-[linear-gradient(135deg,#e7ebf0_0%,#f8fafc_42%,#dde4ec_100%)]",
      )}
    >
      <section
        ref={shellRef}
        className="spotlight-shell w-full max-w-3xl overflow-hidden rounded-[28px]"
        onPointerDown={startWindowDrag}
        onPointerMove={moveWindow}
        onPointerUp={stopWindowDrag}
        onPointerCancel={stopWindowDrag}
      >
        <form onSubmit={handleSubmit} className="flex items-center gap-3 px-4 py-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <ListPlus className="size-4" aria-hidden="true" />
          </div>
          <Input
            ref={inputRef}
            aria-label="Prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void queuePrompt();
              }
            }}
            placeholder="Queue a prompt for later..."
            className="h-14 flex-1 truncate border-0 bg-transparent px-0 text-[1.35rem] leading-none shadow-none placeholder:text-slate-400 focus-visible:ring-0"
          />
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Show queue"
              onClick={() => {
                setShowQueue((open) => {
                  const next = !open;
                  if (next) setShowSettings(false);
                  return next;
                });
              }}
            >
              <ListTodo />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Settings"
              onClick={() => {
                setShowSettings((open) => {
                  const next = !open;
                  if (next) {
                    setShowQueue(false);
                    setReleaseIntent(null);
                  }
                  return next;
                });
              }}
            >
              <Settings2 />
            </Button>
            <Button type="submit" size="icon" title="Save prompt" disabled={!prompt.trim()}>
              <CornerDownLeft />
            </Button>
          </div>
        </form>

        <div className="flex items-center justify-between border-t border-white/70 bg-white/38 px-5 py-2 text-xs text-muted-foreground">
          <span>{queueSummary}</span>
          <AnimatedStatus status={status} />
        </div>

        <AnimatedPanel
          open={showSettings}
          className="border-t border-slate-300/70 bg-white/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]"
          contentClassName="px-5 py-4"
        >
            <label className="grid gap-2 text-sm font-medium">
              <span className="flex items-center gap-2">
                <Keyboard className="size-4" />
                Keyboard shortcut
              </span>
              <Input value={shortcutDraft} onChange={(event) => setShortcutDraft(event.target.value)} data-no-window-drag />
            </label>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>Current shortcut: {shortcut}</span>
              <Button type="button" size="sm" onClick={saveShortcut}>
                <Check />
                Save
              </Button>
            </div>
            <div className="mt-4 grid gap-2 border-t border-border/70 pt-3">
              <PreferenceToggle
                label="Show in menu bar"
                checked={showMenuBar}
                onChange={(checked) => updatePreference("showMenuBar", checked)}
              />
              <PreferenceToggle
                label="Start at login"
                checked={startAtLogin}
                onChange={(checked) => updatePreference("startAtLogin", checked)}
              />
            </div>
            <div className="mt-4 border-t border-border/70 pt-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold">Send behavior</p>
                <p className="text-xs text-muted-foreground">All agents</p>
              </div>
              <SendBehaviorControls
                sessionMode={sessionMode}
                deliveryMode={deliveryMode}
                onSessionChange={updateSessionMode}
                onDeliveryChange={updateDeliveryMode}
              />
            </div>
        </AnimatedPanel>

        <AnimatedPanel
          open={showQueue}
          className="border-t border-slate-300/70 bg-white/46 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]"
        >
            <div className="flex items-center justify-between gap-4 px-5 py-3">
              <div>
                <p className="text-sm font-semibold">Prompt queue</p>
                <p className="text-xs text-muted-foreground">Export one prompt or release everything at once.</p>
              </div>
              <ReleaseControl
                disabled={!queue.length}
                expanded={releaseIntent?.key === "all"}
                targets={visibleTargets}
                onStart={() => startRelease([])}
                onCancel={() => setReleaseIntent(null)}
                onRelease={(agent) => release(agent, [])}
              />
            </div>
            <ScrollArea className="max-h-[380px] px-2 pb-3">
              {queue.length ? (
                <div className="grid gap-1">
                  {queue.map((item) => (
                    <article key={item.id} className="queue-row grid grid-cols-[1fr_auto] gap-3">
                      <button type="button" className="min-w-0 text-left" onClick={() => setPrompt(item.body)}>
                        <p className="truncate text-sm font-medium">{item.body}</p>
                        <time className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</time>
                      </button>
                      <div className="flex items-center gap-1">
                        <ReleaseControl
                          compact
                          expanded={releaseIntent?.key === item.id}
                          targets={visibleTargets}
                          onStart={() => startRelease([item.id])}
                          onCancel={() => setReleaseIntent(null)}
                          onRelease={(agent) => release(agent, [item.id])}
                        />
                        <Button type="button" variant="ghost" size="icon" title="Remove prompt" onClick={() => remove(item.id)}>
                          <Trash2 />
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="px-3 py-10 text-center text-sm text-muted-foreground">Saved prompts will appear here.</div>
              )}
            </ScrollArea>
        </AnimatedPanel>
      </section>
    </main>
  );
}

function AnimatedPanel({
  open,
  children,
  className,
  contentClassName,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const [rendered, setRendered] = useState(open);
  const [height, setHeight] = useState(open ? "auto" : "0px");
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setRendered(true);
      return;
    }

    const element = contentRef.current;
    if (element) {
      setHeight(`${element.scrollHeight}px`);
      window.requestAnimationFrame(() => setHeight("0px"));
    }

    const timeout = window.setTimeout(() => setRendered(false), 300);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useLayoutEffect(() => {
    if (!rendered) return;

    const element = contentRef.current;
    if (!element) return;

    if (open) {
      setHeight("0px");
      const frame = window.requestAnimationFrame(() => setHeight(`${element.scrollHeight}px`));
      return () => window.cancelAnimationFrame(frame);
    }

    setHeight(`${element.scrollHeight}px`);
    const frame = window.requestAnimationFrame(() => setHeight("0px"));

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [open, rendered]);

  useEffect(() => {
    if (!open || !rendered) return;

    const element = contentRef.current;
    if (!element) return;

    const observer = new ResizeObserver(() => setHeight(`${element.scrollHeight}px`));
    observer.observe(element);

    return () => observer.disconnect();
  }, [open, rendered]);

  if (!rendered) return null;

  return (
    <div
      className={cn("panel-expander overflow-hidden", open ? "panel-expander-open" : "panel-expander-closed", className)}
      style={{ height }}
      aria-hidden={!open}
    >
      <div ref={contentRef} className={cn("panel-expander-content", open ? "panel-content-open" : "panel-content-closed", contentClassName)}>
        {children}
      </div>
    </div>
  );
}

function AnimatedStatus({ status }: { status: StatusMessage | null }) {
  return (
    <span className="status-slot" aria-live="polite">
      {status ? (
        <span key={status.id} className="status-message">
          {status.text}
        </span>
      ) : null}
    </span>
  );
}

function ReleaseControl({
  compact = false,
  disabled = false,
  expanded,
  targets,
  onStart,
  onCancel,
  onRelease,
}: {
  compact?: boolean;
  disabled?: boolean;
  expanded: boolean;
  targets: AgentTarget[];
  onStart: () => void;
  onCancel: () => void;
  onRelease: (agent: AgentTarget) => void;
}) {
  const [renderTargets, setRenderTargets] = useState(expanded);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (expanded) {
      setRenderTargets(true);
      setClosing(false);
      return;
    }

    if (!renderTargets) return;

    setClosing(true);
    const timeout = window.setTimeout(() => {
      setRenderTargets(false);
      setClosing(false);
    }, 340);

    return () => window.clearTimeout(timeout);
  }, [expanded, renderTargets]);

  if (renderTargets) {
    return (
      <div className={cn("release-targets flex items-center gap-1", closing && "release-targets-out")}>
        {targets.map((target, index) => {
          const Icon = targetIcons[target];
          return (
            <Button
              key={target}
              type="button"
              variant={target === "clipboard" ? "default" : "secondary"}
              size="icon"
              title={`Release to ${agentLabel(target)}`}
              className={cn("size-9 origin-center", closing ? "release-target-button-out" : "release-target-button")}
              style={{ animationDelay: `${(closing ? targets.length - index - 1 : index) * (closing ? 24 : 38)}ms` }}
              onClick={() => onRelease(target)}
            >
              <Icon className="size-4" />
            </Button>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Cancel release"
          className={cn("size-9 origin-center", closing ? "release-target-button-out" : "release-target-button")}
          style={{ animationDelay: `${(closing ? 0 : targets.length) * 32}ms` }}
          onClick={onCancel}
        >
          <CornerDownLeft className="rotate-180" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      type="button"
      disabled={disabled}
      variant={compact ? "ghost" : "default"}
      size={compact ? "icon" : "default"}
      title="Release to..."
      className="release-main-button origin-center"
      onClick={onStart}
    >
      <Send />
      {compact ? null : "Release all"}
    </Button>
  );
}

function CursorLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none">
      <path
        d="M12 2.75 21.25 12 12 21.25 2.75 12 12 2.75Z"
        fill="currentColor"
      />
      <path
        d="M8.15 7.1 16.9 12l-8.75 4.9 2.2-4.9-2.2-4.9Z"
        fill="white"
        fillOpacity="0.92"
      />
    </svg>
  );
}

function PreferenceToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const Icon = checked ? ToggleRight : ToggleLeft;

  return (
    <button
      type="button"
      className="flex h-10 items-center justify-between rounded-lg px-2 text-sm font-medium transition-colors hover:bg-white/65"
      onClick={() => onChange(!checked)}
    >
      <span>{label}</span>
      <Icon className={cn("size-5", checked ? "text-primary" : "text-muted-foreground")} />
    </button>
  );
}

function SendBehaviorControls({
  sessionMode,
  deliveryMode,
  onSessionChange,
  onDeliveryChange,
}: {
  sessionMode: SessionMode;
  deliveryMode: DeliveryMode;
  onSessionChange: (mode: SessionMode) => void;
  onDeliveryChange: (mode: DeliveryMode) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(118px,1fr)_128px_112px] items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/45">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <Send className="size-3.5" />
        </span>
        <span className="truncate text-sm font-medium">All AI agents</span>
      </div>
      <select
        aria-label="Delivery behavior"
        value={deliveryMode}
        onChange={(event) => onDeliveryChange(event.target.value as DeliveryMode)}
        className="settings-select"
      >
        <option value="copyOnly">Copy</option>
        <option value="openPaste">Paste</option>
        <option value="openPasteSend">Send</option>
      </select>
      <select
        aria-label="Session behavior"
        value={sessionMode}
        onChange={(event) => onSessionChange(event.target.value as SessionMode)}
        className="settings-select"
      >
        <option value="lastSession">Last</option>
        <option value="newSession">New</option>
      </select>
    </div>
  );
}
