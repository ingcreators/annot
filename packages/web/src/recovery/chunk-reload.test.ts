// @vitest-environment happy-dom

/**
 * Reactive `vite:preloadError` + `unhandledrejection` recovery
 * handler — single-fire reload, 60-second loop guard, sticky-banner
 * fallback after the loop trips, flush-hook timeout cap, and
 * cross-browser message matching for the `unhandledrejection`
 * fallback path.
 *
 * The module installs its window listeners on import (top-level
 * side effect). We use `_uninstallChunkReloadHandlerForTest` /
 * `_installChunkReloadHandlerForTest` to detach + re-attach between
 * cases so listener state doesn't leak across tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _installChunkReloadHandlerForTest,
  _resetChunkReloadStateForTest,
  _setReloadImpl,
  _uninstallChunkReloadHandlerForTest,
  chunkReloadInProgress,
  consumePostReloadFlag,
  setChunkReloadFlushHook,
  setStickyErrorRenderer,
} from "./chunk-reload.js";

const PENDING_KEY = "annot:chunk-reload-pending";
const RELOAD_KEY = "annot:chunk-reload-at";

function fireVitePreloadError(): void {
  const event = new Event("vite:preloadError", { cancelable: true });
  // Attach a `payload` field the way Vite does, so the source
  // metadata threads through to the handler.
  (event as Event & { payload: unknown }).payload = new Error("preload failed");
  window.dispatchEvent(event);
}

function fireUnhandledRejection(reason: unknown): void {
  const event = new Event("unhandledrejection", { cancelable: true }) as PromiseRejectionEvent;
  Object.defineProperty(event, "reason", { value: reason, configurable: true });
  Object.defineProperty(event, "promise", {
    value: Promise.reject(reason).catch(() => {}),
    configurable: true,
  });
  window.dispatchEvent(event);
}

describe("chunk-reload", () => {
  let reloadSpy: ReturnType<typeof vi.fn>;
  let stickyRenderer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _uninstallChunkReloadHandlerForTest();
    _resetChunkReloadStateForTest();
    sessionStorage.clear();

    reloadSpy = vi.fn();
    _setReloadImpl(reloadSpy as unknown as () => void);

    stickyRenderer = vi.fn();
    setStickyErrorRenderer(stickyRenderer as unknown as (reload: () => void) => void);

    _installChunkReloadHandlerForTest();
  });

  afterEach(() => {
    _uninstallChunkReloadHandlerForTest();
    _resetChunkReloadStateForTest();
    sessionStorage.clear();
    vi.useRealTimers();
  });

  describe("vite:preloadError path", () => {
    it("calls reloadImpl once on a single failure", async () => {
      fireVitePreloadError();
      await new Promise((r) => setTimeout(r, 50));

      expect(reloadSpy).toHaveBeenCalledTimes(1);
      expect(stickyRenderer).not.toHaveBeenCalled();
    });

    it("flips chunkReloadInProgress before reloading so showError can short-circuit", async () => {
      // Block the reload synchronously so we can inspect the flag
      // while the failure is in flight.
      let resolveReload: () => void = () => {};
      reloadSpy.mockImplementation(() => {
        return new Promise<void>((r) => {
          resolveReload = r;
        });
      });

      fireVitePreloadError();
      await new Promise((r) => setTimeout(r, 50));

      // Re-import to read the live binding.
      const { chunkReloadInProgress: live } = await import("./chunk-reload.js");
      expect(live).toBe(true);
      resolveReload();
    });

    it("writes the sessionStorage loop-guard timestamp + pending flag", async () => {
      fireVitePreloadError();
      await new Promise((r) => setTimeout(r, 50));

      const at = sessionStorage.getItem(RELOAD_KEY);
      expect(at).toBeTruthy();
      expect(Number.isFinite(Number(at))).toBe(true);
      expect(sessionStorage.getItem(PENDING_KEY)).toBe("1");
    });

    it("ignores duplicate events while a reload is already in flight", async () => {
      let resolveReload: () => void = () => {};
      reloadSpy.mockImplementation(() => {
        return new Promise<void>((r) => {
          resolveReload = r;
        });
      });

      fireVitePreloadError();
      fireVitePreloadError();
      fireVitePreloadError();
      await new Promise((r) => setTimeout(r, 50));

      expect(reloadSpy).toHaveBeenCalledTimes(1);
      resolveReload();
    });
  });

  describe("loop guard", () => {
    it("falls back to sticky banner when second failure arrives within 60 s", async () => {
      fireVitePreloadError();
      await new Promise((r) => setTimeout(r, 50));
      expect(reloadSpy).toHaveBeenCalledTimes(1);

      // Reset the in-progress flag the way a post-reload boot would
      // — sessionStorage timestamp survives the reload, so the
      // SECOND failure sees `withinLoopWindow()` === true.
      _resetChunkReloadStateForTest();
      // Restore the marker manually (a real reload would preserve
      // sessionStorage; our reset clears it).
      sessionStorage.setItem(RELOAD_KEY, String(Date.now() - 5_000));
      _setReloadImpl(reloadSpy as unknown as () => void);
      setStickyErrorRenderer(stickyRenderer as unknown as (reload: () => void) => void);

      fireVitePreloadError();
      await new Promise((r) => setTimeout(r, 50));

      // Did not reload again.
      expect(reloadSpy).toHaveBeenCalledTimes(1);
      // Did render the sticky banner.
      expect(stickyRenderer).toHaveBeenCalledTimes(1);
      // Sticky renderer received a reload callback; invoking it
      // doesn't trip our test reloadImpl because the renderer's
      // callback uses the production `window.location.reload`.
    });

    it("triggers reload again when the second failure arrives AFTER 60 s", async () => {
      fireVitePreloadError();
      await new Promise((r) => setTimeout(r, 50));
      expect(reloadSpy).toHaveBeenCalledTimes(1);

      // Simulate post-reload state with a marker > 60 s old.
      _resetChunkReloadStateForTest();
      sessionStorage.setItem(RELOAD_KEY, String(Date.now() - 70_000));
      _setReloadImpl(reloadSpy as unknown as () => void);
      setStickyErrorRenderer(stickyRenderer as unknown as (reload: () => void) => void);

      fireVitePreloadError();
      await new Promise((r) => setTimeout(r, 50));

      expect(reloadSpy).toHaveBeenCalledTimes(2);
      expect(stickyRenderer).not.toHaveBeenCalled();
    });

    it("after the loop guard trips, ALL subsequent failures render the sticky banner (no oscillation)", async () => {
      fireVitePreloadError();
      await new Promise((r) => setTimeout(r, 50));

      _resetChunkReloadStateForTest();
      sessionStorage.setItem(RELOAD_KEY, String(Date.now() - 5_000));
      _setReloadImpl(reloadSpy as unknown as () => void);
      setStickyErrorRenderer(stickyRenderer as unknown as (reload: () => void) => void);

      // Loop-detection event #1
      fireVitePreloadError();
      await new Promise((r) => setTimeout(r, 50));
      expect(stickyRenderer).toHaveBeenCalledTimes(1);

      // Subsequent failures — still no reload, just more banner calls
      fireVitePreloadError();
      fireVitePreloadError();
      await new Promise((r) => setTimeout(r, 50));

      expect(reloadSpy).toHaveBeenCalledTimes(1);
      expect(stickyRenderer.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("unhandledrejection fallback", () => {
    it("matches Chromium 'Failed to fetch dynamically imported module'", async () => {
      fireUnhandledRejection(new TypeError("Failed to fetch dynamically imported module: foo.js"));
      await new Promise((r) => setTimeout(r, 50));
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it("matches Safari 'error loading dynamically imported module'", async () => {
      fireUnhandledRejection(new Error("error loading dynamically imported module"));
      await new Promise((r) => setTimeout(r, 50));
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it("matches Firefox 'Importing a module script failed'", async () => {
      fireUnhandledRejection(new Error("Importing a module script failed."));
      await new Promise((r) => setTimeout(r, 50));
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it("matches a string reason (non-Error rejection)", async () => {
      fireUnhandledRejection("Failed to fetch dynamically imported module: bar.js");
      await new Promise((r) => setTimeout(r, 50));
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it("ignores unrelated rejections", async () => {
      fireUnhandledRejection(new Error("Quota exceeded"));
      fireUnhandledRejection(new TypeError("Failed to fetch")); // generic fetch error
      fireUnhandledRejection({ banana: true });
      await new Promise((r) => setTimeout(r, 50));
      expect(reloadSpy).not.toHaveBeenCalled();
    });
  });

  describe("flush hook", () => {
    it("awaits the flush hook before reloading", async () => {
      let flushResolved = false;
      const flushHook = vi.fn(
        () =>
          new Promise<void>((r) => {
            setTimeout(() => {
              flushResolved = true;
              r();
            }, 100);
          }),
      );
      setChunkReloadFlushHook(flushHook as () => Promise<void>);

      fireVitePreloadError();
      // Wait for the flush + reload to play out.
      await new Promise((r) => setTimeout(r, 200));

      expect(flushHook).toHaveBeenCalledTimes(1);
      expect(flushResolved).toBe(true);
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it("caps the flush wait at 1500 ms so a stuck flush doesn't block reload", async () => {
      // Flush hook that never resolves.
      setChunkReloadFlushHook(() => new Promise<void>(() => {}));

      const start = Date.now();
      fireVitePreloadError();
      // Allow time for the cap to elapse + the reload to fire.
      await new Promise((r) => setTimeout(r, 1700));
      const elapsed = Date.now() - start;

      expect(reloadSpy).toHaveBeenCalledTimes(1);
      // The 1500 ms cap is the floor; some scheduler slack is OK.
      expect(elapsed).toBeGreaterThanOrEqual(1500);
      expect(elapsed).toBeLessThan(2500);
    });

    it("swallows flush errors so the reload still fires", async () => {
      setChunkReloadFlushHook(() => Promise.reject(new Error("flush boom")));

      fireVitePreloadError();
      await new Promise((r) => setTimeout(r, 100));

      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("consumePostReloadFlag", () => {
    it("returns true exactly once when the flag is set, then false", () => {
      sessionStorage.setItem(PENDING_KEY, "1");
      expect(consumePostReloadFlag()).toBe(true);
      expect(consumePostReloadFlag()).toBe(false);
    });

    it("returns false when the flag is absent", () => {
      expect(consumePostReloadFlag()).toBe(false);
    });

    it("clears the flag from sessionStorage on read", () => {
      sessionStorage.setItem(PENDING_KEY, "1");
      consumePostReloadFlag();
      expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    });
  });

  describe("module exports", () => {
    it("chunkReloadInProgress starts false on a fresh boot", () => {
      // Re-read via the import in this test file; reset by beforeEach.
      expect(chunkReloadInProgress).toBe(false);
    });
  });
});
