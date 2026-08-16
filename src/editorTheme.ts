/**
 * Maps the reader's syntax-highlight themes onto CodeMirror.
 *
 * The five source themes are already defined as CSS variables and already
 * colour the preview's fenced blocks. Reading those variables at editor-build
 * time means the editor joins the same scheme instead of introducing a sixth
 * palette that agrees with none of the others.
 */

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

function readVariable(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();

  return value || fallback;
}

export function buildEditorTheme(): Extension {
  const background = readVariable("--source-bg", "#ffffff");
  const foreground = readVariable("--source-fg", "#24292f");
  const comment = readVariable("--source-comment", "#6e7781");
  const keyword = readVariable("--source-keyword", "#cf222e");
  const string = readVariable("--source-string", "#0a3069");
  const number = readVariable("--source-number", "#953800");
  const title = readVariable("--source-title", "#8250df");
  const attribute = readVariable("--source-attr", "#116329");
  const bullet = readVariable("--source-bullet", "#57606a");
  const accent = readVariable("--accent", "#2f6f83");
  const selection = readVariable("--selection", "rgba(47, 111, 131, 0.16)");

  const view = EditorView.theme(
    {
      "&": {
        color: foreground,
        backgroundColor: background,
        height: "100%",
      },
      ".cm-content": {
        fontFamily: "var(--mono-font)",
        fontSize: "calc(0.86rem * var(--reader-zoom))",
        lineHeight: "1.62",
        padding: "28px 0 72px",
        caretColor: accent,
      },
      ".cm-gutters": {
        color: comment,
        backgroundColor: background,
        border: "none",
        fontSize: "calc(0.78rem * var(--reader-zoom))",
      },
      ".cm-activeLine": { backgroundColor: selection },
      ".cm-activeLineGutter": { backgroundColor: "transparent", color: accent },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
        { backgroundColor: selection },
      "&.cm-focused": { outline: "none" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: accent },
      // The search panel is part of the editor, so it takes the editor's colours
      // rather than CodeMirror's defaults, which match no theme here.
      ".cm-panels": {
        color: foreground,
        backgroundColor: background,
        borderBottom: `1px solid ${comment}`,
      },
      ".cm-panel.cm-search": { padding: "8px 10px", fontFamily: "var(--mono-font)" },
      ".cm-panel.cm-search input, .cm-panel.cm-search button": {
        color: foreground,
        backgroundColor: background,
        border: `1px solid ${comment}`,
        borderRadius: "5px",
        padding: "3px 7px",
        font: "inherit",
      },
      ".cm-panel.cm-search label": { color: comment },
      ".cm-searchMatch": { backgroundColor: selection, borderRadius: "3px" },
      ".cm-searchMatch-selected": {
        backgroundColor: accent,
        color: background,
      },
    },
    // Whether the theme is dark decides CodeMirror's own built-in contrasts.
    { dark: isDark(background) },
  );

  const highlight = HighlightStyle.define([
    { tag: tags.comment, color: comment },
    { tag: tags.keyword, color: keyword },
    { tag: [tags.string, tags.character], color: string },
    { tag: [tags.number, tags.bool, tags.null], color: number },
    { tag: [tags.heading, tags.strong], color: title, fontWeight: "700" },
    { tag: tags.emphasis, color: title, fontStyle: "italic" },
    { tag: [tags.link, tags.url], color: attribute, textDecoration: "underline" },
    { tag: [tags.list, tags.quote], color: bullet },
    { tag: tags.monospace, color: attribute },
    { tag: tags.strikethrough, textDecoration: "line-through" },
  ]);

  return [view, syntaxHighlighting(highlight)];
}

/** Rough relative luminance, enough to pick a light or dark editor base. */
function isDark(color: string): boolean {
  const match = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!match) {
    return false;
  }

  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;

  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}
