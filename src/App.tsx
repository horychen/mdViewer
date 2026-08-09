import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Clock,
  Code2,
  Columns2,
  Eye,
  FileText,
  Moon,
  Palette,
  Plus,
  RotateCcw,
  Sun,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import hljs from "highlight.js/lib/core";
import markdown from "highlight.js/lib/languages/markdown";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeTexDelimiters } from "./markdown/normalizeTexDelimiters";
import { remarkGuardInlineMath } from "./markdown/remarkGuardInlineMath";
import {
  type RecentFile,
  addRecentFile,
  loadRecentFiles,
  removeRecentFile,
  saveRecentFiles,
  shortenPath,
} from "./recentFiles";
import "github-markdown-css/github-markdown.css";
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";
import "./App.css";

type MarkdownFile = {
  path: string;
  name: string;
  dir: string;
  content: string;
};

type ReadingMode = "preview" | "source" | "split";
type Theme = "light" | "dark";
type ReaderTheme = "lopash" | "upstanding-citizen" | "swiss";
type SourceTheme =
  | "auto"
  | "github"
  | "one-dark"
  | "dracula"
  | "nord"
  | "solarized-light";

const MARKDOWN_FILTERS = [
  {
    name: "Markdown",
    extensions: ["md", "markdown", "mdown", "mkd", "txt"],
  },
];

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

hljs.registerLanguage("markdown", markdown);

const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkGuardInlineMath];

// A malformed formula shows up in red in place, rather than taking the whole
// document down with it.
const REHYPE_PLUGINS = [
  rehypeHighlight,
  [rehypeKatex, { throwOnError: false, errorColor: "#d1383d" }],
] as const;

const READER_THEMES: { id: ReaderTheme; label: string }[] = [
  { id: "lopash", label: "Lopash" },
  { id: "upstanding-citizen", label: "Upstanding Citizen" },
  { id: "swiss", label: "Swiss" },
];

const SOURCE_THEMES: { id: SourceTheme; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "github", label: "GitHub" },
  { id: "one-dark", label: "One Dark" },
  { id: "dracula", label: "Dracula" },
  { id: "nord", label: "Nord" },
  { id: "solarized-light", label: "Solarized" },
];

const DEFAULT_READER_ZOOM = 1;
const MIN_READER_ZOOM = 0.4;
const MAX_READER_ZOOM = 1.8;
const READER_ZOOM_STEP = 0.1;

function getInitialTheme(): Theme {
  const savedTheme = window.localStorage.getItem("mdview.theme");
  if (savedTheme === "light" || savedTheme === "dark") {
    return savedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getInitialReaderTheme(): ReaderTheme {
  const savedTheme = window.localStorage.getItem("mdview.readerTheme");
  if (
    savedTheme === "lopash" ||
    savedTheme === "upstanding-citizen" ||
    savedTheme === "swiss"
  ) {
    return savedTheme;
  }

  return "lopash";
}

function getInitialSourceTheme(): SourceTheme {
  const savedTheme = window.localStorage.getItem("mdview.sourceTheme");
  const savedThemeVersion = window.localStorage.getItem(
    "mdview.sourceThemeVersion",
  );

  if (savedThemeVersion !== "2") {
    return "auto";
  }

  if (
    savedTheme === "auto" ||
    savedTheme === "github" ||
    savedTheme === "one-dark" ||
    savedTheme === "dracula" ||
    savedTheme === "nord" ||
    savedTheme === "solarized-light"
  ) {
    return savedTheme;
  }

  return "auto";
}

function clampReaderZoom(value: number) {
  return Math.min(MAX_READER_ZOOM, Math.max(MIN_READER_ZOOM, value));
}

function roundReaderZoom(value: number) {
  return Math.round(value * 100) / 100;
}

function getInitialReaderZoom() {
  const savedZoom = Number(window.localStorage.getItem("mdview.readerZoom"));
  if (Number.isFinite(savedZoom)) {
    return roundReaderZoom(clampReaderZoom(savedZoom));
  }

  return DEFAULT_READER_ZOOM;
}

function splitResourceUrl(value: string) {
  const queryIndex = value.indexOf("?");
  const hashIndex = value.indexOf("#");
  const indexes = [queryIndex, hashIndex].filter((index) => index >= 0);
  const splitIndex = indexes.length > 0 ? Math.min(...indexes) : -1;

  if (splitIndex < 0) {
    return { pathname: value, suffix: "" };
  }

  return {
    pathname: value.slice(0, splitIndex),
    suffix: value.slice(splitIndex),
  };
}

function decodePathname(pathname: string) {
  try {
    return decodeURI(pathname);
  } catch {
    return pathname;
  }
}

function normalizePosixPath(pathname: string) {
  const isAbsolute = pathname.startsWith("/");
  const parts = pathname.split("/");
  const normalized: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      normalized.pop();
      continue;
    }

    normalized.push(part);
  }

  return `${isAbsolute ? "/" : ""}${normalized.join("/")}`;
}

function isRemoteOrSpecialUrl(src: string) {
  return URL_SCHEME_RE.test(src) || src.startsWith("//") || src.startsWith("#");
}

function App() {
  const [openFiles, setOpenFiles] = useState<MarkdownFile[]>([]);
  const [activeFileIndex, setActiveFileIndex] = useState(-1);
  const [mode, setMode] = useState<ReadingMode>("preview");
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [readerTheme, setReaderTheme] =
    useState<ReaderTheme>(getInitialReaderTheme);
  const [sourceTheme, setSourceTheme] =
    useState<SourceTheme>(getInitialSourceTheme);
  const [readerZoom, setReaderZoom] = useState(getInitialReaderZoom);
  const [status, setStatus] = useState("Open a Markdown file to start reading.");
  const [isLoading, setIsLoading] = useState(false);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(loadRecentFiles);
  const [homePath, setHomePath] = useState<string | null>(null);

  // Derived current file
  const currentFile =
    activeFileIndex >= 0 && activeFileIndex < openFiles.length
      ? openFiles[activeFileIndex]
      : null;

  // Show tab bar only when 2+ files are open
  const showTabBar = openFiles.length >= 2;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.colorMode = theme;
    document.documentElement.dataset.lightTheme = "light";
    document.documentElement.dataset.darkTheme = "dark";
    window.localStorage.setItem("mdview.theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.readerTheme = readerTheme;
    window.localStorage.setItem("mdview.readerTheme", readerTheme);
  }, [readerTheme]);

  useEffect(() => {
    document.documentElement.dataset.sourceTheme = sourceTheme;
    window.localStorage.setItem("mdview.sourceTheme", sourceTheme);
    window.localStorage.setItem("mdview.sourceThemeVersion", "2");
  }, [sourceTheme]);

  useEffect(() => {
    window.localStorage.setItem("mdview.readerZoom", String(readerZoom));
  }, [readerZoom]);

  useEffect(() => {
    saveRecentFiles(recentFiles);
    // Keep the native File > Open Recent submenu in step with the stored list.
    void invoke("set_recent_files", {
      entries: recentFiles.map(({ path, name }) => ({ path, name })),
    }).catch(() => undefined);
  }, [recentFiles]);

  useEffect(() => {
    // Used only to shorten displayed paths, so failure is not worth surfacing.
    void homeDir()
      .then((path) => setHomePath(path.replace(/\/$/, "")))
      .catch(() => setHomePath(null));
  }, []);

  const loadFile = useCallback(async (path: string) => {
    setIsLoading(true);
    setStatus("Loading...");

    try {
      // Check if file is already open
      const existingIndex = openFiles.findIndex((f) => f.path === path);
      if (existingIndex >= 0) {
        setActiveFileIndex(existingIndex);
        setStatus(`Switched to ${openFiles[existingIndex].name}`);
        document.title = `${openFiles[existingIndex].name} - mdViewer`;
        setIsLoading(false);
        return;
      }

      const file = await invoke<MarkdownFile>("read_markdown_file", { path });
      setRecentFiles((previous) =>
        addRecentFile(previous, {
          path: file.path,
          name: file.name,
          dir: file.dir,
        }),
      );
      setOpenFiles((previous) => {
        const newFiles = [...previous, file];
        // Set active index to the new file
        const newIndex = newFiles.length - 1;
        setActiveFileIndex(newIndex);
        setStatus(`Loaded ${file.name}`);
        document.title = `${file.name} - mdViewer`;
        return newFiles;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      // A path that no longer reads is dead weight in the recent list.
      setRecentFiles((previous) => removeRecentFile(previous, path));
    } finally {
      setIsLoading(false);
    }
  }, [openFiles]);

  const openFile = useCallback(async () => {
    const selected = await open({
      directory: false,
      multiple: false,
      filters: MARKDOWN_FILTERS,
    });

    if (typeof selected === "string") {
      await loadFile(selected);
    }
  }, [loadFile]);

  const closeTab = useCallback(
    (index: number) => {
      setOpenFiles((previous) => {
        const newFiles = previous.filter((_, i) => i !== index);
        if (newFiles.length === 0) {
          setActiveFileIndex(-1);
          setStatus("Open a Markdown file to start reading.");
          document.title = "mdViewer";
          return newFiles;
        }

        // Adjust active index
        if (index === activeFileIndex) {
          // Activate the next tab, or the previous if it was the last
          const newActiveIndex = Math.min(index, newFiles.length - 1);
          setActiveFileIndex(newActiveIndex);
          setStatus(`Loaded ${newFiles[newActiveIndex].name}`);
          document.title = `${newFiles[newActiveIndex].name} - mdViewer`;
        } else if (index < activeFileIndex) {
          // Closed a tab before the active one, shift index down
          setActiveFileIndex(activeFileIndex - 1);
        }
        return newFiles;
      });
    },
    [activeFileIndex],
  );

  const switchTab = useCallback(
    (index: number) => {
      if (index >= 0 && index < openFiles.length) {
        setActiveFileIndex(index);
        setStatus(`Loaded ${openFiles[index].name}`);
        document.title = `${openFiles[index].name} - mdViewer`;
      }
    },
    [openFiles],
  );

  const closeCurrentTab = useCallback(() => {
    if (activeFileIndex >= 0 && activeFileIndex < openFiles.length) {
      closeTab(activeFileIndex);
    }
  }, [activeFileIndex, openFiles, closeTab]);

  const nextTab = useCallback(() => {
    if (openFiles.length > 0) {
      const nextIndex = (activeFileIndex + 1) % openFiles.length;
      switchTab(nextIndex);
    }
  }, [activeFileIndex, openFiles, switchTab]);

  const previousTab = useCallback(() => {
    if (openFiles.length > 0) {
      const prevIndex = (activeFileIndex - 1 + openFiles.length) % openFiles.length;
      switchTab(prevIndex);
    }
  }, [activeFileIndex, openFiles, switchTab]);

  const reloadFile = useCallback(async () => {
    if (!currentFile || isLoading) {
      return;
    }

    await loadFile(currentFile.path);
  }, [currentFile, isLoading, loadFile]);

  const zoomOut = useCallback(() => {
    setReaderZoom((previousZoom) =>
      roundReaderZoom(clampReaderZoom(previousZoom - READER_ZOOM_STEP)),
    );
  }, []);

  const zoomIn = useCallback(() => {
    setReaderZoom((previousZoom) =>
      roundReaderZoom(clampReaderZoom(previousZoom + READER_ZOOM_STEP)),
    );
  }, []);

  const resetZoom = useCallback(() => {
    setReaderZoom(DEFAULT_READER_ZOOM);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const hasCommandModifier = event.metaKey || event.ctrlKey;
      const hasShiftModifier = event.shiftKey;

      if (hasCommandModifier && hasShiftModifier) {
        const key = event.key;
        if (key === "}" || key === "]") {
          event.preventDefault();
          nextTab();
        }
        if (key === "{" || key === "[") {
          event.preventDefault();
          previousTab();
        }
        return;
      }

      if (!hasCommandModifier) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "w") {
        event.preventDefault();
        closeCurrentTab();
      }

      if (key === "-" || key === "_") {
        event.preventDefault();
        zoomOut();
      }

      if (key === "=" || key === "+") {
        event.preventDefault();
        zoomIn();
      }

      if (key === "0") {
        event.preventDefault();
        resetZoom();
      }

      if (key === "1") {
        event.preventDefault();
        setMode("preview");
      }

      if (key === "2") {
        event.preventDefault();
        setMode("split");
      }

      if (key === "3") {
        event.preventDefault();
        setMode("source");
      }

      if (key === "d") {
        event.preventDefault();
        setTheme((previousTheme) =>
          previousTheme === "dark" ? "light" : "dark",
        );
      }

      if (key === "t") {
        event.preventDefault();
        setReaderTheme((previousTheme) => {
          const currentIndex = READER_THEMES.findIndex(
            (option) => option.id === previousTheme,
          );
          const nextIndex =
            (currentIndex + 1 + READER_THEMES.length) % READER_THEMES.length;
          return READER_THEMES[nextIndex].id;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [resetZoom, zoomIn, zoomOut, closeCurrentTab, nextTab, previousTab]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void invoke<string[]>("take_pending_opened_files").then((paths) => {
      // Load all pending files
      for (const path of paths) {
        void loadFile(path);
      }
    });

    void listen<string[]>("open-markdown-files", (event) => {
      for (const path of event.payload) {
        void loadFile(path);
      }
    }).then((handler) => {
      unlisten = handler;
    });

    return () => unlisten?.();
  }, [loadFile]);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    void listen("menu-open-file", () => {
      void openFile();
    }).then((handler) => {
      unlisteners.push(handler);
    });

    void listen("menu-reload-file", () => {
      void reloadFile();
    }).then((handler) => {
      unlisteners.push(handler);
    });

    void listen("menu-close-tab", () => {
      closeCurrentTab();
    }).then((handler) => {
      unlisteners.push(handler);
    });

    void listen("menu-clear-recent-files", () => {
      setRecentFiles([]);
    }).then((handler) => {
      unlisteners.push(handler);
    });

    return () => {
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [openFile, reloadFile, closeCurrentTab]);

  const resolveMarkdownAsset = useCallback(
    (src: string | undefined) => {
      if (!src || !currentFile || isRemoteOrSpecialUrl(src)) {
        return src ?? "";
      }

      const { pathname, suffix } = splitResourceUrl(src);
      const decodedPathname = decodePathname(pathname);
      const absolutePath = decodedPathname.startsWith("/")
        ? decodedPathname
        : normalizePosixPath(`${currentFile.dir}/${decodedPathname}`);

      return `${convertFileSrc(absolutePath)}${suffix}`;
    },
    [currentFile],
  );

  const fileStats = useMemo(() => {
    if (!currentFile) {
      return null;
    }

    const lines = currentFile.content.length
      ? currentFile.content.split(/\r\n|\r|\n/).length
      : 0;

    return `${lines.toLocaleString()} lines`;
  }, [currentFile]);

  // Only the preview is normalized; the source view still shows the file as it
  // was written on disk.
  const previewSource = useMemo(
    () => (currentFile ? normalizeTexDelimiters(currentFile.content) : ""),
    [currentFile],
  );

  const highlightedSource = useMemo(() => {
    if (!currentFile) {
      return "";
    }

    try {
      return hljs.highlight(currentFile.content, { language: "markdown" }).value;
    } catch {
      return hljs.highlightAuto(currentFile.content).value;
    }
  }, [currentFile]);

  const readerStyle = useMemo(
    () =>
      ({
        "--reader-zoom": readerZoom,
      }) as CSSProperties,
    [readerZoom],
  );

  const zoomPercent = `${Math.round(readerZoom * 100)}%`;

  return (
    <div className={`app-shell ${showTabBar ? "app-shell--with-tabs" : ""}`}>
      <header className="toolbar">
        <div className="toolbar-actions" aria-label="Reading controls">
          <div className="segmented-control" aria-label="Reading mode">
            <button
              aria-pressed={mode === "preview"}
              className={mode === "preview" ? "is-active" : undefined}
              title="Preview only (Command+1)"
              type="button"
              onClick={() => setMode("preview")}
            >
              <Eye size={17} strokeWidth={1.9} aria-hidden="true" />
              <span>Preview</span>
            </button>
            <button
              aria-pressed={mode === "split"}
              className={mode === "split" ? "is-active" : undefined}
              title="Split source and preview (Command+2)"
              type="button"
              onClick={() => setMode("split")}
            >
              <Columns2 size={17} strokeWidth={1.9} aria-hidden="true" />
              <span>Split</span>
            </button>
            <button
              aria-pressed={mode === "source"}
              className={mode === "source" ? "is-active" : undefined}
              title="Source only (Command+3)"
              type="button"
              onClick={() => setMode("source")}
            >
              <Code2 size={17} strokeWidth={1.9} aria-hidden="true" />
              <span>Source</span>
            </button>
          </div>

          <div className="zoom-controls" aria-label="Reader zoom">
            <button
              className="icon-button square"
              title="Zoom out (Command+-)"
              type="button"
              onClick={zoomOut}
            >
              <ZoomOut size={17} strokeWidth={1.9} aria-hidden="true" />
            </button>
            <button
              className="zoom-level"
              title="Reset zoom (Command+0)"
              type="button"
              onClick={resetZoom}
            >
              {zoomPercent}
            </button>
            <button
              className="icon-button square"
              title="Zoom in (Command+=)"
              type="button"
              onClick={zoomIn}
            >
              <ZoomIn size={17} strokeWidth={1.9} aria-hidden="true" />
            </button>
            <button
              className="icon-button square"
              title="Reset zoom (Command+0)"
              type="button"
              onClick={resetZoom}
            >
              <RotateCcw size={16} strokeWidth={1.9} aria-hidden="true" />
            </button>
          </div>

          <label className="theme-picker" title="Markdown theme (Command+T)">
            <Palette size={17} strokeWidth={1.9} aria-hidden="true" />
            <span className="sr-only">Markdown theme</span>
            <select
              aria-label="Markdown theme"
              value={readerTheme}
              onChange={(event) =>
                setReaderTheme(event.currentTarget.value as ReaderTheme)
              }
            >
              {READER_THEMES.map((themeOption) => (
                <option key={themeOption.id} value={themeOption.id}>
                  {themeOption.label}
                </option>
              ))}
            </select>
          </label>

          <label
            className="theme-picker source-theme-picker"
            title="Source code highlight theme"
          >
            <Code2 size={17} strokeWidth={1.9} aria-hidden="true" />
            <span className="sr-only">Source code theme</span>
            <select
              aria-label="Source code highlight theme"
              value={sourceTheme}
              onChange={(event) =>
                setSourceTheme(event.currentTarget.value as SourceTheme)
              }
            >
              {SOURCE_THEMES.map((themeOption) => (
                <option key={themeOption.id} value={themeOption.id}>
                  {themeOption.label}
                </option>
              ))}
            </select>
          </label>

          <button
            className="icon-button square"
            title="Toggle light/dark theme (Command+D)"
            type="button"
            onClick={() =>
              setTheme((previousTheme) =>
                previousTheme === "dark" ? "light" : "dark",
              )
            }
          >
            {theme === "dark" ? (
              <Sun size={18} strokeWidth={1.9} aria-hidden="true" />
            ) : (
              <Moon size={18} strokeWidth={1.9} aria-hidden="true" />
            )}
          </button>
        </div>

        <div className="file-heading">
          <FileText size={18} strokeWidth={1.8} aria-hidden="true" />
          <div>
            <div className="file-name">
              {currentFile ? currentFile.name : "No file open"}
            </div>
            <div className="file-path">
              {currentFile ? currentFile.path : status}
            </div>
          </div>
        </div>
      </header>

      {showTabBar && (
        <div className="tab-bar" role="tablist" aria-label="Open files">
          {openFiles.map((file, index) => (
            <div
              key={file.path}
              className={`tab-item ${index === activeFileIndex ? "is-active" : ""}`}
              role="tab"
              aria-selected={index === activeFileIndex}
              title={file.path}
            >
              <button
                className="tab-label"
                type="button"
                onClick={() => switchTab(index)}
              >
                <span className="tab-name">{file.name}</span>
              </button>
              <button
                className="tab-close"
                type="button"
                title="Close tab (Command+W)"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(index);
                }}
              >
                <X size={14} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </div>
          ))}
          <button
            className="tab-new"
            type="button"
            title="Open new file (Command+O)"
            onClick={openFile}
          >
            <Plus size={16} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      )}

      <main className={`reader reader-${mode}`} style={readerStyle}>
        {currentFile ? (
          <>
            {mode === "source" || mode === "split" ? (
              <section className="source-panel" aria-label="Markdown source">
                <pre className="source-code" tabIndex={0}>
                  <code
                    className="hljs language-markdown"
                    dangerouslySetInnerHTML={{ __html: highlightedSource }}
                  />
                </pre>
              </section>
            ) : null}

            {mode === "preview" || mode === "split" ? (
              <section className="preview-panel" aria-label="Markdown preview">
                <article className="markdown-body">
                  <ReactMarkdown
                    remarkPlugins={REMARK_PLUGINS}
                    rehypePlugins={REHYPE_PLUGINS as never}
                    components={{
                      img({ alt, src, ...props }) {
                        return (
                          <img
                            {...props}
                            alt={alt ?? ""}
                            loading="lazy"
                            src={resolveMarkdownAsset(src)}
                          />
                        );
                      },
                    }}
                  >
                    {previewSource}
                  </ReactMarkdown>
                </article>
              </section>
            ) : null}
          </>
        ) : (
          <section className="empty-state" aria-label="No document open">
            <FileText size={32} strokeWidth={1.6} aria-hidden="true" />
            <p>Use File &gt; Open... or Command+O to start reading.</p>

            {recentFiles.length ? (
              <nav className="recent-files" aria-label="Recent files">
                <div className="recent-files-header">
                  <Clock size={14} strokeWidth={1.9} aria-hidden="true" />
                  <span>Recent</span>
                  <button
                    className="recent-files-clear"
                    type="button"
                    onClick={() => setRecentFiles([])}
                  >
                    Clear
                  </button>
                </div>
                <ul>
                  {recentFiles.map((file) => (
                    <li key={file.path}>
                      <button
                        title={file.path}
                        type="button"
                        onClick={() => void loadFile(file.path)}
                      >
                        <span className="recent-files-name">{file.name}</span>
                        <span className="recent-files-dir">
                          {shortenPath(file.dir, homePath)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
          </section>
        )}
      </main>

      <footer className="status-bar">
        <span>{status}</span>
        {fileStats ? <span>{fileStats}</span> : null}
      </footer>
    </div>
  );
}

export default App;
