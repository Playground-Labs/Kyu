import { ChangeEvent, FormEvent, KeyboardEvent, PointerEvent, ReactNode, RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Check,
  Clipboard,
  CornerDownLeft,
  Keyboard,
  ListPlus,
  ListTodo,
  Settings2,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  QueuedPrompt,
  deletePrompt,
  loadStore,
  releasePrompts,
  resumeShortcut,
  savePrompt,
  setPreference,
  setShortcut,
  suspendShortcut,
} from "@/lib/prompts";
import { tokenizeParts } from "@/lib/highlight";
import { formatCreatedAt, prettyShortcut } from "@/lib/format";
import { shortcutFromKey } from "@/lib/shortcut";

type StatusMessage = {
  id: number;
  text: string;
};

export function App() {
  const isNative = "__TAURI_INTERNALS__" in window;
  const [prompt, setPrompt] = useState("");
  const [queue, setQueue] = useState<QueuedPrompt[]>([]);
  const [shortcut, setShortcutValue] = useState("CommandOrControl+Shift+Space");
  const [shortcutDraft, setShortcutDraft] = useState("CommandOrControl+Shift+Space");
  const [showMenuBar, setShowMenuBar] = useState(true);
  const [startAtLogin, setStartAtLogin] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Native window is created hidden and fades in via kyu-focus; start closed so
  // the first show() never paints an opaque frame before the blur lands (flicker).
  const [windowVisible, setWindowVisible] = useState(!isNative);
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
  const animateTimerRef = useRef<number | null>(null);

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
    });
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!isNative || !shellRef.current) return;

    const shell = shellRef.current;

    const resizeToShell = () => {
      // offset* is the layout box and ignores the entrance transform (scale);
      // getBoundingClientRect returns the scaled box, which feeds back through
      // ResizeObserver + w-full and spirals the window down to a sliver.
      void invoke("resize_window_to", {
        width: shell.offsetWidth,
        height: shell.offsetHeight,
      }).catch(() => undefined);
    };

    resizeToShell();
    const observer = new ResizeObserver(resizeToShell);
    observer.observe(shell);

    return () => observer.disconnect();
  }, [isNative, showQueue, showSettings, queue.length]);

  useEffect(() => {
    if (!isNative) return;

    const animateOpen = () => {
      if (animateTimerRef.current !== null) return;
      // Content rests closed whenever the window is hidden, so a single flip to
      // visible triggers the entrance fade. Toggling it off-then-on here would
      // blink an already-painted frame out and back in.
      animateTimerRef.current = window.setTimeout(() => {
        animateTimerRef.current = null;
        inputRef.current?.focus();
        setWindowVisible(true);
      }, 90);
    };
    const animateClose = () => setWindowVisible(false);
    window.addEventListener("kyu-native-focus", animateOpen);
    window.addEventListener("kyu-native-blur", animateClose);

    const unlisteners = Promise.all([
      listen("kyu-focus", animateOpen),
      listen("kyu-blur", animateClose),
      listen("kyu-release-all", () => {
        void release([]);
      }),
    ]);

    return () => {
      window.removeEventListener("kyu-native-focus", animateOpen);
      window.removeEventListener("kyu-native-blur", animateClose);
      void unlisteners.then((callbacks) => callbacks.forEach((unlisten) => unlisten()));
    };
  }, [isNative, queue]);

  const queueSummary = useMemo(() => {
    if (queue.length === 0) return "Queue empty";
    if (queue.length === 1) return "1 prompt waiting";
    return `${queue.length} prompts waiting`;
  }, [queue.length]);

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
  }

  async function release(ids: string[]) {
    const releasedCount = ids.length || queue.length;
    if (!releasedCount) return;

    await releasePrompts(ids);
    setQueue((current) => (ids.length ? current.filter((item) => !ids.includes(item.id)) : []));
    showStatus(`${releasedCount} prompt${releasedCount === 1 ? "" : "s"} released`);
    inputRef.current?.focus();
  }

  async function remove(id: string) {
    const prompts = await deletePrompt(id);
    setQueue(prompts);
    showStatus("Removed");
    inputRef.current?.focus();
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

  async function startWindowDrag(event: PointerEvent<HTMLElement>) {
    if (!isNative || event.button !== 0) return;

    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, a, [role='button'], [data-no-window-drag]")) return;

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
        className={cn(
          "prompt-window-shell spotlight-shell w-full max-w-3xl overflow-hidden rounded-[28px]",
          windowVisible ? "prompt-window-shell-open" : "prompt-window-shell-closed",
        )}
        onPointerDown={startWindowDrag}
        onPointerMove={moveWindow}
        onPointerUp={stopWindowDrag}
        onPointerCancel={stopWindowDrag}
      >
        <form onSubmit={handleSubmit} className="flex items-center gap-3 px-4 py-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <ListPlus className="size-4" aria-hidden="true" />
          </div>
          <HighlightInput
            inputRef={inputRef}
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
              <ShortcutRecorder value={shortcutDraft} onChange={setShortcutDraft} />
            </label>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>Current shortcut: {prettyShortcut(shortcut)}</span>
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
                onRelease={() => release([])}
              />
            </div>
            <div className="max-h-[380px] overflow-y-auto overscroll-contain px-2 pb-3">
              {queue.length ? (
                <div className="grid gap-1">
                  {queue.map((item) => (
                    <article key={item.id} className="queue-row grid grid-cols-[1fr_auto] gap-3">
                      <button type="button" className="min-w-0 text-left" onClick={() => setPrompt(item.body)}>
                        <p className="truncate text-sm font-medium">{item.body}</p>
                        <time className="text-xs text-muted-foreground">{formatCreatedAt(item.createdAt)}</time>
                      </button>
                      <div className="flex items-center gap-1">
                        <ReleaseControl
                          compact
                          onRelease={() => release([item.id])}
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
            </div>
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
  onRelease,
}: {
  compact?: boolean;
  disabled?: boolean;
  onRelease: () => void;
}) {
  return (
    <Button
      type="button"
      disabled={disabled}
      variant={compact ? "ghost" : "default"}
      size={compact ? "icon" : "default"}
      title="Release to clipboard"
      className="release-main-button origin-center"
      onClick={onRelease}
    >
      <Clipboard />
      {compact ? null : "Release all"}
    </Button>
  );
}

function HighlightInput({
  inputRef,
  value,
  onChange,
  onKeyDown,
  placeholder,
  "aria-label": ariaLabel,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  "aria-label": string;
}) {
  const backdropInnerRef = useRef<HTMLDivElement>(null);

  function syncScroll() {
    if (!inputRef.current || !backdropInnerRef.current) return;
    backdropInnerRef.current.style.marginLeft = `-${inputRef.current.scrollLeft}px`;
  }

  return (
    <div className="relative flex-1 min-w-0 flex items-center">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center overflow-hidden">
        <div ref={backdropInnerRef} className="whitespace-pre text-[1.35rem] leading-none">
          {tokenizeParts(value).map((part, i) => (
            <span key={i} className={TOKEN_CLASS[part.kind]}>{part.text}</span>
          ))}
        </div>
      </div>
      <Input
        ref={inputRef as RefObject<HTMLInputElement>}
        aria-label={ariaLabel}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onScroll={syncScroll}
        placeholder={placeholder}
        className="h-14 w-full truncate border-0 bg-transparent px-0 text-[1.35rem] leading-none shadow-none placeholder:text-slate-400 focus-visible:ring-0"
        style={{ color: "transparent", caretColor: "hsl(225 13% 12%)" }}
      />
    </div>
  );
}

const TOKEN_CLASS: Record<string, string> = {
  plain: "",
  skill: "text-[hsl(205_88%_46%)]",
  context: "text-purple-500",
};

function ShortcutRecorder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // macOS doesn't focus <button> on click, so we can't rely on the element's
  // own keydown. Capture on window while recording and drop the global hotkey
  // so its combo reaches us instead of being swallowed by the OS.
  useEffect(() => {
    if (!recording) return;
    suspendShortcut().catch(() => undefined);

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      event.preventDefault();
      if (event.code === "Escape") {
        setRecording(false);
        return;
      }
      const result = shortcutFromKey(event);
      if (result === null) return;        // lone modifier; wait for the real key
      if ("hint" in result) {
        setHint(result.hint);
        return;
      }
      onChange(result.combo);
      setRecording(false);
    };

    // Clicking anything other than the recorder cancels (so we never get stuck
    // swallowing every keystroke).
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (event.target !== buttonRef.current) setRecording(false);
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      setHint(null);
      resumeShortcut().catch(() => undefined);
    };
  }, [recording, onChange]);

  return (
    <button
      ref={buttonRef}
      type="button"
      data-no-window-drag
      onClick={() => setRecording((current) => !current)}
      className={cn(
        "flex h-10 w-full items-center rounded-md border bg-background px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        recording ? "border-ring text-muted-foreground" : "border-input",
      )}
    >
      {recording ? (hint ?? "Press shortcut…") : prettyShortcut(value)}
    </button>
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
