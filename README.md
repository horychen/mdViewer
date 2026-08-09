# mdViewer

A lightweight macOS Markdown reader built with Tauri v2, React, TypeScript, and
Rust. It opens a file and gets out of the way — no editing, no sync, no account.

## Features

### LaTeX math

Formulas render through [KaTeX](https://katex.org/), and **both delimiter styles
work**:

| Style | Inline | Display |
| --- | --- | --- |
| Dollar | `$E = mc^2$` | `$$ ... $$` |
| LaTeX-native | `\(E = mc^2\)` | `\[ ... \]` |

The second row matters in practice: notes exported from LaTeX documents and from
LLM chats overwhelmingly use `\(` and `\[`, which many Markdown readers show as
raw backslashes.

Details worth knowing:

- **KaTeX fonts ship inside the app.** Rendering is fully offline; no TeX
  installation is needed.
- **Prices stay prices.** `$100 and $200` is left as text rather than being
  swallowed into a formula, following the same rule Pandoc uses — real inline
  math never has whitespace hugging its delimiters.
- **Code is never touched.** `\(x\)` inside a fenced block or an inline code
  span renders verbatim, so documents *about* LaTeX still read correctly.
- **A broken formula stays local.** Malformed input shows up in red in place
  instead of taking the page down with it.
- **Wide formulas scroll** inside their own block rather than stretching the
  page.

Open `sample-math.md` to see all of the above at once.

### Reading

- Opens `.md`, `.markdown`, `.mdown`, `.mkd`, and `.txt`.
- GitHub Flavored Markdown: tables, task lists, fenced code blocks with syntax
  highlighting.
- Renders images, including relative paths resolved against the opened file's
  own directory.
- Tabs, with drag-and-drop to open files.
- Recent files, both in the empty-state list and under `File > Open Recent`.
  Entries that no longer resolve are dropped automatically.
- Preview-only by default; source-only and split source/preview also available.
- Switchable reading themes and syntax-highlight themes.
- Zoom the reading area without resizing the toolbar.
- Light/dark theme toggle.

## Shortcuts

| Key | Action |
| --- | --- |
| `Command+O` | Open a file |
| `Command+R` | Reload the current file |
| `Command+W` | Close the current tab |
| `Command+1` | Preview only |
| `Command+2` | Split source/preview |
| `Command+3` | Source only |
| `Command+=` | Zoom in |
| `Command+-` | Zoom out |
| `Command+0` | Reset zoom |
| `Command+T` | Cycle Markdown reading theme |
| `Command+D` | Toggle light/dark theme |

## Develop

Requires [Node.js](https://nodejs.org/), [Rust](https://www.rust-lang.org/), and
the Xcode command line tools.

```sh
npm install           # install dependencies
npm run tauri dev     # run the desktop app
npm run build         # build the frontend
npm run tauri build   # build the desktop app
```

Check the Rust side:

```sh
cd src-tauri && cargo check
```

## Samples

- `sample.md` — tables, task lists, code blocks, and a relative local image.
- `sample-math.md` — every math case above, including the ones that must *not*
  render as math.

## License

MIT
