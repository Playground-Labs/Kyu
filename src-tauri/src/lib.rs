use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{
    PhysicalPosition,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime, State, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueuedPrompt {
    id: String,
    body: String,
    created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Store {
    #[serde(default)]
    prompts: Vec<QueuedPrompt>,
    #[serde(default = "default_shortcut")]
    shortcut: String,
    #[serde(default)]
    agent: AgentTarget,
    #[serde(default = "default_true")]
    show_menu_bar: bool,
    #[serde(default)]
    start_at_login: bool,
    #[serde(default)]
    session_mode: SessionMode,
    #[serde(default)]
    delivery_mode: DeliveryMode,
    #[serde(default)]
    window_position: Option<SavedWindowPosition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum AgentTarget {
    Chatgpt,
    Claude,
    Gemini,
    Cursor,
    Codex,
    Clipboard,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SessionMode {
    LastSession,
    NewSession,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
enum DeliveryMode {
    CopyOnly,
    OpenPaste,
    OpenPasteSend,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseResult {
    bundle: String,
    delivery: DeliveryMode,
    opened: bool,
    submitted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedWindowPosition {
    x: i32,
    y: i32,
}

impl Default for SessionMode {
    fn default() -> Self {
        Self::LastSession
    }
}

impl Default for DeliveryMode {
    fn default() -> Self {
        Self::CopyOnly
    }
}

impl Default for AgentTarget {
    fn default() -> Self {
        Self::Clipboard
    }
}

impl Default for Store {
    fn default() -> Self {
        Self {
            prompts: Vec::new(),
            shortcut: default_shortcut(),
            agent: AgentTarget::Clipboard,
            show_menu_bar: true,
            start_at_login: false,
            session_mode: SessionMode::LastSession,
            delivery_mode: DeliveryMode::CopyOnly,
            window_position: None,
        }
    }
}

fn default_shortcut() -> String {
    "CommandOrControl+Space".to_string()
}

fn default_true() -> bool {
    true
}

#[derive(Clone)]
struct StoreState {
    path: PathBuf,
    inner: Arc<Mutex<Store>>,
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("queue.json"))
}

fn read_store(path: &PathBuf) -> Store {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_store(state: &StoreState, store: &Store) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(store).map_err(|error| error.to_string())?;
    fs::write(&state.path, raw).map_err(|error| error.to_string())
}

#[tauri::command]
fn load_store(state: State<StoreState>) -> Store {
    state.inner.lock().expect("store lock poisoned").clone()
}

#[tauri::command]
fn save_prompt(body: String, state: State<StoreState>) -> Result<Vec<QueuedPrompt>, String> {
    let mut store = state.inner.lock().expect("store lock poisoned");
    store.prompts.insert(
        0,
        QueuedPrompt {
            id: Uuid::new_v4().to_string(),
            body,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
    );
    write_store(&state, &store)?;
    Ok(store.prompts.clone())
}

#[tauri::command]
fn delete_prompt(id: String, state: State<StoreState>) -> Result<Vec<QueuedPrompt>, String> {
    let mut store = state.inner.lock().expect("store lock poisoned");
    store.prompts.retain(|prompt| prompt.id != id);
    write_store(&state, &store)?;
    Ok(store.prompts.clone())
}

#[tauri::command]
fn release_prompts(ids: Vec<String>, agent: AgentTarget, state: State<StoreState>) -> Result<ReleaseResult, String> {
    let (selected, delivery, session_mode) = {
        let store = state.inner.lock().expect("store lock poisoned");
        let selected: Vec<QueuedPrompt> = if ids.is_empty() {
            store.prompts.clone()
        } else {
            store
                .prompts
                .iter()
                .filter(|prompt| ids.contains(&prompt.id))
                .cloned()
                .collect()
        };

        (
            selected,
            if matches!(agent, AgentTarget::Clipboard) {
                DeliveryMode::CopyOnly
            } else {
                store.delivery_mode.clone()
            },
            if matches!(agent, AgentTarget::Clipboard) {
                SessionMode::LastSession
            } else {
                store.session_mode.clone()
            },
        )
    };

    let bundle = selected
        .iter()
        .enumerate()
        .map(|(index, prompt)| format!("Prompt {} for {}\n\n{}", index + 1, agent_label(&agent), prompt.body.trim()))
        .collect::<Vec<String>>()
        .join("\n\n---\n\n");

    let selected_ids = selected
        .iter()
        .map(|prompt| prompt.id.clone())
        .collect::<Vec<String>>();
    let opened = delivery != DeliveryMode::CopyOnly && !matches!(agent, AgentTarget::Clipboard);
    let submitted = delivery == DeliveryMode::OpenPasteSend && opened;

    copy_to_clipboard(&bundle)?;

    if opened {
        open_and_paste(&agent, &session_mode, submitted)?;
    }

    {
        let mut store = state.inner.lock().expect("store lock poisoned");
        store.prompts.retain(|prompt| !selected_ids.contains(&prompt.id));
        store.agent = agent;
        write_store(&state, &store)?;
    }

    Ok(ReleaseResult {
        bundle,
        delivery,
        opened,
        submitted,
    })
}

#[tauri::command]
fn set_shortcut<R: Runtime>(shortcut: String, app: AppHandle<R>, state: State<StoreState>) -> Result<String, String> {
    let parsed = parse_shortcut(&shortcut)?;
    app.global_shortcut().unregister_all().map_err(|error| error.to_string())?;
    register_shortcut(&app, parsed)?;

    let mut store = state.inner.lock().expect("store lock poisoned");
    store.shortcut = shortcut.clone();
    write_store(&state, &store)?;
    Ok(shortcut)
}

#[tauri::command]
fn set_agent(agent: AgentTarget, state: State<StoreState>) -> Result<AgentTarget, String> {
    let mut store = state.inner.lock().expect("store lock poisoned");
    store.agent = agent.clone();
    write_store(&state, &store)?;
    Ok(agent)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum PreferenceKey {
    ShowMenuBar,
    StartAtLogin,
}

#[tauri::command]
fn set_preference<R: Runtime>(
    key: PreferenceKey,
    value: bool,
    app: AppHandle<R>,
    state: State<StoreState>,
) -> Result<Store, String> {
    let mut store = state.inner.lock().expect("store lock poisoned");

    match key {
        PreferenceKey::ShowMenuBar => {
            store.show_menu_bar = value;
            if let Some(tray) = app.tray_by_id("main") {
                tray.set_visible(value).map_err(|error| error.to_string())?;
            }
        }
        PreferenceKey::StartAtLogin => {
            if value {
                app.autolaunch().enable().map_err(|error| error.to_string())?;
            } else {
                app.autolaunch().disable().map_err(|error| error.to_string())?;
            }
            store.start_at_login = value;
        }
    }

    write_store(&state, &store)?;
    Ok(store.clone())
}

#[tauri::command]
fn set_session_mode(
    mode: SessionMode,
    state: State<StoreState>,
) -> Result<Store, String> {
    let mut store = state.inner.lock().expect("store lock poisoned");
    store.session_mode = mode;
    write_store(&state, &store)?;
    Ok(store.clone())
}

#[tauri::command]
fn set_delivery_mode(
    mode: DeliveryMode,
    state: State<StoreState>,
) -> Result<Store, String> {
    let mut store = state.inner.lock().expect("store lock poisoned");
    store.delivery_mode = mode;
    write_store(&state, &store)?;
    Ok(store.clone())
}

#[tauri::command]
fn installed_targets() -> Vec<AgentTarget> {
    let targets = [
        AgentTarget::Clipboard,
        AgentTarget::Claude,
        AgentTarget::Gemini,
        AgentTarget::Cursor,
        AgentTarget::Codex,
    ];

    targets
        .into_iter()
        .filter(|target| target_available(target))
        .collect()
}

#[tauri::command]
fn start_native_drag<R: Runtime>(window: tauri::WebviewWindow<R>) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
fn move_window_to<R: Runtime>(x: i32, y: i32, window: tauri::WebviewWindow<R>, state: State<StoreState>) -> Result<(), String> {
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    remember_webview_window_position(&window, &state);
    Ok(())
}

#[tauri::command]
fn resize_window_to<R: Runtime>(width: f64, height: f64, window: tauri::WebviewWindow<R>) -> Result<(), String> {
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn window_position<R: Runtime>(window: tauri::WebviewWindow<R>) -> Result<(i32, i32), String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    Ok((position.x, position.y))
}

fn target_available(target: &AgentTarget) -> bool {
    match target {
        AgentTarget::Clipboard => true,
        AgentTarget::Claude => app_exists(&["Claude.app"]),
        AgentTarget::Gemini => app_exists(&["Gemini.app", "Google Gemini.app"]),
        AgentTarget::Cursor => app_exists(&["Cursor.app"]),
        AgentTarget::Codex => app_exists(&["Codex.app", "OpenAI Codex.app"]),
        AgentTarget::Chatgpt => app_exists(&["ChatGPT.app"]),
    }
}

fn app_exists(app_names: &[&str]) -> bool {
    let mut roots = vec![PathBuf::from("/Applications"), PathBuf::from("/System/Applications")];

    if let Ok(home) = std::env::var("HOME") {
        roots.push(PathBuf::from(home).join("Applications"));
    }

    roots
        .iter()
        .any(|root| app_names.iter().any(|name| root.join(name).exists()))
}

fn agent_label(agent: &AgentTarget) -> &'static str {
    match agent {
        AgentTarget::Chatgpt => "ChatGPT",
        AgentTarget::Claude => "Claude",
        AgentTarget::Gemini => "Gemini",
        AgentTarget::Cursor => "Cursor",
        AgentTarget::Codex => "Codex",
        AgentTarget::Clipboard => "Clipboard",
    }
}

fn copy_to_clipboard(value: &str) -> Result<(), String> {
    let mut child = Command::new("pbcopy")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Unable to copy prompt: {error}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(value.as_bytes())
            .map_err(|error| format!("Unable to write prompt to clipboard: {error}"))?;
    }

    let status = child
        .wait()
        .map_err(|error| format!("Unable to finish copying prompt: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("Unable to copy prompt to clipboard".to_string())
    }
}

#[cfg(target_os = "macos")]
fn open_and_paste(agent: &AgentTarget, session_mode: &SessionMode, submit: bool) -> Result<(), String> {
    let app_name = app_name(agent)?;
    Command::new("open")
        .args(["-a", app_name])
        .status()
        .map_err(|error| format!("Unable to open {app_name}: {error}"))?;

    thread::sleep(Duration::from_millis(450));

    let mut script = String::from("tell application \"System Events\"\n");
    if matches!(session_mode, SessionMode::NewSession) {
        script.push_str("keystroke \"n\" using command down\n");
        script.push_str("delay 0.2\n");
    }
    script.push_str("keystroke \"v\" using command down\n");
    if submit {
        script.push_str("delay 0.12\nkey code 36\n");
    }
    script.push_str("end tell");

    let status = Command::new("osascript")
        .args(["-e", &script])
        .status()
        .map_err(|error| format!("Unable to paste into {app_name}: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "Kyu needs macOS Accessibility permission to paste into {app_name}"
        ))
    }
}

#[cfg(not(target_os = "macos"))]
fn open_and_paste(_agent: &AgentTarget, _session_mode: &SessionMode, _submit: bool) -> Result<(), String> {
    Ok(())
}

fn app_name(agent: &AgentTarget) -> Result<&'static str, String> {
    match agent {
        AgentTarget::Claude => Ok("Claude"),
        AgentTarget::Gemini => Ok("Gemini"),
        AgentTarget::Cursor => Ok("Cursor"),
        AgentTarget::Codex => Ok("Codex"),
        AgentTarget::Chatgpt => Ok("ChatGPT"),
        AgentTarget::Clipboard => Err("Clipboard does not have an app target".to_string()),
    }
}

fn parse_shortcut(value: &str) -> Result<Shortcut, String> {
    let mut modifiers = Modifiers::empty();
    let mut code: Option<Code> = None;

    for part in value.split('+').map(|part| part.trim().to_lowercase()) {
        match part.as_str() {
            "cmd" | "command" | "commandorcontrol" | "mod" => modifiers |= Modifiers::SUPER,
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "alt" | "option" => modifiers |= Modifiers::ALT,
            "shift" => modifiers |= Modifiers::SHIFT,
            "space" => code = Some(Code::Space),
            "enter" | "return" => code = Some(Code::Enter),
            letter if letter.len() == 1 => {
                let upper = letter.to_uppercase();
                code = Some(match upper.as_str() {
                    "A" => Code::KeyA,
                    "B" => Code::KeyB,
                    "C" => Code::KeyC,
                    "D" => Code::KeyD,
                    "E" => Code::KeyE,
                    "F" => Code::KeyF,
                    "G" => Code::KeyG,
                    "H" => Code::KeyH,
                    "I" => Code::KeyI,
                    "J" => Code::KeyJ,
                    "K" => Code::KeyK,
                    "L" => Code::KeyL,
                    "M" => Code::KeyM,
                    "N" => Code::KeyN,
                    "O" => Code::KeyO,
                    "P" => Code::KeyP,
                    "Q" => Code::KeyQ,
                    "R" => Code::KeyR,
                    "S" => Code::KeyS,
                    "T" => Code::KeyT,
                    "U" => Code::KeyU,
                    "V" => Code::KeyV,
                    "W" => Code::KeyW,
                    "X" => Code::KeyX,
                    "Y" => Code::KeyY,
                    "Z" => Code::KeyZ,
                    _ => return Err(format!("Unsupported shortcut key: {letter}")),
                });
            }
            unknown => return Err(format!("Unsupported shortcut part: {unknown}")),
        }
    }

    code.map(|key| Shortcut::new(Some(modifiers), key))
        .ok_or_else(|| "Shortcut needs a final key, such as Space or K".to_string())
}

fn register_shortcut<R: Runtime>(app: &AppHandle<R>, shortcut: Shortcut) -> Result<(), String> {
    let handle = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = show_prompt_window(&handle);
            }
        })
        .map_err(|error| error.to_string())
}

fn show_prompt_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or_else(|| "Main window missing".to_string())?;
    position_prompt_window(app, &window)?;
    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    let _ = window.emit("kyu-focus", ());
    Ok(())
}

fn position_prompt_window<R: Runtime>(app: &AppHandle<R>, window: &tauri::WebviewWindow<R>) -> Result<(), String> {
    let window_size = window.outer_size().map_err(|error| error.to_string())?;
    let monitor = active_monitor(app)?
        .ok_or_else(|| "No active display found".to_string())?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();

    let saved_position = app
        .try_state::<StoreState>()
        .and_then(|state| state.inner.lock().ok().and_then(|store| store.window_position.clone()));

    let (x, y) = if let Some(position) = saved_position {
        if position_on_monitor(&position, monitor_position, monitor_size) {
            let max_x = monitor_position.x + monitor_size.width as i32 - window_size.width as i32;
            let max_y = monitor_position.y + monitor_size.height as i32 - window_size.height as i32;
            (position.x.clamp(monitor_position.x, max_x), position.y.clamp(monitor_position.y, max_y))
        } else {
            centered_position(monitor_position, monitor_size, window_size)
        }
    } else {
        centered_position(monitor_position, monitor_size, window_size)
    };

    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())
}

fn active_monitor<R: Runtime>(app: &AppHandle<R>) -> Result<Option<tauri::Monitor>, String> {
    if let Some((x, y, width, height)) = frontmost_window_bounds() {
        let center_x = x + (width / 2);
        let center_y = y + (height / 2);
        if let Some(monitor) = app
            .monitor_from_point(center_x as f64, center_y as f64)
            .map_err(|error| error.to_string())?
        {
            return Ok(Some(monitor));
        }
    }

    if let Some(monitor) = app
        .cursor_position()
        .ok()
        .and_then(|cursor| app.monitor_from_point(cursor.x, cursor.y).ok().flatten())
    {
        return Ok(Some(monitor));
    }

    app.primary_monitor().map_err(|error| error.to_string())
}

fn centered_position(
    monitor_position: &PhysicalPosition<i32>,
    monitor_size: &tauri::PhysicalSize<u32>,
    window_size: tauri::PhysicalSize<u32>,
) -> (i32, i32) {
    (
        monitor_position.x + ((monitor_size.width as i32 - window_size.width as i32) / 2),
        monitor_position.y + ((monitor_size.height as i32 - window_size.height as i32) / 2),
    )
}

fn position_on_monitor(
    position: &SavedWindowPosition,
    monitor_position: &PhysicalPosition<i32>,
    monitor_size: &tauri::PhysicalSize<u32>,
) -> bool {
    position.x >= monitor_position.x
        && position.x < monitor_position.x + monitor_size.width as i32
        && position.y >= monitor_position.y
        && position.y < monitor_position.y + monitor_size.height as i32
}

fn remember_webview_window_position<R: Runtime>(window: &tauri::WebviewWindow<R>, state: &StoreState) {
    let Ok(position) = window.outer_position() else {
        return;
    };
    remember_position(position, state);
}

fn remember_window_position<R: Runtime>(window: &tauri::Window<R>, state: &StoreState) {
    let Ok(position) = window.outer_position() else {
        return;
    };
    remember_position(position, state);
}

fn remember_position(position: PhysicalPosition<i32>, state: &StoreState) {
    let mut store = state.inner.lock().expect("store lock poisoned");
    store.window_position = Some(SavedWindowPosition {
        x: position.x,
        y: position.y,
    });
    let _ = write_store(state, &store);
}

fn frontmost_window_bounds() -> Option<(i32, i32, i32, i32)> {
    let script = r#"
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  if (name of frontApp) is "Kyu" then return ""
  if (count of windows of frontApp) is 0 then return ""
  set frontWindow to window 1 of frontApp
  set windowPosition to position of frontWindow
  set windowSize to size of frontWindow
  return ((item 1 of windowPosition) as text) & "," & ((item 2 of windowPosition) as text) & "," & ((item 1 of windowSize) as text) & "," & ((item 2 of windowSize) as text)
end tell
"#;

    let output = Command::new("osascript").args(["-e", script]).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let raw = String::from_utf8(output.stdout).ok()?;
    let values = raw
        .trim()
        .split(',')
        .map(|part| part.trim().parse::<i32>())
        .collect::<Result<Vec<i32>, _>>()
        .ok()?;

    match values.as_slice() {
        [x, y, width, height] if *width > 0 && *height > 0 => Some((*x, *y, *width, *height)),
        _ => None,
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let path = store_path(app.handle())?;
            let mut store = read_store(&path);
            store.start_at_login = app.autolaunch().is_enabled().unwrap_or(store.start_at_login);
            let shortcut = parse_shortcut(&store.shortcut).unwrap_or_else(|_| Shortcut::new(Some(Modifiers::SUPER), Code::Space));
            app.manage(StoreState {
                path,
                inner: Arc::new(Mutex::new(store)),
            });
            register_shortcut(app.handle(), shortcut)?;

            let show = MenuItem::with_id(app, "show", "Show Kyu", true, None::<&str>)?;
            let release = MenuItem::with_id(app, "release", "Release All", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &release, &quit])?;

            let mut tray = TrayIconBuilder::with_id("main").menu(&menu).show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "show" => {
                    let _ = show_prompt_window(app);
                }
                "release" => {
                    let _ = show_prompt_window(app);
                    let _ = app.emit("kyu-release-all", ());
                }
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    let _ = show_prompt_window(&tray.app_handle());
                }
            })
            .build(app)?;

            if let Some(state) = app.try_state::<StoreState>() {
                let store = state.inner.lock().expect("store lock poisoned");
                if !store.show_menu_bar {
                    if let Some(tray) = app.tray_by_id("main") {
                        let _ = tray.set_visible(false);
                    }
                }
            }

            if std::env::var("KYU_SHOW_ON_LAUNCH").as_deref() == Ok("1") {
                let _ = show_prompt_window(app.handle());
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    if let Some(state) = window.app_handle().try_state::<StoreState>() {
                        remember_window_position(window, &state);
                    }
                    let _ = window.hide();
                }
                WindowEvent::Focused(false) => {
                    if let Some(state) = window.app_handle().try_state::<StoreState>() {
                        remember_window_position(window, &state);
                    }
                    let _ = window.hide();
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_store,
            save_prompt,
            delete_prompt,
            release_prompts,
            set_shortcut,
            set_agent,
            set_preference,
            set_session_mode,
            set_delivery_mode,
            start_native_drag,
            move_window_to,
            resize_window_to,
            window_position,
            installed_targets
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kyu");
}
