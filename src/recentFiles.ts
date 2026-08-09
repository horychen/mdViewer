/**
 * The recently-opened file list, persisted in localStorage.
 *
 * Entries hold a plain filesystem path. That is enough outside the macOS App
 * Sandbox; a sandboxed build would have to persist a security-scoped bookmark
 * instead, because a path alone grants no read access there.
 */

const STORAGE_KEY = "mdview.recentFiles";
const MAX_ENTRIES = 12;

export type RecentFile = {
  path: string;
  name: string;
  dir: string;
};

function isRecentFile(value: unknown): value is RecentFile {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.path === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.dir === "string"
  );
}

export function loadRecentFiles(): RecentFile[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);

    return Array.isArray(parsed)
      ? parsed.filter(isRecentFile).slice(0, MAX_ENTRIES)
      : [];
  } catch {
    // Corrupt or unreadable storage should never keep the app from starting.
    return [];
  }
}

export function saveRecentFiles(entries: RecentFile[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage being full or blocked is not worth interrupting the reader for.
  }
}

/** Moves `entry` to the front, dropping any earlier record of the same path. */
export function addRecentFile(
  entries: RecentFile[],
  entry: RecentFile,
): RecentFile[] {
  const withoutDuplicate = entries.filter((item) => item.path !== entry.path);

  return [entry, ...withoutDuplicate].slice(0, MAX_ENTRIES);
}

export function removeRecentFile(
  entries: RecentFile[],
  path: string,
): RecentFile[] {
  return entries.filter((item) => item.path !== path);
}

/** Replaces the user's home directory with `~` for display. */
export function shortenPath(dir: string, home: string | null): string {
  if (home && (dir === home || dir.startsWith(`${home}/`))) {
    return `~${dir.slice(home.length)}`;
  }

  return dir;
}
