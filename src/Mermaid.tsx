import { useEffect, useRef, useState } from "react";

/**
 * Renders one Mermaid diagram.
 *
 * Mermaid is imported lazily: it is by far the largest dependency here, and
 * most documents contain no diagrams at all, so loading it up front would cost
 * every reader for the benefit of a few.
 *
 * A diagram that fails to parse falls back to its source rather than to a blank
 * space — a reader who cannot see the picture should at least be able to read
 * the text, and the error tells them the file is at fault rather than the app.
 */

type MermaidProps = {
  code: string;
  /** Diagrams are drawn in the reader's current light or dark theme. */
  theme: "light" | "dark";
};

let diagramCount = 0;

export function Mermaid({ code, theme }: MermaidProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const draw = async () => {
      try {
        const mermaid = (await import("mermaid")).default;

        // `useMaxWidth` defaults on, which squeezes a diagram into the width of
        // its container. A large flowchart then arrives unreadable, its labels
        // shrunk to nothing. Off, each diagram is drawn at its own size and the
        // figure scrolls sideways instead — detail survives, and scrolling is
        // recoverable in a way lost detail is not.
        const noStretch = { useMaxWidth: false };

        mermaid.initialize({
          startOnLoad: false,
          theme: theme === "dark" ? "dark" : "default",
          securityLevel: "strict",
          flowchart: noStretch,
          sequence: noStretch,
          state: noStretch,
          class: noStretch,
          er: noStretch,
          journey: noStretch,
          gantt: noStretch,
          pie: noStretch,
          gitGraph: noStretch,
          // No `fontFamily: "inherit"` here. Mermaid sizes each node by
          // measuring its label, and it can only measure a real font — given
          // `inherit` it measures in its default face while the SVG renders in
          // whatever the page cascade supplies, so every label overflows the
          // box drawn for it. The paired rule in App.css keeps the reading
          // area's font size from leaking in for the same reason.
          fontSize: 16,
        });

        diagramCount += 1;
        const { svg } = await mermaid.render(`mdview-diagram-${diagramCount}`, code);

        if (!cancelled) {
          container.innerHTML = svg;
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          container.innerHTML = "";
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    };

    void draw();

    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  return (
    <div className="mermaid-figure">
      <div ref={containerRef} className="mermaid-canvas" />
      {error ? (
        <div className="mermaid-error" role="alert">
          <p>Diagram could not be drawn: {error}</p>
          <pre>
            <code>{code}</code>
          </pre>
        </div>
      ) : null}
    </div>
  );
}
