# Kyu

Kyu is a free, open-source macOS utility for queueing prompts when you run out of tokens or your agents are busy. Save prompts quickly with a keyboard shortcut, then release them.

![Kyu prompt bar](docs/screenshot-prompt.jpg)

## What It Does

- Capture prompts from a Spotlight-style prompt bar.
- Store prompts locally in a queue.
- Release one prompt or the entire queue.
- Configure a custom keyboard shortcut.
- Optionally start at login.

## Status

Kyu is currently an early prototype.

## Install

Install Kyu with Homebrew:

```bash
brew install --cask playground-labs/kyu/kyu
```

If macOS blocks the app the first time you open it, approve Kyu in System Settings because it is distributed outside the App Store.

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
git clone https://github.com/Playground-Labs/Kyu.git
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
