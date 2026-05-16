// Unit tests for session-level emulator viewport application.
//
// The failure mode the contract guards against: an earlier revision
// of `applySessionEmulation` passed `{ id: 0, windowId, url: "" }`
// to the host. The host's `setEmulatedViewport` probes the page via
// `chrome.tabs.sendMessage(target.id, ...)` to measure browser-chrome
// height — and tab id 0 always throws, leaving `chromeDelta` at
// zero. The outer window then gets sized to the user's CSS-pixel
// target, but the inner viewport ends up short by the tab strip +
// address bar height (≈87 px on a typical desktop Chrome), so a
// Full HD preset captures at 1920×993 instead of 1920×1080. These
// tests pin the contract that callers MUST hand in a real tab id.

import type { Settings } from "@ingcreators/annot-capture/shared";
import { describe, expect, it, vi } from "vitest";
import {
  applySessionEmulation,
  migrateSessionEmulation,
  type SessionEmulationHost,
  type SessionEmulationTarget,
} from "./session-emulation.js";

function makeHost(): SessionEmulationHost & {
  calls: Array<{
    target: SessionEmulationTarget;
    size: { width: number; height: number } | null;
  }>;
} {
  const calls: Array<{
    target: SessionEmulationTarget;
    size: { width: number; height: number } | null;
  }> = [];
  return {
    calls,
    async setEmulatedViewport(target, size) {
      calls.push({ target, size });
    },
  };
}

function settingsWithEmulation(preset: "fullhd" | "native"): Settings {
  // Only the `emulation` slice is read by `resolveEmulation`; the
  // rest of the Settings shape is filled to satisfy the type.
  return {
    overlays: { mode: "scrollOnly", preservedSelectors: "", keepFirstSegment: true },
    scrollbars: { hide: true },
    timing: {
      scrollSettleMs: 0,
      clickSettleMs: 0,
      hotkeySettleMs: 0,
      interSegmentMs: 0,
      perPageInterShotMs: 0,
    },
    quality: {
      format: "smart",
      smartFallback: "png",
      smartColorThreshold: 0,
      jpegPercent: 90,
      saveSizePreset: "native",
    },
    capture: { wholePageOutput: "stitched" },
    auto: {
      enabled: false,
      stableWaitMs: 0,
      visualDiffThreshold: 0,
      visualDiffProbeMode: "off",
    },
    emulation: {
      enabled: preset !== "native",
      preset,
      customWidth: 0,
      customHeight: 0,
    },
  } as unknown as Settings;
}

describe("applySessionEmulation", () => {
  it("forwards the real tab id (not zero) to the host", async () => {
    vi.useFakeTimers();
    try {
      const host = makeHost();
      const target: SessionEmulationTarget = {
        id: 42,
        windowId: 7,
        url: "https://example.com/",
      };
      const promise = applySessionEmulation(host, target, settingsWithEmulation("fullhd"));
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result).toBe(7);
      expect(host.calls).toHaveLength(1);
      expect(host.calls[0]!.target.id).toBe(42);
      expect(host.calls[0]!.target.id).not.toBe(0);
      expect(host.calls[0]!.target.windowId).toBe(7);
      expect(host.calls[0]!.size).toEqual({ width: 1920, height: 1080 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns null and skips the host when emulation is disabled (native)", async () => {
    const host = makeHost();
    const result = await applySessionEmulation(
      host,
      { id: 42, windowId: 7, url: "https://example.com/" },
      settingsWithEmulation("native"),
    );
    expect(result).toBeNull();
    expect(host.calls).toHaveLength(0);
  });

  it("returns null when the host throws (so the session continues at native size)", async () => {
    vi.useFakeTimers();
    try {
      const calls: Array<unknown> = [];
      const failingHost: SessionEmulationHost = {
        async setEmulatedViewport(target) {
          calls.push(target);
          throw new Error("chrome.windows.update rejected");
        },
      };
      const promise = applySessionEmulation(
        failingHost,
        { id: 42, windowId: 7, url: "https://example.com/" },
        settingsWithEmulation("fullhd"),
      );
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result).toBeNull();
      expect(calls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("migrateSessionEmulation", () => {
  it("forwards the real tab id of the new window to the host", async () => {
    vi.useFakeTimers();
    try {
      const host = makeHost();
      const promise = migrateSessionEmulation(
        host,
        null,
        { id: 99, windowId: 11, url: "https://example.com/" },
        settingsWithEmulation("fullhd"),
      );
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result).toBe(11);
      // Only the apply call — no prior window to restore.
      expect(host.calls).toHaveLength(1);
      expect(host.calls[0]!.target.id).toBe(99);
      expect(host.calls[0]!.target.id).not.toBe(0);
      expect(host.calls[0]!.size).toEqual({ width: 1920, height: 1080 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("no-ops when the new window equals the previously-emulated one", async () => {
    const host = makeHost();
    const result = await migrateSessionEmulation(
      host,
      11,
      { id: 99, windowId: 11, url: "https://example.com/" },
      settingsWithEmulation("fullhd"),
    );
    expect(result).toBe(11);
    expect(host.calls).toHaveLength(0);
  });

  it("restores the previous window before applying to the new one", async () => {
    vi.useFakeTimers();
    try {
      const host = makeHost();
      const promise = migrateSessionEmulation(
        host,
        5,
        { id: 99, windowId: 11, url: "https://example.com/" },
        settingsWithEmulation("fullhd"),
      );
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result).toBe(11);
      expect(host.calls).toHaveLength(2);
      // 1: restore previous window (size === null).
      expect(host.calls[0]!.size).toBeNull();
      expect(host.calls[0]!.target.windowId).toBe(5);
      // 2: apply to new window with the real tab id.
      expect(host.calls[1]!.size).toEqual({ width: 1920, height: 1080 });
      expect(host.calls[1]!.target.id).toBe(99);
      expect(host.calls[1]!.target.windowId).toBe(11);
    } finally {
      vi.useRealTimers();
    }
  });
});
