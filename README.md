# Kyu

Kyu is a free, open-source macOS menu bar utility for queueing prompts when an AI tool is out of credits, busy, or in the wrong session. Save prompts quickly, then release them later to the AI tool you want.

![Kyu prompt bar](docs/screenshot-prompt.jpg)

## What It Does

- Capture prompts from a Spotlight-style prompt bar.
- Store prompts locally in a queue.
- Release one prompt or the entire queue.
- Export to Clipboard, Claude, Gemini, Cursor, or Codex.
- Show only installed AI tools in the release picker.
- Choose whether each AI tool should use the last session or start a new session.
- Run from the macOS menu bar.
- Configure the global keyboard shortcut.
- Optionally start at login.

## Status

Kyu is an early Tauri app prototype. The web UI is fully previewable today; native macOS packaging requires Rust/Cargo.

## Install From Source

### Requirements

- macOS
- Node.js 20+
- npm
- Xcode Command Line Tools
- Rust and Cargo

Install Rust with rustup:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Restart your terminal after installing Rust.

### Setup

```bash
git clone https://github.com/your-org/kyu.git
cd kyu
npm install
```

### Run The Web Preview

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:1420/
```

### Run The Tauri App

```bash
npm run tauri -- dev
```

### Build A Local macOS App

```bash
npm run tauri -- build
```

Build output is created under:

```text
src-tauri/target/release/bundle/
```

Because Kyu is not distributed through the App Store, macOS may require you to approve the app in System Settings the first time you open a local build.

## Development

Install dependencies:

```bash
npm install
```

Run type checking and build the frontend:

```bash
npm run build
```

Run the Tauri shell:

```bash
npm run tauri -- dev
```

## Tech Stack

- Tauri 2
- React
- Vite
- TypeScript
- Tailwind CSS
- Shadcn-style local components

## License

Kyu is free and open source under the [MIT License](LICENSE).
