/**
 * Unit tests for the Phase 6 Browse-window IPC handlers.
 *
 * Exercises the dependency-injected handlers without booting
 * Electron: a fake `captureWebContents` returns a synthetic PNG
 * payload, the `openBrowseWindow` callback is just a recorder,
 * and `persistVisible` writes through real Node fs into a tmp
 * directory standing in for `<userData>/library/`.
 */

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BROWSE_CHANNELS,
  createBrowseHandlers,
  type BrowseDeps,
  type BrowseHandlers,
  type CapturedImage,
} from "./browse.js";

let libraryRoot: string;
let openBrowseWindow: BrowseDeps["openBrowseWindow"] & ReturnType<typeof vi.fn>;
let captureWebContents: BrowseDeps["captureWebContents"] & ReturnType<typeof vi.fn>;
let handlers: BrowseHandlers;

const FAKE_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0x04,
]);

function fixedClock(): Date {
  return new Date("2026-05-06T12:34:56.789");
}

beforeEach(async () => {
  libraryRoot = await fs.mkdtemp(join(tmpdir(), "annot-browse-"));
  openBrowseWindow = vi.fn(async (_opts: { url?: string }) => undefined) as typeof openBrowseWindow;
  captureWebContents = vi.fn(async (_id: number): Promise<CapturedImage> => ({
    png: FAKE_PNG,
    width: 1280,
    height: 720,
  })) as typeof captureWebContents;
  const deps: BrowseDeps = {
    libraryRoot,
    openBrowseWindow,
    captureWebContents,
    now: fixedClock,
  };
  handlers = createBrowseHandlers(deps);
});

afterEach(async () => {
  await fs.rm(libraryRoot, { recursive: true, force: true });
});

describe("browse.open", () => {
  it("forwards the URL to the deps callback", async () => {
    await handlers.open({ url: "https://example.com/article" });
    expect(openBrowseWindow).toHaveBeenCalledWith({ url: "https://example.com/article" });
  });

  it("opens with no URL when none is supplied", async () => {
    await handlers.open({});
    expect(openBrowseWindow).toHaveBeenCalledWith({ url: undefined });
  });
});

describe("browse.captureVisible", () => {
  it("returns a PNG data URL with the captured size", async () => {
    const result = await handlers.captureVisible({ webContentsId: 42 });
    expect(captureWebContents).toHaveBeenCalledWith(42);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(result.data_url).toMatch(/^data:image\/png;base64,/);

    const recovered = Buffer.from(result.data_url.split(",")[1] ?? "", "base64");
    expect(new Uint8Array(recovered)).toEqual(FAKE_PNG);
  });
});

describe("browse.persistVisible", () => {
  it("writes the PNG into <library>/Inbox/ with annot-<ts>.annot.png filename", async () => {
    const captured = await handlers.captureVisible({ webContentsId: 1 });
    const persisted = await handlers.persistVisible({
      dataUrl: captured.data_url,
      width: captured.width,
      height: captured.height,
      sourceUrl: "https://example.com/article",
      title: "An Example Article",
    });

    expect(persisted.filename).toBe("annot-20260506-123456-789.annot.png");
    expect(persisted.path).toBe("Inbox/annot-20260506-123456-789.annot.png");
    expect(persisted.abs_path).toBe(join(libraryRoot, "Inbox", persisted.filename));

    const written = await fs.readFile(persisted.abs_path);
    expect(new Uint8Array(written)).toEqual(FAKE_PNG);
  });

  it("writes the sidecar JSON metadata next to the PNG", async () => {
    const captured = await handlers.captureVisible({ webContentsId: 1 });
    const persisted = await handlers.persistVisible({
      dataUrl: captured.data_url,
      width: captured.width,
      height: captured.height,
      sourceUrl: "https://example.com/article",
      title: "An Example Article",
    });

    const meta = JSON.parse(
      await fs.readFile(`${persisted.abs_path}.json`, "utf-8"),
    ) as {
      source_url: string;
      title: string;
      width: number;
      height: number;
    };
    expect(meta.source_url).toBe("https://example.com/article");
    expect(meta.title).toBe("An Example Article");
    expect(meta.width).toBe(1280);
    expect(meta.height).toBe(720);
  });

  it("creates the Inbox folder when it doesn't exist yet", async () => {
    // The mkdtemp libraryRoot starts empty — no Inbox/.
    const captured = await handlers.captureVisible({ webContentsId: 1 });
    await handlers.persistVisible({
      dataUrl: captured.data_url,
      width: captured.width,
      height: captured.height,
    });
    const stat = await fs.stat(join(libraryRoot, "Inbox"));
    expect(stat.isDirectory()).toBe(true);
  });

  it("rejects malformed data URLs", async () => {
    await expect(
      handlers.persistVisible({
        dataUrl: "not-a-data-url",
        width: 1,
        height: 1,
      }),
    ).rejects.toThrow(/invalid data URL/);
  });
});

describe("browse channel inventory", () => {
  it("exposes a stable channel-name set", () => {
    // Renderer-side bindings (`browse.ts` in src/browse/) depend on
    // these exact names. Pin them here so a typo surfaces at unit-
    // test time rather than as a silent runtime no-op.
    expect(BROWSE_CHANNELS).toEqual({
      open: "browse.open",
      captureVisible: "browse.captureVisible",
      persistVisible: "browse.persistVisible",
    });
  });
});
