use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{
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
    session_preferences: SessionPreferences,
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
struct SessionPreferences {
    #[serde(default)]
    claude: SessionMode,
    #[serde(default)]
    gemini: SessionMode,
    #[serde(default)]
    cursor: SessionMode,
    #[serde(default)]
    codex: SessionMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SessionMode {
    LastSession,
    NewSession,
}

impl Default for SessionMode {
    fn default() -> Self {
        Self::LastSession
    }
}

impl Default for SessionPreferences {
    fn default() -> Self {
        Self {
            claude: SessionMode::LastSession,
            gemini: SessionMode::LastSession,
            cursor: SessionMode::LastSession,
            codex: SessionMode::LastSession,
        }
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
            session_preferences: SessionPreferences::default(),
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
fn release_prompts(ids: Vec<String>, agent: AgentTarget, state: State<StoreState>) -> Result<String, String> {
    let mut store = state.inner.lock().expect("store lock poisoned");
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

    let bundle = selected
        .iter()
        .enumerate()
        .map(|(index, prompt)| format!("Prompt {} for {}\n\n{}", index + 1, agent_label(&agent), prompt.body.trim()))
        .collect::<Vec<String>>()
        .join("\n\n---\n\n");

    if ids.is_empty() {
        store.prompts.clear();
    } else {
        store.prompts.retain(|prompt| !ids.contains(&prompt.id));
    }
    store.agent = agent;
    write_store(&state, &store)?;
    Ok(bundle)
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
fn set_session_preference(
    target: AgentTarget,
    mode: SessionMode,
    state: State<StoreState>,
) -> Result<Store, String> {
    let mut store = state.inner.lock().expect("store lock poisoned");

    match target {
        AgentTarget::Claude => store.session_preferences.claude = mode,
        AgentTarget::Gemini => store.session_preferences.gemini = mode,
        AgentTarget::Cursor => store.session_preferences.cursor = mode,
        AgentTarget::Codex => store.session_preferences.codex = mode,
        AgentTarget::Clipboard | AgentTarget::Chatgpt => {
            return Err("Session preference is only available for AI app targets".to_string());
        }
    }

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
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    let _ = window.emit("kyu-focus", ());
    Ok(())
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

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
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
            set_session_preference,
            installed_targets
        ])
        .run(tauri::generate_context!())
        .expect("error while running Kyu");
}
