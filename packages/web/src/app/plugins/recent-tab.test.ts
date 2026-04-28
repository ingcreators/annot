/**
 * @vitest-environment happy-dom
 *
 * Recent built-in plugin — behavioural tests.
 *
 * Covers the localStorage tracker (`pushRecentEntry` /
 * `loadRecentEntries`) + the registration shape end-to-end via the
 * `PluginHost`. The folder-navigation `onClick` is covered by manual
 * smoke at PR review (it triggers `pushState` + popstate dispatch
 * which is well outside the unit-test surface).
 *
 * happy-dom supplies `localStorage` (the recent-tracker's
 * persistence layer) and `window.history` (the onClick navigation
 * fallback that's manually-tested rather than asserted here).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PluginHost } from "../plugin-host.js";
import { loadRecentEntries, pushRecentEntry, recentTabPlugin } from "./recent-tab.js";

const STORAGE_KEY = "annot-recent-paths";
const MAX_ENTRIES = 50;

describe("recent-tab plugin", () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });
  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  describe("loadRecentEntries / pushRecentEntry", () => {
    it("returns an empty array when nothing has been stored", () => {
      expect(loadRecentEntries()).toEqual([]);
    });

    it("returns the most recent entry first (LIFO)", () => {
      pushRecentEntry({ path: "a.png", mode: "browser", openedAt: "2026-01-01T00:00:00Z" });
      pushRecentEntry({ path: "b.png", mode: "browser", openedAt: "2026-01-02T00:00:00Z" });
      const entries = loadRecentEntries();
      expect(entries.map((e) => e.path)).toEqual(["b.png", "a.png"]);
    });

    it("dedupes by path — re-opening an image moves it to the front, not duplicates", () => {
      pushRecentEntry({ path: "a.png", mode: "browser", openedAt: "T1" });
      pushRecentEntry({ path: "b.png", mode: "browser", openedAt: "T2" });
      pushRecentEntry({ path: "a.png", mode: "browser", openedAt: "T3" });
      const entries = loadRecentEntries();
      expect(entries.map((e) => e.path)).toEqual(["a.png", "b.png"]);
      // The latest open's timestamp wins.
      expect(entries[0]!.openedAt).toBe("T3");
    });

    it("caps at MAX_ENTRIES (oldest dropped on overflow)", () => {
      for (let i = 0; i < MAX_ENTRIES + 5; i++) {
        pushRecentEntry({
          path: `image-${i}.png`,
          mode: "browser",
          openedAt: `T${i}`,
        });
      }
      const entries = loadRecentEntries();
      expect(entries).toHaveLength(MAX_ENTRIES);
      // The first push (i=0) should be the one dropped — the most-
      // recent push (highest i) is at the front.
      expect(entries[0]!.path).toBe(`image-${MAX_ENTRIES + 4}.png`);
      expect(entries.find((e) => e.path === "image-0.png")).toBeUndefined();
    });

    it("returns [] when the localStorage payload is malformed JSON", () => {
      localStorage.setItem(STORAGE_KEY, "not-json{");
      expect(loadRecentEntries()).toEqual([]);
    });

    it("filters out malformed entries that don't match the RecentEntry shape", () => {
      // Mix valid + invalid in a single payload — the loader should
      // strip the bad ones rather than reject the whole list.
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([
          { path: "ok.png", mode: "browser", openedAt: "T" },
          { path: 42, mode: "browser", openedAt: "T" }, // bad path
          null,
          { mode: "browser", openedAt: "T" }, // missing path
          "not-an-object",
        ]),
      );
      const entries = loadRecentEntries();
      expect(entries.map((e) => e.path)).toEqual(["ok.png"]);
    });
  });

  describe("plugin registration", () => {
    it("registers a 'recent' tab with priority 10 + history icon", () => {
      const host = new PluginHost();
      host.registerAll([recentTabPlugin]);
      const tab = host.findSidebarTab("recent");
      expect(tab).toBeDefined();
      expect(tab?.priority).toBe(10);
      expect(tab?.icon).toEqual({ kind: "builtin", id: "history" });
      expect(tab?.label).toBe("Recent");
    });

    it("onEditorReady dispatch records the opened path in localStorage", () => {
      const host = new PluginHost();
      host.registerAll([recentTabPlugin]);
      // Simulate an editor session opening "img.png".
      host.dispatchEditorReady({ path: "Folder/img.png", tags: {} });
      const entries = loadRecentEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.path).toBe("Folder/img.png");
    });

    it("onEditorReady ignores null paths (unsaved / fresh-capture sessions)", () => {
      const host = new PluginHost();
      host.registerAll([recentTabPlugin]);
      host.dispatchEditorReady({ path: null, tags: {} });
      expect(loadRecentEntries()).toEqual([]);
    });
  });
});
