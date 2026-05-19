/**
 * Reactive safety net for dynamic-import failures.
 *
 * Cloudflare Workers Static Assets replaces the whole `dist/`
 * asset bucket on each deploy, so any chunk hashed under
 * `dist/assets/[name]-[hash].js` 404s the moment a new deploy
 * lands. A tab still running an old `index.html` then explodes the
 * first time it tries to `import("...")` something — the user sees
 * a cryptic save-error toast and has no way forward except a hard
 * manual reload.
 *
 * This module installs (at top-level side effect, ON IMPORT) a
 * pair of global listeners that catch those failures and auto-
 * reload the page after flushing pending saves. A 60-second
 * sessionStorage timestamp guard prevents reload loops: if the
 * second failure comes within the window, we surface a sticky
 * error bar with a manual Reload button instead.
 *
 * Phase 2 of `docs/plans/web-dynamic-import-recovery.md`.
 * Phase 1 (proactive `/version.txt` poller) lives in
 * `version-poller.ts`.
 *
 * ----- Wiring -----
 *
 * The listener installs at module load time. `main.ts` imports
 * this module FIRST (before CSS, theme restore, or `new App()`),
 * so the listener is wired before any other initialisation can
 * itself trigger a dynamic import.
 *
 * `App.init` calls `setChunkReloadFlushHook(...)` to register the
 * `SavePipeline.flushPending()` bridge — we can't import `App`
 * here (would create a cycle), so the flush callback is passed in
 * via a setter and stored in a module-level slot.
 *
 * `showError` in `ui/error-bar.ts` short-circuits on
 * `chunkReloadInProgress` so the 33+ per-call-site `showSaveError`
 * toasts that the local `try/catch` blocks emit during the
 * imminent reload don't flash on screen.
 *
 * ----- Browser support matrix -----
 *
 * Vite emits `vite:preloadError` for failed module-preload requests
 * triggered by its `__vitePreload` helper (the runtime that
 * `import("...")` compiles to). We listen for it as the canonical
 * signal.
 *
 * For corner cases that bypass `vite:preloadError` (e.g. nested
 * dynamic imports inside third-party libraries, edge browser
 * variants), we also listen for `unhandledrejection` and string-
 * match the three known cross-browser chunk-load error messages:
 *
 *   - Chromium: "Failed to fetch dynamically imported module"
 *   - Safari:   "error loading dynamically imported module"
 *   - Firefox:  "Importing a module script failed"
 *
 * The matchers are full phrases — false-positive risk against
 * generic "Failed to fetch" / network errors is negligible.
 */

const RELOAD_KEY = "annot:chunk-reload-at";
const PENDING_KEY = "annot:chunk-reload-pending";
const LOOP_WINDOW_MS = 60_000;
const FLUSH_TIMEOUT_MS = 1500;

const CHUNK_LOAD_ERROR_MATCHERS: readonly string[] = [
  "Failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "Importing a module script failed",
];

/** Exported for `ui/error-bar.ts` — flipped to `true` the moment a
 *  chunk failure is detected so per-call-site `showSaveError`
 *  toasts don't flash on screen during the reload. Importers MUST
 *  read this dynamically (`if (chunkReloadInProgress) ...`) — the
 *  ESM live-binding contract guarantees they see the up-to-date
 *  value even though they captured it at import time. */
export let chunkReloadInProgress = false;

/** Once the loop guard trips, every subsequent failure in this tab
 *  goes straight to the sticky error bar — we never auto-reload
 *  again until the user manually clicks Reload. Prevents the
 *  "loop detected → cleared marker → next failure reloads again"
 *  oscillation. */
let manualReloadRequired = false;

type FlushHook = () => Promise<void> | void;
let flushHook: FlushHook | null = null;

/** Called by `App.init` to plumb `SavePipeline.flushPending()` into
 *  the recovery path. Importing `App` here would cycle. */
export function setChunkReloadFlushHook(hook: FlushHook): void {
  flushHook = hook;
}

/** Called by the post-reload boot to surface "Updated to new
 *  version" once. Returns `true` exactly once per post-reload load,
 *  then `false` for subsequent calls within the same tab. */
export function consumePostReloadFlag(): boolean {
  try {
    const value = sessionStorage.getItem(PENDING_KEY);
    if (value === "1") {
      sessionStorage.removeItem(PENDING_KEY);
      return true;
    }
  } catch {
    // sessionStorage may be unavailable in some privacy modes; the
    // banner is best-effort.
  }
  return false;
}

function looksLikeChunkLoadError(reason: unknown): boolean {
  // `unhandledrejection.reason` is usually an Error; sometimes it's
  // a string. Cover both.
  const message =
    typeof reason === "string"
      ? reason
      : reason && typeof reason === "object" && "message" in reason
        ? String((reason as { message: unknown }).message ?? "")
        : "";
  if (!message) return false;
  return CHUNK_LOAD_ERROR_MATCHERS.some((m) => message.includes(m));
}

function withinLoopWindow(): boolean {
  try {
    const raw = sessionStorage.getItem(RELOAD_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < LOOP_WINDOW_MS;
  } catch {
    return false;
  }
}

function markReloadAttempt(): void {
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    sessionStorage.setItem(PENDING_KEY, "1");
  } catch {
    // Best-effort — without sessionStorage we lose the loop guard,
    // but the reload itself still works.
  }
}

function clearReloadMarker(): void {
  try {
    sessionStorage.removeItem(RELOAD_KEY);
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // No-op.
  }
}

async function flushWithCap(): Promise<void> {
  if (!flushHook) return;
  try {
    await Promise.race([
      Promise.resolve().then(() => flushHook?.()),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, FLUSH_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // We're about to reload — swallow any flush error so the
    // reload still fires.
  }
}

/** Visible-for-testing hook so the unit tests can override the
 *  reload call without monkey-patching `window.location`, which is
 *  read-only in jsdom / happy-dom. */
let reloadImpl: () => void = () => {
  window.location.reload();
};

/** @internal — test hook. */
export function _setReloadImpl(impl: () => void): void {
  reloadImpl = impl;
}

/** @internal — test hook to reset module state between cases. */
export function _resetChunkReloadStateForTest(): void {
  chunkReloadInProgress = false;
  manualReloadRequired = false;
  flushHook = null;
  stickyErrorRenderer = null;
  clearReloadMarker();
  reloadImpl = () => {
    window.location.reload();
  };
}

type FailureSource = "vite-preload-error" | "unhandled-rejection";

let stickyErrorRenderer: ((reload: () => void) => void) | null = null;

/** Optional renderer the recovery module calls when a reload loop
 *  is detected. `ui/error-bar.ts` registers itself via
 *  `setStickyErrorRenderer` to avoid this module importing the
 *  error bar (which would force `error-bar.ts` into the eager
 *  module graph that runs BEFORE the recovery handler installs). */
export function setStickyErrorRenderer(renderer: (reload: () => void) => void): void {
  stickyErrorRenderer = renderer;
}

function renderManualReloadBanner(source: FailureSource, reason: unknown): void {
  if (stickyErrorRenderer) {
    stickyErrorRenderer(() => window.location.reload());
  } else {
    // Fallback if `App.init` hasn't run yet (recovery handler
    // installed but error-bar renderer not yet registered) — log
    // so a user reporting "I clicked something and nothing
    // happened" has a breadcrumb.
    console.error("[annot:chunk-reload] reload loop detected; please reload manually", {
      source,
      reason,
    });
  }
}

async function handleChunkFailure(source: FailureSource, reason: unknown): Promise<void> {
  if (chunkReloadInProgress) return; // de-dupe rapid double-fires

  // Once we've fallen back to manual reload (loop guard already
  // tripped earlier this session), every subsequent failure goes
  // straight to the sticky banner — never auto-reload again.
  if (manualReloadRequired) {
    renderManualReloadBanner(source, reason);
    return;
  }

  // Per-tab loop guard — second failure within 60 s means the new
  // bundle is also broken (or `version.txt` is stuck at the edge).
  // Trip the manual-reload latch so subsequent failures don't
  // re-enter the reload path.
  if (withinLoopWindow()) {
    manualReloadRequired = true;
    clearReloadMarker();
    renderManualReloadBanner(source, reason);
    return;
  }

  chunkReloadInProgress = true;
  markReloadAttempt();
  await flushWithCap();
  reloadImpl();
}

function onVitePreloadError(event: Event): void {
  event.preventDefault();
  const payload =
    event && typeof event === "object" && "payload" in event
      ? (event as { payload?: unknown }).payload
      : event;
  void handleChunkFailure("vite-preload-error", payload);
}

function onUnhandledRejection(event: PromiseRejectionEvent): void {
  if (!looksLikeChunkLoadError(event.reason)) return;
  event.preventDefault();
  void handleChunkFailure("unhandled-rejection", event.reason);
}

/** Installed at module load time as a top-level side effect. */
function installChunkReloadHandler(): void {
  // Guard against double-install — `chunk-reload.ts` is imported
  // from `main.ts` (boot side effect) and from `error-bar.ts` (to
  // read `chunkReloadInProgress`). Module-level `let` ensures only
  // one shared instance, but the listener attach itself is also
  // idempotent for safety in test environments that re-evaluate
  // the module.
  if (installedFlag) return;
  installedFlag = true;
  window.addEventListener("vite:preloadError", onVitePreloadError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
}

let installedFlag = false;

// Side-effect install. Importing this module wires the listeners.
if (typeof window !== "undefined") {
  installChunkReloadHandler();
}

/** @internal — test hook so tests can re-install after a reset. */
export function _installChunkReloadHandlerForTest(): void {
  installedFlag = false;
  installChunkReloadHandler();
}

/** @internal — test hook to detach listeners between cases. */
export function _uninstallChunkReloadHandlerForTest(): void {
  if (typeof window === "undefined") return;
  window.removeEventListener("vite:preloadError", onVitePreloadError);
  window.removeEventListener("unhandledrejection", onUnhandledRejection);
  installedFlag = false;
}
