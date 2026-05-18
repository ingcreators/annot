// @vitest-environment happy-dom

/**
 * Visibility-driven version poller — behaviour under simulated
 * deploy + tab-visibility events.
 *
 * The bundled `__APP_VERSION__` constant is normally injected by
 * Vite's `define`; in tests we mock the `./app-version` module so
 * we can flip the "current bundle version" per test without
 * fighting the build system.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./app-version.js", () => ({
  APP_VERSION: "v-current",
  isDevVersion: () => false,
}));

import { startVersionPolling } from "./version-poller.js";

function makeFetchResponse(body: string, ok = true): Response {
  return {
    ok,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

describe("startVersionPolling", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let teardown: () => void = () => {};
  let onNewVersion: ((remoteVersion: string) => void) & ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setVisibility("visible");
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    onNewVersion = vi.fn() as typeof onNewVersion;
  });

  afterEach(() => {
    teardown();
    vi.useRealTimers();
  });

  it("fetches /version.txt with cache: 'no-store' on visibilitychange", async () => {
    fetchSpy.mockResolvedValue(makeFetchResponse("v-current"));
    teardown = startVersionPolling({ onNewVersion });

    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledWith("/version.txt", { cache: "no-store" });
  });

  it("does not fire callback when remote version matches bundled version", async () => {
    fetchSpy.mockResolvedValue(makeFetchResponse("v-current"));
    teardown = startVersionPolling({ onNewVersion });

    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    await Promise.resolve();

    expect(onNewVersion).not.toHaveBeenCalled();
  });

  it("fires callback exactly once when remote version differs", async () => {
    fetchSpy.mockResolvedValue(makeFetchResponse("v-new"));
    teardown = startVersionPolling({ onNewVersion });

    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    await Promise.resolve();

    expect(onNewVersion).toHaveBeenCalledTimes(1);
    expect(onNewVersion).toHaveBeenCalledWith("v-new");

    // Subsequent events must not re-fire — the banner is already up.
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    await Promise.resolve();

    expect(onNewVersion).toHaveBeenCalledTimes(1);
  });

  it("trims surrounding whitespace from the remote version", async () => {
    fetchSpy.mockResolvedValue(makeFetchResponse("v-new\n"));
    teardown = startVersionPolling({ onNewVersion });

    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    await Promise.resolve();

    expect(onNewVersion).toHaveBeenCalledWith("v-new");
  });

  it("stays silent on 404 (mid-deploy race)", async () => {
    fetchSpy.mockResolvedValue(makeFetchResponse("", false));
    teardown = startVersionPolling({ onNewVersion });

    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    await Promise.resolve();

    expect(onNewVersion).not.toHaveBeenCalled();
  });

  it("stays silent on network error (offline)", async () => {
    fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"));
    teardown = startVersionPolling({ onNewVersion });

    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    await Promise.resolve();

    expect(onNewVersion).not.toHaveBeenCalled();
  });

  it("skips fetching when tab is not visible", async () => {
    fetchSpy.mockResolvedValue(makeFetchResponse("v-new"));
    setVisibility("hidden");
    teardown = startVersionPolling({ onNewVersion });

    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onNewVersion).not.toHaveBeenCalled();
  });

  it("also checks on pageshow (bfcache restore)", async () => {
    fetchSpy.mockResolvedValue(makeFetchResponse("v-new"));
    teardown = startVersionPolling({ onNewVersion });

    window.dispatchEvent(new Event("pageshow"));
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(onNewVersion).toHaveBeenCalledWith("v-new");
  });

  it("schedules an initial check 30s after boot", async () => {
    vi.useFakeTimers();
    fetchSpy.mockResolvedValue(makeFetchResponse("v-new"));
    teardown = startVersionPolling({ onNewVersion });

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(29_999);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    // Drain the promise microtasks the fetch resolution will queue.
    await vi.runAllTimersAsync();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("teardown detaches listeners and cancels the initial timer", async () => {
    vi.useFakeTimers();
    fetchSpy.mockResolvedValue(makeFetchResponse("v-new"));
    teardown = startVersionPolling({ onNewVersion });
    teardown();
    teardown = () => {};

    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    vi.advanceTimersByTime(60_000);
    await vi.runAllTimersAsync();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats an empty body as 'no info' (silent)", async () => {
    fetchSpy.mockResolvedValue(makeFetchResponse(""));
    teardown = startVersionPolling({ onNewVersion });

    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    await Promise.resolve();

    expect(onNewVersion).not.toHaveBeenCalled();
  });
});

describe("startVersionPolling — dev mode", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns a no-op teardown and never fetches when __APP_VERSION__ starts with 'dev-'", async () => {
    vi.doMock("./app-version.js", () => ({
      APP_VERSION: "dev-12345",
      isDevVersion: () => true,
    }));
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { startVersionPolling: startVersionPollingDev } = await import("./version-poller.js");
    const teardown = startVersionPollingDev({ onNewVersion: () => {} });

    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy).not.toHaveBeenCalled();
    // Teardown must still be safe to call.
    expect(() => teardown()).not.toThrow();
  });
});
