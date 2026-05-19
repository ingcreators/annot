/**
 * Visibility-driven build-version poller.
 *
 * When a new deploy lands, the CDN serves a new `/version.txt`
 * value. This module compares that against the bundled
 * `__APP_VERSION__` and notifies its caller exactly once when they
 * diverge. The caller (typically `App.init`) shows a persistent
 * "A new version is available" banner with a Reload action.
 *
 * Design choices:
 *
 *   - **Event-driven only, no `setInterval`.** Polling on a timer
 *     keeps idle background tabs awake and chews battery / quota
 *     for no real-time benefit. Visibility transitions, bfcache
 *     restore (`pageshow`), and a single 30 s post-boot check
 *     cover the realistic "user returned to the tab" scenarios.
 *
 *   - **Single-fire.** Once `onNewVersion` has been called once we
 *     stop polling — there's nothing useful left to detect, the
 *     banner is already up.
 *
 *   - **Silent on failure.** Network errors / 404s during a
 *     mid-deploy race / offline state all early-return. The
 *     reactive `vite:preloadError` net (Phase 2) catches the
 *     actual chunk failure if the user keeps interacting.
 *
 *   - **Dev mode is silent.** `__APP_VERSION__` starts with `dev-`
 *     in `vite dev`; we skip every fetch.
 *
 * See `docs/plans/web-dynamic-import-recovery.md`.
 */

import { APP_VERSION, isDevVersion } from "./app-version.js";

// `import.meta.env.BASE_URL` propagates Vite's `base` config to
// runtime — when the PWA serves at `/app/`, the version file is
// at `/app/version.txt`. The trailing-slash form of BASE_URL is
// already what we want for path concatenation here.
const VERSION_URL = `${import.meta.env.BASE_URL}version.txt`;
const INITIAL_CHECK_DELAY_MS = 30_000;

export interface VersionPollerOptions {
  /** Called exactly once when the server reports a version that
   *  differs from `__APP_VERSION__`. The poller stops checking
   *  after this fires. */
  onNewVersion: (remoteVersion: string) => void;
}

/** Starts the poller. Returns a teardown function that detaches the
 *  visibility / pageshow listeners. */
export function startVersionPolling(opts: VersionPollerOptions): () => void {
  if (isDevVersion()) {
    // No baseline to compare against — every reload would tick the
    // dev-mode sentinel and produce a false positive.
    return () => {};
  }

  let fired = false;

  const check = async (): Promise<void> => {
    if (fired) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    try {
      const res = await fetch(VERSION_URL, { cache: "no-store" });
      if (!res.ok) return; // 404 mid-deploy race; try again next event
      const remote = (await res.text()).trim();
      if (!remote || remote === APP_VERSION) return;
      fired = true;
      opts.onNewVersion(remote);
    } catch {
      // Offline / network error — silent. The reactive net will
      // catch the real failure if the user triggers a dynamic
      // import.
    }
  };

  const onVisibilityChange = (): void => {
    void check();
  };
  const onPageShow = (): void => {
    void check();
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pageshow", onPageShow);
  const initialTimer = window.setTimeout(() => {
    void check();
  }, INITIAL_CHECK_DELAY_MS);

  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pageshow", onPageShow);
    window.clearTimeout(initialTimer);
  };
}
