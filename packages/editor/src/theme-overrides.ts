/**
 * Theme persistence + user-driven token overrides.
 *
 * Public API on top of the `<html class="light">` toggle:
 *
 *   1. `applyPersistedTheme()` — call once at boot to restore the
 *      user's last theme choice + any token overrides BEFORE the
 *      first paint that reads them. The supported modes are
 *      `"system"` / `"light"` / `"dark"`; when no choice has been
 *      persisted the effective default is `"system"`, which
 *      resolves to the current OS `prefers-color-scheme` value and
 *      installs a `matchMedia` listener so OS-level flips take
 *      effect live without a reload.
 *   2. `persistThemeChoice(mode)` / `getPersistedThemeMode()` —
 *      writer + reader for the persisted mode. The Settings dialog
 *      uses both to populate its select and round-trip the user's
 *      choice.
 *   3. `setThemeOverrides(overrides)` / `clearThemeOverrides()` /
 *      `getThemeOverrides()` — runtime API for replacing individual
 *      design tokens. Overrides are inline `--token` properties on
 *      `<html>`, so they win over both `:root` and `:root.light`
 *      regardless of which mode is active.
 *   4. `THEME_TOKEN_NAMES` / `ThemeTokenName` — the public surface
 *      pinning which tokens the override API accepts. Symmetry with
 *      the CSS source-of-truth in
 *      `packages/core/styles/editor.css` is enforced by
 *      `theme-overrides.test.ts` — adding a new token to the CSS
 *      without updating this list (or vice versa) fails the build.
 *
 * The module is intentionally side-effect free at import time:
 * nothing touches `document` or `localStorage` until a function is
 * called. The matchMedia listener is installed lazily by
 * `applyPersistedTheme()` and remains live for the lifetime of the
 * page so subsequent OS flips keep working when the user is in
 * `"system"` mode.
 */

const SURFACE_TOKENS = [
  "bg-primary",
  "bg-secondary",
  "bg-panel",
  "bg-panel-deep",
  "border-color",
  "border-subtle",
  "shadow",
] as const;

const CONTENT_TOKENS = ["text-primary", "text-secondary", "text-muted", "preview-line"] as const;

const ACCENT_TOKENS = [
  "accent",
  "accent-2",
  "accent-bg",
  "accent-hover",
  "active-bg",
  "active-border",
  "chip-bg",
  "focus-ring",
] as const;

const INTERACTION_TOKENS = [
  "hover-bg",
  "hover-border",
  "choice-bg",
  "choice-hover",
  "choice-active",
  "input-bg",
  "input-border",
] as const;

const CANVAS_TOKENS = ["canvas-bg", "canvas-check"] as const;

/**
 * Every overridable design token. Mirrors the `:root` block in
 * `packages/core/styles/editor.css` — the symmetry test in
 * `theme-overrides.test.ts` parses the CSS file and asserts both
 * sides agree.
 *
 * Grouped by section so `docs/design-system.md` and the (future)
 * Settings UI can iterate categories without re-deriving the
 * grouping from naming conventions.
 */
export const THEME_TOKEN_NAMES = [
  ...SURFACE_TOKENS,
  ...CONTENT_TOKENS,
  ...ACCENT_TOKENS,
  ...INTERACTION_TOKENS,
  ...CANVAS_TOKENS,
] as const;

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number];

export type ThemeTokenSection = "surface" | "content" | "accent" | "interaction" | "canvas";

/**
 * Group → tokens map. Keeps `THEME_TOKEN_NAMES` flat (one source
 * of truth for the union type) while giving the Settings UI and
 * docs an iteration order that matches the CSS file.
 */
export const THEME_TOKEN_SECTIONS: Record<ThemeTokenSection, ReadonlyArray<ThemeTokenName>> = {
  surface: SURFACE_TOKENS,
  content: CONTENT_TOKENS,
  accent: ACCENT_TOKENS,
  interaction: INTERACTION_TOKENS,
  canvas: CANVAS_TOKENS,
};

export type ThemeOverrides = Partial<Record<ThemeTokenName, string>>;

/** Persisted theme mode. `"system"` follows the OS-level
 *  `prefers-color-scheme` value live; `"light"` / `"dark"` are
 *  explicit overrides that ignore OS flips. */
export type ThemeMode = "system" | "light" | "dark";

/** Resolved mode that drives the `<html class="light">` toggle.
 *  `"system"` collapses to one of these by reading matchMedia. */
export type EffectiveThemeMode = "light" | "dark";

/** localStorage keys. Centralised so callers and tests can't drift
 *  on the literal. */
export const THEME_STORAGE_KEY = "annot.theme";
export const THEME_OVERRIDES_STORAGE_KEY = "annot.themeOverrides";

const TOKEN_NAME_SET: ReadonlySet<string> = new Set(THEME_TOKEN_NAMES);

function isThemeTokenName(value: string): value is ThemeTokenName {
  return TOKEN_NAME_SET.has(value);
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof globalThis === "undefined") return null;
    const win = (globalThis as { localStorage?: Storage }).localStorage;
    return win ?? null;
  } catch {
    // SecurityError in some embedded contexts (file://, sandboxed iframe)
    return null;
  }
}

function readPersistedMode(): ThemeMode | null {
  const store = safeLocalStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(THEME_STORAGE_KEY);
    if (raw === "system" || raw === "light" || raw === "dark") return raw;
    return null;
  } catch {
    return null;
  }
}

/**
 * Read the persisted mode, defaulting to `"system"` when nothing
 * has been persisted yet. The Settings dialog uses this to
 * populate its select on open; callers that need to distinguish
 * "never picked" from "explicitly picked system" can fall back to
 * the private `readPersistedMode()` if a follow-up ever requires
 * it (none do today).
 */
export function getPersistedThemeMode(): ThemeMode {
  return readPersistedMode() ?? "system";
}

function readPersistedOverrides(): ThemeOverrides {
  const store = safeLocalStorage();
  if (!store) return {};
  try {
    const raw = store.getItem(THEME_OVERRIDES_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: ThemeOverrides = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && isThemeTokenName(key)) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writePersistedOverrides(overrides: ThemeOverrides): void {
  const store = safeLocalStorage();
  if (!store) return;
  try {
    if (Object.keys(overrides).length === 0) {
      store.removeItem(THEME_OVERRIDES_STORAGE_KEY);
      return;
    }
    store.setItem(THEME_OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Quota or SecurityError — overrides survive in-memory for
    // this session only. Not worth surfacing; theme overrides are
    // best-effort UX, not data.
  }
}

function prefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    // No matchMedia (Node / older happy-dom): default the OS preference
    // to dark so the legacy "no class = dark" behaviour is preserved.
    return true;
  }
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return true;
  }
}

function resolveEffectiveMode(mode: ThemeMode): EffectiveThemeMode {
  if (mode === "system") return prefersDark() ? "dark" : "light";
  return mode;
}

function applyEffectiveMode(effective: EffectiveThemeMode): void {
  const root = document.documentElement;
  if (effective === "light") root.classList.add("light");
  else root.classList.remove("light");
}

// matchMedia listener — installed by `applyPersistedTheme()`. The
// listener re-resolves on every OS-level `prefers-color-scheme`
// flip but only mutates the class when the currently-persisted
// mode is `"system"`. Explicit Light / Dark choices keep the
// listener live (it just no-ops) so subsequent switches back to
// "System" work without re-installing.
//
// Keyed on the MediaQueryList instance so production (where
// matchMedia returns a stable object) installs exactly one
// listener, while tests that swap `window.matchMedia` between
// fixtures get a fresh listener on the new mock.
const mediaListsWithListener = new WeakSet<MediaQueryList>();

function installSystemModeListener(): void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  let list: MediaQueryList;
  try {
    list = window.matchMedia("(prefers-color-scheme: dark)");
  } catch {
    return;
  }
  if (mediaListsWithListener.has(list)) return;
  const listener = (): void => {
    const mode = readPersistedMode() ?? "system";
    if (mode !== "system") return;
    applyEffectiveMode(resolveEffectiveMode(mode));
  };
  try {
    list.addEventListener("change", listener);
  } catch {
    // Older Safari / some environments only expose the deprecated
    // `addListener` API. The cast is intentional — TypeScript's lib
    // has removed `addListener` but we still want to call it when
    // present at runtime.
    const legacy = list as unknown as {
      addListener?: (cb: (e: MediaQueryListEvent) => void) => void;
    };
    legacy.addListener?.(listener);
  }
  mediaListsWithListener.add(list);
}

/**
 * Every CSS variable in the design system carries the `--annot-`
 * prefix as of Phase 2 of `docs/plans/design-system-foundations.md`.
 * The override API keeps the short suffix as the public key
 * (`setThemeOverrides({ accent: "..." })`) — only the wire-level
 * `--<name>` translation grows the prefix.
 */
const CSS_VAR_PREFIX = "--annot-";

function applyOverridesToDom(overrides: ThemeOverrides): void {
  const style = document.documentElement.style;
  for (const token of THEME_TOKEN_NAMES) {
    const value = overrides[token];
    const cssName = `${CSS_VAR_PREFIX}${token}`;
    if (value === undefined) {
      style.removeProperty(cssName);
    } else {
      style.setProperty(cssName, value);
    }
  }
}

let cachedOverrides: ThemeOverrides | null = null;

/**
 * Restore persisted theme mode + token overrides. Call once at
 * boot, BEFORE any module that triggers paint depending on
 * theme tokens. In the web host this is the first non-import
 * statement of `packages/web/src/main.ts`.
 *
 * Idempotent — calling more than once just re-applies the
 * current persisted state. Hosts call it a second time after
 * the user updates the theme in the Settings dialog. No-op when
 * `localStorage` is unavailable (file:// schemes, sandboxed
 * iframes).
 *
 * When no theme has been persisted yet, the effective default is
 * `"system"`: the class follows `prefers-color-scheme` and a
 * matchMedia listener is installed so OS-level flips take effect
 * live. Picking explicit Light / Dark in the dialog disables the
 * OS-driven flip without removing the listener (it just stays
 * dormant and resumes work the next time the user picks
 * "System").
 */
export function applyPersistedTheme(): void {
  if (typeof document === "undefined") return;
  const mode = readPersistedMode() ?? "system";
  applyEffectiveMode(resolveEffectiveMode(mode));
  installSystemModeListener();
  const overrides = readPersistedOverrides();
  cachedOverrides = overrides;
  applyOverridesToDom(overrides);
}

/**
 * Persist the user's theme choice. Pass the mode the Settings
 * dialog read off its select. Best-effort — silent no-op when
 * storage is blocked.
 *
 * Callers are expected to follow this with `applyPersistedTheme()`
 * (or a more targeted re-resolve) so the live DOM matches the
 * newly-persisted choice.
 */
export function persistThemeChoice(mode: ThemeMode): void {
  const store = safeLocalStorage();
  if (!store) return;
  try {
    store.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Quota / SecurityError — fall through.
  }
}

/**
 * Read the currently-applied overrides. Returns a fresh shallow
 * copy so callers can mutate it without touching internal state.
 */
export function getThemeOverrides(): ThemeOverrides {
  const overrides = cachedOverrides ?? readPersistedOverrides();
  cachedOverrides = overrides;
  return { ...overrides };
}

/**
 * Merge the given overrides into the active set, persist, and
 * apply to `<html>` immediately.
 *
 * Pass `undefined` for a token to clear that single override
 * (equivalent to `delete overrides[token]`). Unknown token names
 * are ignored — the function only writes properties listed in
 * `THEME_TOKEN_NAMES`. Empty values (`""`) clear the override
 * the same way `undefined` does.
 *
 * Returns the merged override set so callers can chain or log.
 */
export function setThemeOverrides(overrides: ThemeOverrides): ThemeOverrides {
  if (typeof document === "undefined") return {};
  const next = { ...(cachedOverrides ?? readPersistedOverrides()) };
  for (const [key, value] of Object.entries(overrides)) {
    if (!isThemeTokenName(key)) continue;
    if (value === undefined || value === "") {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  cachedOverrides = next;
  applyOverridesToDom(next);
  writePersistedOverrides(next);
  return { ...next };
}

/**
 * Remove every override and clear the persisted entry. Theme
 * mode (`light`/`dark`) is unaffected.
 */
export function clearThemeOverrides(): void {
  if (typeof document === "undefined") return;
  cachedOverrides = {};
  applyOverridesToDom({});
  writePersistedOverrides({});
}
