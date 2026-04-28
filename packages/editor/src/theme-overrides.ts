/**
 * Theme persistence + user-driven token overrides.
 *
 * Phase 1 of `docs/plans/design-system-foundations.md` exposes
 * three pieces of public API on top of the existing
 * `<html class="light">` toggle:
 *
 *   1. `applyPersistedTheme()` — call once at boot to restore the
 *      user's last theme choice + any token overrides BEFORE the
 *      first paint that reads them.
 *   2. `setThemeOverrides(overrides)` / `clearThemeOverrides()` /
 *      `getThemeOverrides()` — runtime API for replacing individual
 *      design tokens. Overrides are inline `--token` properties on
 *      `<html>`, so they win over both `:root` and `:root.light`
 *      regardless of which mode is active.
 *   3. `THEME_TOKEN_NAMES` / `ThemeTokenName` — the public surface
 *      pinning which tokens the override API accepts. Symmetry with
 *      the CSS source-of-truth in
 *      `packages/core/styles/editor.css` is enforced by
 *      `theme-overrides.test.ts` — adding a new token to the CSS
 *      without updating this list (or vice versa) fails the build.
 *
 * The module is intentionally tiny and side-effect free at import
 * time: nothing touches `document` or `localStorage` until a
 * function is called. The only cross-module coupling is that
 * `theme-toggle.ts` calls `persistThemeChoice()` after flipping
 * the class, so the toggle button's behaviour rolls forward as a
 * single observable change.
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

const CONTENT_TOKENS = [
  "text-primary",
  "text-secondary",
  "text-muted",
  "preview-line",
] as const;

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

export type ThemeTokenSection =
  | "surface"
  | "content"
  | "accent"
  | "interaction"
  | "canvas";

/**
 * Group → tokens map. Keeps `THEME_TOKEN_NAMES` flat (one source
 * of truth for the union type) while giving the Settings UI and
 * docs an iteration order that matches the CSS file.
 */
export const THEME_TOKEN_SECTIONS: Record<
  ThemeTokenSection,
  ReadonlyArray<ThemeTokenName>
> = {
  surface: SURFACE_TOKENS,
  content: CONTENT_TOKENS,
  accent: ACCENT_TOKENS,
  interaction: INTERACTION_TOKENS,
  canvas: CANVAS_TOKENS,
};

export type ThemeOverrides = Partial<Record<ThemeTokenName, string>>;

export type ThemeMode = "light" | "dark";

/** localStorage keys. Centralised so `theme-toggle.ts` and tests
 * can't drift on the literal. */
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
    if (raw === "light" || raw === "dark") return raw;
    return null;
  } catch {
    return null;
  }
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

function applyMode(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "light") root.classList.add("light");
  else root.classList.remove("light");
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
 * current persisted state. No-op when `localStorage` is
 * unavailable (file:// schemes, sandboxed iframes).
 */
export function applyPersistedTheme(): void {
  if (typeof document === "undefined") return;
  const mode = readPersistedMode();
  if (mode) applyMode(mode);
  const overrides = readPersistedOverrides();
  cachedOverrides = overrides;
  applyOverridesToDom(overrides);
}

/**
 * Persist the current theme mode. Called by
 * `createThemeToggle`'s click handler after toggling the class.
 *
 * Reads the live class state rather than taking a parameter so
 * callers can't drift from the actual DOM truth. Best-effort —
 * silent no-op when storage is blocked.
 */
export function persistThemeChoice(): void {
  if (typeof document === "undefined") return;
  const mode: ThemeMode = document.documentElement.classList.contains("light")
    ? "light"
    : "dark";
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
export function setThemeOverrides(
  overrides: ThemeOverrides,
): ThemeOverrides {
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
