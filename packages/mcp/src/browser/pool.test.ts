import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { type BrowserLauncher, type BrowserLike, BrowserPool } from "./pool.js";

function makeLauncher(): {
  launcher: BrowserLauncher;
  launchSpy: ReturnType<typeof vi.fn>;
  closeSpy: ReturnType<typeof vi.fn>;
} {
  const closeSpy = vi.fn(async () => {});
  const launchSpy = vi.fn(async () => ({ close: closeSpy }) as BrowserLike);
  return { launcher: { launch: launchSpy }, launchSpy, closeSpy };
}

describe("BrowserPool", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("launches lazily on first acquire", async () => {
    const { launcher, launchSpy } = makeLauncher();
    const pool = new BrowserPool(launcher);
    expect(launchSpy).not.toHaveBeenCalled();
    expect(pool.isLaunched).toBe(false);

    const browser = await pool.acquire();
    expect(launchSpy).toHaveBeenCalledTimes(1);
    expect(pool.isLaunched).toBe(true);
    expect(pool.activeBorrows).toBe(1);
    expect(browser).toBeDefined();
  });

  test("reuses the same browser across concurrent acquires", async () => {
    const { launcher, launchSpy } = makeLauncher();
    const pool = new BrowserPool(launcher);
    const [b1, b2] = await Promise.all([pool.acquire(), pool.acquire()]);
    expect(launchSpy).toHaveBeenCalledTimes(1);
    expect(b1).toBe(b2);
    expect(pool.activeBorrows).toBe(2);
  });

  test("closes the browser after the idle timeout when refcount drops to zero", async () => {
    const { launcher, closeSpy } = makeLauncher();
    const pool = new BrowserPool(launcher, { idleTimeoutMs: 30_000 });
    await pool.acquire();
    pool.release();
    expect(closeSpy).not.toHaveBeenCalled();
    expect(pool.isLaunched).toBe(true);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(pool.isLaunched).toBe(false);
  });

  test("a re-acquire within the idle window keeps the same browser", async () => {
    const { launcher, launchSpy, closeSpy } = makeLauncher();
    const pool = new BrowserPool(launcher, { idleTimeoutMs: 30_000 });
    const first = await pool.acquire();
    pool.release();

    await vi.advanceTimersByTimeAsync(15_000);
    const second = await pool.acquire();
    expect(second).toBe(first);
    expect(launchSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).not.toHaveBeenCalled();
  });

  test("a re-acquire after the idle window launches a fresh browser", async () => {
    const { launcher, launchSpy, closeSpy } = makeLauncher();
    const pool = new BrowserPool(launcher, { idleTimeoutMs: 30_000 });
    await pool.acquire();
    pool.release();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(closeSpy).toHaveBeenCalledTimes(1);

    await pool.acquire();
    expect(launchSpy).toHaveBeenCalledTimes(2);
  });

  test("shutdown closes the browser immediately", async () => {
    const { launcher, closeSpy } = makeLauncher();
    const pool = new BrowserPool(launcher);
    await pool.acquire();
    await pool.shutdown();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(pool.isLaunched).toBe(false);
    expect(pool.activeBorrows).toBe(0);
  });

  test("launch failure cleans up speculative state for retry", async () => {
    const closeSpy = vi.fn(async () => {});
    let attempts = 0;
    const launcher: BrowserLauncher = {
      async launch() {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("first attempt fails");
        }
        return { close: closeSpy };
      },
    };
    const pool = new BrowserPool(launcher);
    await expect(pool.acquire()).rejects.toThrow("first attempt fails");
    expect(pool.activeBorrows).toBe(0);
    expect(pool.isLaunched).toBe(false);

    // Retry succeeds — pool state cleaned up correctly.
    const browser = await pool.acquire();
    expect(browser).toBeDefined();
    expect(pool.activeBorrows).toBe(1);
  });

  test("unmatched release is a no-op (defensive)", () => {
    const { launcher } = makeLauncher();
    const pool = new BrowserPool(launcher);
    expect(() => pool.release()).not.toThrow();
    expect(pool.activeBorrows).toBe(0);
  });
});
