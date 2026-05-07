/**
 * Unit tests for the Browse-window IPC handlers.
 *
 * Phase 3 of `desktop-browser-mode.md` replaces the bespoke
 * `browse.captureVisible` + `browse.persistVisible` pair (Phase 6
 * MVP) with the host-primitive pair the orchestrators consume:
 * `browse.host.captureViewport` and `browse.host.executeMainWorld`.
 * Persistence moved renderer-side (`DesktopStore.saveImage`).
 *
 * These tests exercise the dependency-injected handlers without
 * booting Electron: a fake `captureWebContents` returns a
 * synthetic PNG payload + DPR, and a fake
 * `executeJavaScriptInTarget` records the expression so the
 * channel's pass-through contract can be asserted.
 */

import { describe, expect, it, vi } from "vitest";
import {
  BROWSE_CHANNELS,
  createBrowseHandlers,
  type BrowseDeps,
  type CapturedImage,
} from "./browse.js";

const FAKE_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0x04,
]);

function buildHandlers(deps: Partial<BrowseDeps> = {}) {
  const openBrowseWindow = vi.fn(async (_opts: { url?: string }) => undefined);
  const captureWebContents = vi.fn(async (_id: number): Promise<CapturedImage> => ({
    png: FAKE_PNG,
    width: 1280,
    height: 720,
    dpr: 2,
  }));
  const executeJavaScriptInTarget = vi.fn(async (_id: number, _expr: string) => null);
  const merged: BrowseDeps = {
    openBrowseWindow,
    captureWebContents,
    executeJavaScriptInTarget,
    ...deps,
  };
  const handlers = createBrowseHandlers(merged);
  return { handlers, openBrowseWindow, captureWebContents, executeJavaScriptInTarget };
}

describe("browse.open", () => {
  it("forwards the URL to the deps callback", async () => {
    const { handlers, openBrowseWindow } = buildHandlers();
    await handlers.open({ url: "https://example.com/article" });
    expect(openBrowseWindow).toHaveBeenCalledWith({ url: "https://example.com/article" });
  });

  it("opens with no URL when none is supplied", async () => {
    const { handlers, openBrowseWindow } = buildHandlers();
    await handlers.open({});
    expect(openBrowseWindow).toHaveBeenCalledWith({ url: undefined });
  });
});

describe("browse.host.captureViewport", () => {
  it("returns a PNG data URL plus the host-authoritative DPR", async () => {
    const { handlers, captureWebContents } = buildHandlers();
    const result = await handlers.captureViewport({ webContentsId: 42 });
    expect(captureWebContents).toHaveBeenCalledWith(42);
    expect(result.dpr).toBe(2);
    expect(result.pngDataUrl).toMatch(/^data:image\/png;base64,/);

    // Verify the base64 round-trips back to the original PNG bytes.
    const recovered = Buffer.from(result.pngDataUrl.split(",")[1] ?? "", "base64");
    expect(new Uint8Array(recovered)).toEqual(FAKE_PNG);
  });
});

describe("browse.host.executeMainWorld", () => {
  it("passes the expression and webContentsId through to deps", async () => {
    const fakeReturn = { ok: true } as unknown;
    const customExec = vi.fn(async () => fakeReturn);
    const { handlers } = buildHandlers({ executeJavaScriptInTarget: customExec });
    const result = await handlers.executeMainWorld({
      webContentsId: 5,
      expression: "1 + 2",
    });
    expect(customExec).toHaveBeenCalledWith(5, "1 + 2");
    expect(result).toBe(fakeReturn);
  });

  it("propagates rejection from the deps callback", async () => {
    const { handlers } = buildHandlers({
      executeJavaScriptInTarget: vi.fn(async () => {
        throw new Error("Web contents navigated");
      }),
    });
    await expect(
      handlers.executeMainWorld({ webContentsId: 1, expression: "1+2" }),
    ).rejects.toThrow(/navigated/);
  });
});

describe("browse channel inventory", () => {
  it("exposes a stable channel-name set", () => {
    // Renderer-side bindings (`browse.ts` + `host.ts` in
    // src/browse/) depend on these exact names. Pin them here so a
    // typo surfaces at unit-test time rather than as a silent
    // runtime no-op.
    expect(BROWSE_CHANNELS).toEqual({
      open: "browse.open",
      captureViewport: "browse.host.captureViewport",
      executeMainWorld: "browse.host.executeMainWorld",
    });
  });
});
