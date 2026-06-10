# mdview

`mdview` is a lightweight macOS Markdown reader built with Tauri v2, React,
TypeScript, and Rust.

## Features

- Open `.md`, `.markdown`, `.mdown`, `.mkd`, and `.txt` files from the macOS File menu or with `Command+O`.
- Render GitHub Flavored Markdown with tables, task lists, and fenced code blocks.
- Resolve relative local images from the opened Markdown file's directory.
- Use preview-only mode by default, with optional source-only and split source/preview views.
- Switch Markdown reading themes and source-code highlight themes from the toolbar.
- Zoom the reading area without resizing the toolbar.
- Reload the current file from the macOS File menu or with `Command+R`.
- Toggle light/dark theme with `Command+D`.

## Shortcuts

- `Command+O`: File > Open...
- `Command+R`: File > Reload
- `Command+1`: preview only
- `Command+2`: split source/preview
- `Command+3`: source only
- `Command+=`: zoom in
- `Command+-`: zoom out
- `Command+0`: reset zoom
- `Command+T`: switch Markdown reading theme
- `Command+D`: toggle light/dark theme

## Develop

Install dependencies:

```sh
npm install
```

Run the Tauri app:

```sh
npm run tauri dev
```

Run the frontend build:

```sh
npm run build
```

Check the Rust side:

```sh
cd src-tauri
cargo check
```

Build the desktop app:

```sh
npm run tauri build
```

## Sample

Open `sample.md` in the app to verify tables, task lists, code blocks, and a
relative local image.
