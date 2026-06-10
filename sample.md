# Marked 2 Lite Sample

This file exercises the MVP Markdown rendering path.

## Task List

- [x] Open a local Markdown document
- [x] Render GitHub Flavored Markdown
- [x] Show relative local images
- [ ] Add future niceties like file watching

## Table

| Feature | Shortcut | Status |
| --- | --- | --- |
| Open file | `Command+O` | Working |
| Reload | `Command+R` | Working |
| Preview mode | `Command+1` | Working |
| Split mode | `Command+2` | Working |
| Theme toggle | `Command+D` | Working |

## Fenced Code

```ts
type MarkdownFile = {
  path: string;
  name: string;
  dir: string;
  content: string;
};
```

## Relative Local Image

The image below is loaded from a path relative to this Markdown file.

![A simple Marked 2 Lite document thumbnail](sample-assets/mdview-sample.svg)

## Notes

Inline `code`, block quotes, and ordinary links render through the same preview.

> The default experience should be quiet, readable, and direct.
