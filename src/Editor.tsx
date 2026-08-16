import { useEffect, useRef } from "react";

/**
 * The Markdown editor.
 *
 * CodeMirror is imported lazily, for the same reason Mermaid is: someone who
 * only reads never pays for it. The editor is built once and then kept in step
 * with props by dispatching transactions, rather than being torn down and
 * rebuilt — rebuilding would lose the cursor and the undo history on every
 * keystroke that travels up to React and back.
 */

type EditorProps = {
  value: string;
  onChange: (value: string) => void;
  /** Rebuilds the theme when the reader picks a different palette. */
  themeKey: string;
  /**
   * Incremented to open the search panel from outside — Command+F is handled by
   * the window, since it has to work whichever pane has focus.
   */
  searchRequest: number;
};

export function Editor({
  value,
  onChange,
  themeKey,
  searchRequest,
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<{
    state: { doc: { toString(): string } };
    dispatch: (transaction: unknown) => void;
    destroy: () => void;
  } | null>(null);
  // Read inside the CodeMirror callback, which is created once and would
  // otherwise capture the first render's handler forever.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;

    if (!host) {
      return;
    }

    const build = async () => {
      const [
        { EditorView, keymap, lineNumbers, highlightActiveLine },
        { EditorState },
        { markdown },
        { defaultKeymap, history, historyKeymap },
        { search, searchKeymap },
        { buildEditorTheme },
      ] = await Promise.all([
        import("@codemirror/view"),
        import("@codemirror/state"),
        import("@codemirror/lang-markdown"),
        import("@codemirror/commands"),
        import("@codemirror/search"),
        import("./editorTheme"),
      ]);

      if (cancelled) {
        return;
      }

      const view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: value,
          extensions: [
            lineNumbers(),
            highlightActiveLine(),
            history(),
            search({ top: true }),
            keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
            markdown(),
            EditorView.lineWrapping,
            buildEditorTheme(),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                onChangeRef.current(update.state.doc.toString());
              }
            }),
          ],
        }),
      });

      viewRef.current = view as never;
    };

    void build();

    return () => {
      cancelled = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // Rebuilt only when the palette changes; `value` is applied below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey]);

  useEffect(() => {
    if (searchRequest === 0) {
      return;
    }

    let cancelled = false;

    // The panel is opened through CodeMirror's own command so its state, its
    // keymap, and the highlighting of matches all stay consistent with what
    // Command+F inside the editor would have done.
    void import("@codemirror/search").then(({ openSearchPanel }) => {
      const view = viewRef.current;
      if (!cancelled && view) {
        openSearchPanel(view as never);
        (view as unknown as { focus(): void }).focus();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [searchRequest]);

  // Reaching here means the document changed outside the editor — a reload, or
  // a switch to another tab. Typing does not, because the text already matches.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) {
      return;
    }

    view.dispatch({
      changes: { from: 0, to: view.state.doc.toString().length, insert: value },
    });
  }, [value]);

  return <div ref={hostRef} className="editor-host" />;
}
