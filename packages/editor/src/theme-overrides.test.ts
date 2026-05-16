/**
 * @vitest-environment happy-dom
 *
 * Phase 1 of `docs/plans/design-system-foundations.md`. Three
 * concerns:
 *
 *   1. **Symmetry between CSS and TS.** The single source of truth
 *      for design tokens is `packages/core/styles/editor.css` —
 *      `THEME_TOKEN_NAMES` mirrors that block. If anyone adds a
 *      `--token` to the CSS without exporting it (or removes it
 *      from one side without the other), the build should fail.
 *
 *   2. **Override application.** `setThemeOverrides({ accent: "#abc" })`
 *      writes inline styles on `<html>` so it wins against any
 *      `:root` rule, regardless of light/dark mode.
 *
 *   3. **Persistence round-trip.** Both the mode (`light`/`dark`)
 *      and the override map survive an `applyPersistedTheme()`
 *      call after page reload (simulated by clearing in-memory
 *      caches and re-reading from `localStorage`).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Read the canonical token CSS at test load. The editor package
// can't import CSS modules in vitest's CSS-aware mode (Vite's CSS
// plugin returns an empty default export for `?raw` and `?inline`
// on stylesheet files), so we fall back to a direct filesystem
// read. Vitest runs from the repo root (`process.cwd()`); resolve
// relative to that.
const editorCss = readFileSync(resolve(process.cwd(), "packages/core/styles/editor.css"), "utf8");

import {
  applyPersistedTheme,
  clearThemeOverrides,
  getPersistedThemeMode,
  getThemeOverrides,
  persistThemeChoice,
  setThemeOverrides,
  THEME_OVERRIDES_STORAGE_KEY,
  THEME_STORAGE_KEY,
  THEME_TOKEN_NAMES,
  THEME_TOKEN_SECTIONS,
  type ThemeTokenName,
} from "./theme-overrides.js";

// Mock matchMedia per-test so we can drive the OS preference + fire
// change events deterministically. happy-dom ships a matchMedia
// stub but it doesn't dispatch change events, so we replace it
// entirely.
interface FakeMediaQueryList {
  matches: boolean;
  media: string;
  onchange: ((e: MediaQueryListEvent) => void) | null;
  addEventListener(type: "change", cb: (e: MediaQueryListEvent) => void): void;
  removeEventListener(type: "change", cb: (e: MediaQueryListEvent) => void): void;
  dispatchEvent(e: MediaQueryListEvent): boolean;
  addListener(cb: (e: MediaQueryListEvent) => void): void;
  removeListener(cb: (e: MediaQueryListEvent) => void): void;
}

function makeFakeMediaQueryList(initialMatches: boolean): FakeMediaQueryList {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql: FakeMediaQueryList = {
    matches: initialMatches,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener(_type, cb) {
      listeners.add(cb);
    },
    removeEventListener(_type, cb) {
      listeners.delete(cb);
    },
    dispatchEvent(e) {
      for (const cb of listeners) cb(e);
      return true;
    },
    addListener(cb) {
      listeners.add(cb);
    },
    removeListener(cb) {
      listeners.delete(cb);
    },
  };
  return mql;
}

let fakeMql: FakeMediaQueryList | null = null;
const originalMatchMedia = (globalThis as { matchMedia?: (q: string) => MediaQueryList })
  .matchMedia;

function installFakeMatchMedia(initialDarkMatches: boolean): FakeMediaQueryList {
  fakeMql = makeFakeMediaQueryList(initialDarkMatches);
  (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (() =>
    fakeMql as unknown as MediaQueryList) as (q: string) => MediaQueryList;
  return fakeMql;
}

function flipFakeOs(dark: boolean): void {
  if (!fakeMql) return;
  fakeMql.matches = dark;
  fakeMql.dispatchEvent(new Event("change") as MediaQueryListEvent);
}

/**
 * Extract `--token-name` declarations from a `:root { ... }` block.
 * Walks character-by-character to find the matching closing brace
 * so we don't need to worry about CRLF, comments containing `}`,
 * or other regex edge cases.
 */
function extractTokenNamesFromRootBlock(
  css: string,
  selector: ":root" | ":root.light",
): Set<string> {
  // Find a `^selector\s*{` style match anchored to the start of a line.
  // For `:root`, exclude `:root.light` matches by requiring the next
  // non-whitespace char after `:root` to be `{` (and not `.`).
  const lines = css.split(/\r?\n/);
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (selector === ":root.light") {
      if (/^\s*:root\.light\s*\{/.test(line)) {
        startLine = i;
        break;
      }
    } else {
      if (/^\s*:root\s*\{/.test(line)) {
        startLine = i;
        break;
      }
    }
  }
  if (startLine === -1) {
    throw new Error(`Could not find ${selector} block in editor.css`);
  }
  // Walk forward until a line that starts with `}`.
  const bodyLines: string[] = [];
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s*\}/.test(line)) break;
    bodyLines.push(line);
  }
  const body = bodyLines.join("\n");
  const names = new Set<string>();
  // Phase 2 of `design-system-foundations.md` namespaced every CSS
  // variable as `--annot-<token>`. The override API keeps the short
  // suffix (`accent`, not `annot-accent`) as the public key, so
  // strip the prefix here before comparing against
  // `THEME_TOKEN_NAMES`.
  const re = /--annot-([a-z][a-z0-9-]*)\s*:/g;
  let m: RegExpExecArray | null;
  m = re.exec(body);
  while (m !== null) {
    names.add(m[1]!);
    m = re.exec(body);
  }
  return names;
}

beforeEach(() => {
  // Each test starts from a clean DOM + storage so order doesn't
  // matter and one test's overrides don't leak into the next.
  document.documentElement.removeAttribute("style");
  document.documentElement.classList.remove("light");
  globalThis.localStorage?.clear();
  fakeMql = null;
});

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.documentElement.classList.remove("light");
  globalThis.localStorage?.clear();
  // Restore matchMedia so the next test starts from a known state.
  if (originalMatchMedia) {
    (window as unknown as { matchMedia: typeof originalMatchMedia }).matchMedia =
      originalMatchMedia;
  } else {
    delete (window as unknown as { matchMedia?: typeof originalMatchMedia }).matchMedia;
  }
  fakeMql = null;
});

describe("THEME_TOKEN_NAMES <-> editor.css symmetry", () => {
  const cssDarkTokens = extractTokenNamesFromRootBlock(editorCss, ":root");
  const cssLightTokens = extractTokenNamesFromRootBlock(editorCss, ":root.light");
  const tsTokens = new Set<string>(THEME_TOKEN_NAMES);

  it(":root and :root.light declare the same token set", () => {
    const onlyInDark = [...cssDarkTokens].filter((t) => !cssLightTokens.has(t));
    const onlyInLight = [...cssLightTokens].filter((t) => !cssDarkTokens.has(t));
    expect(onlyInDark).toEqual([]);
    expect(onlyInLight).toEqual([]);
  });

  it("THEME_TOKEN_NAMES exactly mirrors editor.css :root", () => {
    const onlyInCss = [...cssDarkTokens].filter((t) => !tsTokens.has(t));
    const onlyInTs = [...tsTokens].filter((t) => !cssDarkTokens.has(t));
    expect(onlyInCss).toEqual([]);
    expect(onlyInTs).toEqual([]);
  });

  it("THEME_TOKEN_SECTIONS partitions THEME_TOKEN_NAMES", () => {
    const sectioned = Object.values(THEME_TOKEN_SECTIONS).flat();
    expect(new Set(sectioned)).toEqual(new Set(THEME_TOKEN_NAMES));
    expect(sectioned.length).toBe(THEME_TOKEN_NAMES.length);
  });
});

describe("setThemeOverrides", () => {
  it("writes inline custom properties on <html>", () => {
    setThemeOverrides({ accent: "#ff00aa", "bg-primary": "#101010" });
    expect(document.documentElement.style.getPropertyValue("--annot-accent")).toBe("#ff00aa");
    expect(document.documentElement.style.getPropertyValue("--annot-bg-primary")).toBe("#101010");
  });

  it("merges instead of replacing", () => {
    setThemeOverrides({ accent: "#aaa" });
    setThemeOverrides({ "bg-primary": "#bbb" });
    expect(document.documentElement.style.getPropertyValue("--annot-accent")).toBe("#aaa");
    expect(document.documentElement.style.getPropertyValue("--annot-bg-primary")).toBe("#bbb");
  });

  it("treats undefined / empty string as a clear", () => {
    setThemeOverrides({ accent: "#aaa" });
    setThemeOverrides({ accent: "" });
    expect(document.documentElement.style.getPropertyValue("--annot-accent")).toBe("");
  });

  it("ignores unknown token names", () => {
    setThemeOverrides({
      "totally-not-a-token": "#ff0000",
    } as unknown as Parameters<typeof setThemeOverrides>[0]);
    expect(document.documentElement.style.getPropertyValue("--totally-not-a-token")).toBe("");
  });

  it("persists overrides to localStorage", () => {
    setThemeOverrides({ accent: "#dd00dd" });
    const raw = globalThis.localStorage.getItem(THEME_OVERRIDES_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw ?? "{}") as Record<string, string>;
    expect(parsed["accent"]).toBe("#dd00dd");
  });
});

describe("clearThemeOverrides", () => {
  it("removes inline styles + storage entry", () => {
    setThemeOverrides({ accent: "#dd00dd", "bg-primary": "#101010" });
    clearThemeOverrides();
    expect(document.documentElement.style.getPropertyValue("--annot-accent")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--annot-bg-primary")).toBe("");
    expect(globalThis.localStorage.getItem(THEME_OVERRIDES_STORAGE_KEY)).toBeNull();
  });
});

describe("applyPersistedTheme", () => {
  it("restores light-mode class from storage", () => {
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, "light");
    applyPersistedTheme();
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("restores dark mode (no class) when persisted as dark", () => {
    document.documentElement.classList.add("light");
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    applyPersistedTheme();
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("defaults to system mode when nothing is persisted (OS dark → no class)", () => {
    installFakeMatchMedia(true);
    document.documentElement.classList.add("light");
    applyPersistedTheme();
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("defaults to system mode when nothing is persisted (OS light → light class)", () => {
    installFakeMatchMedia(false);
    document.documentElement.classList.remove("light");
    applyPersistedTheme();
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("resolves explicit system mode against the OS preference", () => {
    installFakeMatchMedia(false);
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, "system");
    applyPersistedTheme();
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("re-applies persisted overrides after a 'reload'", () => {
    setThemeOverrides({ accent: "#cc00ff" });
    // Simulate a reload: drop in-memory caches, scrub the DOM,
    // then re-boot via applyPersistedTheme.
    document.documentElement.removeAttribute("style");
    expect(document.documentElement.style.getPropertyValue("--annot-accent")).toBe("");
    applyPersistedTheme();
    expect(document.documentElement.style.getPropertyValue("--annot-accent")).toBe("#cc00ff");
  });

  it("survives malformed JSON in storage without throwing", () => {
    globalThis.localStorage.setItem(THEME_OVERRIDES_STORAGE_KEY, "{not valid json");
    expect(() => applyPersistedTheme()).not.toThrow();
    expect(getThemeOverrides()).toEqual({});
  });
});

describe("matchMedia listener (system mode)", () => {
  it("flips the class when OS preference changes AND mode is system", () => {
    installFakeMatchMedia(true);
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, "system");
    applyPersistedTheme();
    expect(document.documentElement.classList.contains("light")).toBe(false);
    flipFakeOs(false);
    expect(document.documentElement.classList.contains("light")).toBe(true);
    flipFakeOs(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("ignores OS-preference changes when an explicit mode is persisted", () => {
    installFakeMatchMedia(true);
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, "light");
    applyPersistedTheme();
    expect(document.documentElement.classList.contains("light")).toBe(true);
    flipFakeOs(false);
    // Explicit light wins; OS flip is a no-op.
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("resumes responding to OS flips when the user re-enters system mode", () => {
    installFakeMatchMedia(true);
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, "light");
    applyPersistedTheme();
    expect(document.documentElement.classList.contains("light")).toBe(true);
    // User switches back to system in the Settings dialog.
    persistThemeChoice("system");
    applyPersistedTheme();
    expect(document.documentElement.classList.contains("light")).toBe(false);
    flipFakeOs(false);
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });
});

describe("persistThemeChoice", () => {
  it("writes the supplied mode to localStorage", () => {
    persistThemeChoice("light");
    expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    persistThemeChoice("dark");
    expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    persistThemeChoice("system");
    expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });
});

describe("getPersistedThemeMode", () => {
  it("returns the persisted mode verbatim", () => {
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(getPersistedThemeMode()).toBe("light");
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(getPersistedThemeMode()).toBe("dark");
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, "system");
    expect(getPersistedThemeMode()).toBe("system");
  });

  it("defaults to system when nothing is persisted", () => {
    expect(getPersistedThemeMode()).toBe("system");
  });

  it("treats unknown stored values as system (corrupted storage)", () => {
    globalThis.localStorage.setItem(THEME_STORAGE_KEY, "purple");
    expect(getPersistedThemeMode()).toBe("system");
  });
});

describe("getThemeOverrides", () => {
  it("returns a fresh object each call", () => {
    setThemeOverrides({ accent: "#aaa" });
    const a = getThemeOverrides();
    const b = getThemeOverrides();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("does not let external mutation leak into the cache", () => {
    setThemeOverrides({ accent: "#aaa" });
    const snapshot = getThemeOverrides();
    (snapshot as Record<ThemeTokenName, string>)["bg-primary"] = "#000000";
    expect(getThemeOverrides()).toEqual({ accent: "#aaa" });
  });
});
