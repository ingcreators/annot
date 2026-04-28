/**
 * Built-in plugin — registers a "Recent" sidebar tab that tracks the
 * last-opened images per session and, on click, navigates the
 * gallery to the folder of the most recently-opened entry.
 *
 * Plays the same role for the Phase 1 sidebar-tab API that
 * `github-external-links` plays for `addExternalLinkSource`:
 * proves the registration + state-update + click dispatch covers a
 * real, in-tree use case end-to-end. Not a deep "Recent images"
 * view — main-content injection isn't part of the sidebar-tab MVP;
 * a future plan can promote Recent into a flat-list page if
 * usability testing flags folder-navigate as insufficient.
 *
 * Tracking: each `onEditorReady` event pushes the opened path +
 * mode + timestamp into localStorage (capped at 50 entries, oldest
 * dropped). The cap keeps the entry blob trivially small (≤8 KB)
 * even for users who churn through many images.
 */

import { builtinIcon } from "@ingcreators/annot-core";
import type { AnnotPlugin } from "../plugin-host.js";
import { galleryUrl } from "../../router.js";
import { getStorageMode } from "../../storage/bridge.js";

const STORAGE_KEY = "annot-recent-paths";
const MAX_ENTRIES = 50;

export interface RecentEntry {
  /** Image path as the active backend reports it. */
  path: string;
  /** Storage mode at the time of opening — preserved so a future
   *  cross-mode "Recent" view can disambiguate two paths that
   *  collide across stores. Today only the most-recent entry's
   *  mode is read. */
  mode: string;
  /** ISO timestamp of when the editor session started. */
  openedAt: string;
}

/** Read the recent-entries log from localStorage. Returns an empty
 *  array on missing key, parse failure, or an unexpected shape —
 *  the tab gracefully no-ops rather than crashing the sidebar. */
export function loadRecentEntries(): RecentEntry[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentEntry =>
        e &&
        typeof e === "object" &&
        typeof e.path === "string" &&
        typeof e.mode === "string" &&
        typeof e.openedAt === "string",
    );
  } catch {
    return [];
  }
}

/** Push a new entry to the front (most recent first). De-dupes by
 *  path so reopening the same image moves it to the top instead of
 *  cluttering the log. Caps at `MAX_ENTRIES`. */
export function pushRecentEntry(entry: RecentEntry): void {
  const existing = loadRecentEntries().filter((e) => e.path !== entry.path);
  const next = [entry, ...existing].slice(0, MAX_ENTRIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

/** Derive the folder-path component of an image path.
 *  `"Mobile/Screenshots/img.png"` → `"Mobile/Screenshots"`,
 *  `"img.png"` → `""`. */
function pathFolder(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash > 0 ? path.slice(0, slash) : "";
}

export const recentTabPlugin: AnnotPlugin = {
  name: "recent-tab",
  register(ctx) {
    ctx.addSidebarTab({
      id: "recent",
      label: "Recent",
      icon: builtinIcon("history"),
      // Built-in priority slot. Plugins that want to land before
      // Recent can pick anything < 10.
      priority: 10,
      onClick: () => {
        const last = loadRecentEntries()[0];
        if (!last) return; // never opened anything → nothing to navigate to
        const folder = pathFolder(last.path);
        // Push the folder URL + dispatch popstate so App's existing
        // route handler runs the regular gallery rebuild. Mirrors the
        // pattern used by other in-app navigation paths (breadcrumb
        // click, brand button) without requiring a new context method.
        window.history.pushState({}, "", galleryUrl(folder));
        window.dispatchEvent(new PopStateEvent("popstate"));
      },
    });

    // `onEditorReady` fires once per editor session — exactly the
    // surface "Recent" wants to capture. Skip captures with a null
    // path (initial / not-yet-saved); only persisted images count.
    ctx.onEditorReady((ev) => {
      if (!ev.path) return;
      pushRecentEntry({
        path: ev.path,
        mode: getStorageMode(),
        openedAt: new Date().toISOString(),
      });
    });
  },
};
