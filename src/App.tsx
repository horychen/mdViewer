import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
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
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Editor } from "./Editor";
import { Mermaid } from "./Mermaid";
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
// No highlight.js stylesheet: its colours are fixed, and the source-theme
// variables in App.css drive both the source pane and the preview instead.
import "katex/dist/katex.min.css";
import "./App.css";

type MarkdownFile = {
  path: string;
  name: string;
  dir: string;
  content: string;
  /** What is on disk, so edits can be compared against it. */
  savedContent: string;
};

/** How long typing has to pause before the preview is rebuilt. */
const PREVIEW_DEBOUNCE_MS = 200;

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
// Raised for diagrams: a dense flowchart needs magnifying well past the point
// where prose stops being comfortable.
const MAX_READER_ZOOM = 3;
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
  const [searchRequest, setSearchRequest] = useState(0);

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
      const file = await invoke<MarkdownFile>("read_markdown_file", { path });
      setRecentFiles((previous) =>
        addRecentFile(previous, {
          path: file.path,
          name: file.name,
          dir: file.dir,
        }),
      );

      // The already-open check has to read the current list, not one captured
      // when this callback was created. Two loads of the same path can land in
      // one tick, and from a stale copy both would conclude the file is new and
      // append a tab of their own.
      setOpenFiles((previous) => {
        const existingIndex = previous.findIndex(
          (item) => item.path === file.path,
        );

        if (existingIndex >= 0) {
          setActiveFileIndex(existingIndex);
          setStatus(`Switched to ${file.name}`);
          document.title = `${file.name} - mdViewer`;
          return previous;
        }

        setActiveFileIndex(previous.length);
        setStatus(`Loaded ${file.name}`);
        document.title = `${file.name} - mdViewer`;
        return [...previous, { ...file, savedContent: file.content }];
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      // A path that no longer reads is dead weight in the recent list.
      setRecentFiles((previous) => removeRecentFile(previous, path));
    } finally {
      setIsLoading(false);
    }
    // No dependency on `openFiles`: this callback must stay stable, or every
    // effect that lists it re-subscribes on each keystroke.
  }, []);

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
    async (index: number) => {
      const closing = openFiles[index];

      // Closing is the one irreversible thing the editor does to unsaved work.
      if (closing && closing.content !== closing.savedContent) {
        const confirmed = await confirm(
          `${closing.name} has unsaved changes. Closing will discard them.`,
          { title: "Discard changes?", kind: "warning" },
        );
        if (!confirmed) {
          return;
        }
      }

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
    [activeFileIndex, openFiles],
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
      void closeTab(activeFileIndex);
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

  const editContent = useCallback(
    (value: string) => {
      setOpenFiles((previous) =>
        previous.map((file, index) =>
          index === activeFileIndex ? { ...file, content: value } : file,
        ),
      );
    },
    [activeFileIndex],
  );

  /**
   * Opens an empty tab that has no file behind it yet.
   *
   * Asking where to put it first would interrupt the thought that prompted
   * Command+N. The location is chosen at the first save instead, which is how
   * every other editor on the machine behaves.
   */
  /**
   * Opens the editor's search panel.
   *
   * Searching happens in the source, because that is where a match can be
   * corrected and where CodeMirror already provides find, replace, and match
   * highlighting. Asked for from preview-only mode, the editor is brought into
   * view first — a search whose results are invisible would be no search.
   */
  const requestSearch = useCallback(() => {
    setMode((previousMode) => (previousMode === "preview" ? "split" : previousMode));
    setSearchRequest((previous) => previous + 1);
  }, []);

  const newFile = useCallback(() => {
    setOpenFiles((previous) => {
      const untitled: MarkdownFile = {
        path: "",
        name: "Untitled.md",
        dir: "",
        content: "",
        savedContent: "",
      };

      setActiveFileIndex(previous.length);
      setStatus("New document — Command+S to choose where it lives.");
      document.title = "Untitled.md - mdViewer";
      return [...previous, untitled];
    });

    // A new document is for writing in, so start where the writing happens.
    setMode((previousMode) => (previousMode === "preview" ? "split" : previousMode));
  }, []);

  const saveFile = useCallback(async () => {
    const file = openFiles[activeFileIndex];
    if (!file) {
      return;
    }

    // An untitled document always needs a destination; a saved one only needs
    // writing when it has actually changed.
    const needsLocation = file.path === "";
    if (!needsLocation && file.content === file.savedContent) {
      return;
    }

    let path = file.path;
    let name = file.name;
    let dir = file.dir;

    if (needsLocation) {
      const chosen = await save({
        defaultPath: "Untitled.md",
        filters: MARKDOWN_FILTERS,
      });

      if (!chosen) {
        return;
      }

      path = chosen;
      name = chosen.split("/").pop() ?? "Untitled.md";
      dir = chosen.slice(0, Math.max(0, chosen.length - name.length - 1));
    }

    try {
      await invoke("write_markdown_file", { path, content: file.content });

      setOpenFiles((previous) =>
        previous.map((item, index) =>
          index === activeFileIndex
            ? { ...item, path, name, dir, savedContent: item.content }
            : item,
        ),
      );

      if (needsLocation) {
        setRecentFiles((previous) => addRecentFile(previous, { path, name, dir }));
        document.title = `${name} - mdViewer`;
      }

      setStatus(`Saved ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
    }
  }, [activeFileIndex, openFiles]);

  const reloadFile = useCallback(async () => {
    if (!currentFile || isLoading) {
      return;
    }

    // Reloading throws away edits, so it has to ask first.
    if (currentFile.content !== currentFile.savedContent) {
      const confirmed = await confirm(
        `${currentFile.name} has unsaved changes. Reloading will discard them.`,
        { title: "Discard changes?", kind: "warning" },
      );
      if (!confirmed) {
        return;
      }
    }

    setOpenFiles((previous) =>
      previous.filter((file) => file.path !== currentFile.path),
    );
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

  /**
   * Pinching the trackpad zooms the reading area.
   *
   * macOS reports a pinch as a wheel event with `ctrlKey` set — there is no
   * separate gesture event to listen for in a WebView. The default must be
   * prevented, or the page zooms underneath us and the toolbar grows with the
   * text. Registered non-passive for the same reason.
   */
  useEffect(() => {
    // A trackpad emits wheel events far faster than a large document can be
    // laid out. Accumulating them and applying once per frame keeps the pinch
    // smooth instead of queueing a reflow behind every notch.
    let pending = 0;
    let frame = 0;

    const apply = () => {
      frame = 0;
      const delta = pending;
      pending = 0;
      setReaderZoom((previous) =>
        roundReaderZoom(clampReaderZoom(previous * (1 - delta / 100))),
      );
    };

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();
      pending += event.deltaY;
      frame ||= requestAnimationFrame(apply);
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel);
      if (frame) {
        cancelAnimationFrame(frame);
      }
    };
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
      if (key === "f") {
        event.preventDefault();
        requestSearch();
      }

      if (key === "n") {
        event.preventDefault();
        newFile();
      }

      if (key === "s") {
        event.preventDefault();
        void saveFile();
      }

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
  }, [
    resetZoom,
    zoomIn,
    zoomOut,
    requestSearch,
    newFile,
    saveFile,
    closeCurrentTab,
    nextTab,
    previousTab,
  ]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void invoke<string[]>("take_pending_opened_files").then((paths) => {
      // Files macOS handed us before the window existed.
      for (const path of paths) {
        void loadFile(path);
      }
    });

    void listen<string[]>("open-markdown-files", (event) => {
      for (const path of event.payload) {
        void loadFile(path);
      }
    }).then((handler) => {
      // `listen` resolves after the effect may already have been cleaned up.
      // Without this check the handle arrives too late to be used, the
      // subscription is never dropped, and every re-run leaves another live
      // listener behind — one open then produces one tab per leaked listener.
      if (cancelled) {
        handler();
        return;
      }
      unlisten = handler;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [loadFile]);

  /**
   * The menu commands, reached through a ref rather than closed over.
   *
   * These handlers change whenever the document does — `saveFile` needs the
   * current text. Listing them as dependencies re-subscribed the menu on every
   * keystroke, and since `listen` resolves asynchronously, most of those
   * subscriptions were never dropped. Registering once and reading the latest
   * handler from a ref keeps the subscription count at one apiece.
   */
  const menuActionsRef = useRef({
    openFile,
    requestSearch,
    newFile,
    saveFile,
    reloadFile,
    closeCurrentTab,
  });

  menuActionsRef.current = {
    openFile,
    requestSearch,
    newFile,
    saveFile,
    reloadFile,
    closeCurrentTab,
  };

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let cancelled = false;

    const collect = (handler: () => void) => {
      if (cancelled) {
        handler();
        return;
      }
      unlisteners.push(handler);
    };

    const subscriptions: [string, () => void][] = [
      ["menu-open-file", () => void menuActionsRef.current.openFile()],
      ["menu-find", () => menuActionsRef.current.requestSearch()],
      ["menu-new-file", () => menuActionsRef.current.newFile()],
      ["menu-save-file", () => void menuActionsRef.current.saveFile()],
      ["menu-reload-file", () => void menuActionsRef.current.reloadFile()],
      ["menu-close-tab", () => menuActionsRef.current.closeCurrentTab()],
      ["menu-clear-recent-files", () => setRecentFiles([])],
    ];

    for (const [event, action] of subscriptions) {
      void listen(event, action).then(collect);
    }

    return () => {
      cancelled = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, []);

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

  /**
   * The text the preview is built from, held one step behind the editor.
   *
   * Typing updates the document immediately, because anything else feels
   * broken. Rebuilding the preview is the expensive half — KaTeX relays every
   * formula in the file — so it waits for a pause instead of running per
   * keystroke.
   */
  const [debouncedContent, setDebouncedContent] = useState("");

  useEffect(() => {
    if (!currentFile) {
      setDebouncedContent("");
      return;
    }

    // Switching tabs should not show the previous file for 200ms.
    if (debouncedContent === "") {
      setDebouncedContent(currentFile.content);
      return;
    }

    const timer = setTimeout(
      () => setDebouncedContent(currentFile.content),
      PREVIEW_DEBOUNCE_MS,
    );

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFile?.content, currentFile?.path]);

  useEffect(() => {
    setDebouncedContent(currentFile?.content ?? "");
  }, [currentFile?.path]);

  /**
   * Quitting is the other way unsaved work disappears, and the window can be
   * closed without touching a tab at all — so the close request is intercepted
   * and only allowed through once the reader has said so.
   */
  // Read at close time rather than captured, so this subscription can be made
  // once instead of on every edit — the same leak the menu listeners had.
  const openFilesRef = useRef(openFiles);
  openFilesRef.current = openFiles;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        const unsaved = openFilesRef.current.filter(
          (file) => file.content !== file.savedContent,
        );

        if (unsaved.length === 0) {
          return;
        }

        event.preventDefault();

        const names = unsaved.map((file) => file.name).join(", ");
        const confirmed = await confirm(
          `Unsaved changes in ${names}. Quitting will discard them.`,
          { title: "Discard changes?", kind: "warning" },
        );

        if (confirmed) {
          await getCurrentWindow().destroy();
        }
      })
      .then((handler) => {
        if (cancelled) {
          handler();
          return;
        }
        unlisten = handler;
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Only the preview is normalized; the editor shows the file as written.
  const previewSource = useMemo(
    () => normalizeTexDelimiters(debouncedContent),
    [debouncedContent],
  );

  const isDirty = currentFile
    ? currentFile.content !== currentFile.savedContent
    : false;

  /**
   * The rendered document, rebuilt only when the document itself changes.
   *
   * Zoom is a CSS variable, but without this the whole tree re-rendered on
   * every wheel notch — parsing the Markdown again, laying out every formula
   * again, and stalling a long document mid-pinch. Notably `readerZoom` is not
   * a dependency here: it changes how this looks, never what it is.
   */
  const renderedPreview = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS as never}
        components={{
          code({ className, children, ...props }) {
            // Mermaid arrives as a fenced block; everything else stays on the
            // normal highlighted-code path.
            if (/\blanguage-mermaid\b/.test(className ?? "")) {
              return (
                <Mermaid
                  code={String(children).replace(/\n$/, "")}
                  theme={theme}
                />
              );
            }

            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
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
    ),
    [previewSource, theme, resolveMarkdownAsset],
  );

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
                {file.content !== file.savedContent ? (
                  <span className="tab-dirty" aria-label="Unsaved changes">
                    ●
                  </span>
                ) : null}
              </button>
              <button
                className="tab-close"
                type="button"
                title="Close tab (Command+W)"
                onClick={(e) => {
                  e.stopPropagation();
                  void closeTab(index);
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
              <section className="source-panel" aria-label="Markdown editor">
                <Editor
                  value={currentFile.content}
                  onChange={editContent}
                  themeKey={`${sourceTheme}-${theme}`}
                  searchRequest={searchRequest}
                />
              </section>
            ) : null}

            {mode === "preview" || mode === "split" ? (
              <section className="preview-panel" aria-label="Markdown preview">
                <article className="markdown-body">
                  {renderedPreview}
                </article>
              </section>
            ) : null}
          </>
        ) : (
          <section className="empty-state" aria-label="No document open">
            <FileText size={32} strokeWidth={1.6} aria-hidden="true" />
            <p>Command+N for a new document, Command+O to open one.</p>
            <div className="empty-state-actions">
              <button className="icon-button" type="button" onClick={newFile}>
                <Plus size={16} strokeWidth={2} aria-hidden="true" />
                <span>New</span>
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={() => void openFile()}
              >
                <span>Open...</span>
              </button>
            </div>

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
        <span className="status-right">
          {isDirty ? (
            <span className="status-dirty">Unsaved — Command+S</span>
          ) : null}
          {fileStats ? <span>{fileStats}</span> : null}
        </span>
      </footer>
    </div>
  );
}

export default App;
