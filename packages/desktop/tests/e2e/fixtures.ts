import { mkdirSync, mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import {
  test as base,
  type ElectronApplication,
  _electron as electron,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MAIN_BUNDLE = path.join(PKG_ROOT, "dist-electron/main/main.js");

// `require("electron")` from Node resolves to the path of the
// Electron binary (the devDependency this package already builds
// with) — no separate download step, unlike the vscode suite.
const require = createRequire(import.meta.url);
const ELECTRON_BINARY = require("electron") as string;

// ---------------------------------------------------------------
// Test-image generation (mirrors packages/web/tests/e2e/helpers.ts)
// ---------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Minimal in-process PNG encoder so tests need no binary fixture.
 *  Renders a gradient with a solid border — visually obvious in
 *  traces, deterministic byte-for-byte across runs. */
export function makeTestPng(width = 640, height = 400): Buffer {
  const raw = new Uint8Array(height * (1 + width * 4));
  let i = 0;
  for (let y = 0; y < height; y++) {
    raw[i++] = 0; // scanline filter: none
    for (let x = 0; x < width; x++) {
      const border = x < 6 || y < 6 || x >= width - 6 || y >= height - 6;
      raw[i++] = border ? 0x1f : Math.round((x / width) * 255);
      raw[i++] = border ? 0x6f : Math.round((y / height) * 255);
      raw[i++] = border ? 0xff : 0x90;
      raw[i++] = 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

// ---------------------------------------------------------------
// Desktop-app fixtures
// ---------------------------------------------------------------

/** Plain PNG seeded into `Inbox/` before launch — the "external
 *  image dropped into the library" case DesktopStore serves via
 *  its raw-raster fallback (no XMP packet until the first save). */
export const SEEDED_FILE = "seeded.annot.png";
export const INBOX = "Inbox";

interface DesktopFixtures {
  /** Per-test `userData` root. The library lives at
   *  `<userData>/library/`, seeded with `Inbox/<SEEDED_FILE>`. */
  userData: string;
  app: ElectronApplication;
  window: Page;
}

/** Absolute path of a library file inside the test's userData. */
export function libraryFile(userData: string, ...segments: string[]): string {
  return path.join(userData, "library", ...segments);
}

export const test = base.extend<DesktopFixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature
  userData: async ({}, use) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "annot-desktop-e2e-"));
    mkdirSync(libraryFile(dir, INBOX), { recursive: true });
    await writeFile(libraryFile(dir, INBOX, SEEDED_FILE), makeTestPng());
    await use(dir);
  },
  app: async ({ userData }, use) => {
    // The harness itself may run inside an Electron host —
    // ELECTRON_RUN_AS_NODE would demote the app to a plain Node
    // process that can't open windows.
    const env = { ...process.env } as Record<string, string>;
    delete env.ELECTRON_RUN_AS_NODE;
    env.ANNOT_TEST_USER_DATA_DIR = userData;
    const app = await electron.launch({
      executablePath: ELECTRON_BINARY,
      env,
      args: ["--no-sandbox", "--disable-gpu", MAIN_BUNDLE],
    });
    await use(app);
    await app.close();
  },
  window: async ({ app }, use) => {
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    // The gallery bootstrap resolves the library root over IPC and
    // mounts the unified FileManager — wait for its chrome before
    // any test interacts.
    await window.locator("#file-manager").waitFor({ timeout: 60_000 });
    await window.locator("button.sidebar-new-btn").waitFor({ timeout: 60_000 });
    await use(window);
  },
});

export { expect };

// ---------------------------------------------------------------
// Gallery interactions (selector vocabulary shared with the PWA's
// suite — the desktop mounts the same FileManager surface)
// ---------------------------------------------------------------

/** The gallery card for an image, matched by visible title. */
export function imageCard(window: Page, title: string): Locator {
  return window.locator(".gallery-item", {
    has: window.locator(".gallery-item-name", { hasText: title }),
  });
}

export function folderCard(window: Page, name: string): Locator {
  return window.locator(".gallery-folder-card", { hasText: name });
}

/** Double-click into the seeded Inbox folder from the gallery root. */
export async function enterInbox(window: Page): Promise<void> {
  await folderCard(window, INBOX).dblclick();
  await expect(window.locator(".breadcrumb-item.active")).toHaveText(INBOX);
}

/** Open a gallery image into the editor by double-click and wait
 *  for editor mode to engage with the base image loaded. */
export async function openImageInEditor(window: Page, title: string): Promise<void> {
  await imageCard(window, title).dblclick();
  await expect(window.locator("body")).toHaveClass(/editor-mode/);
  await expect(window.locator("#svg-root image")).toBeVisible();
}

/** Leave the editor for the gallery root via the header brand
 *  (wired to `onNavigateToFolder("")` → `showGallery`). */
export async function backToGallery(window: Page): Promise<void> {
  await window.locator(".editor-header-brand").click();
  await expect(window.locator("body")).not.toHaveClass(/editor-mode/);
  await window.locator("#file-manager").waitFor();
}

// ---------------------------------------------------------------
// Editor interactions
// ---------------------------------------------------------------

/** Toolbar button for a tool id ("" = Select). The desktop mounts
 *  the shared vertical toolbar into #editor-sidebar. */
export function toolButton(window: Page, toolId: string): Locator {
  return window.locator(`#editor-sidebar button.toolbar-btn[data-tool="${toolId}"]`);
}

/** Drag on the editor canvas. Coordinates are FRACTIONS of the
 *  rendered canvas box (0..1): the svg is fit-scaled to the window,
 *  so absolute pixel offsets can silently land outside the fitted
 *  canvas — the pointerup then hits the container and the tool
 *  never commits. */
export async function dragOnCanvas(
  window: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const box = await window.locator("#svg-root").boundingBox();
  if (!box) throw new Error("#svg-root has no bounding box");
  await window.mouse.move(box.x + box.width * from.x, box.y + box.height * from.y);
  await window.mouse.down();
  await window.mouse.move(box.x + box.width * to.x, box.y + box.height * to.y, { steps: 8 });
  await window.mouse.up();
}

/** Annotation elements currently on the canvas. */
export function annotations(window: Page): Locator {
  return window.locator("#svg-root #annotations > *");
}

/** Wait until the header save indicator reports the debounced
 *  autosave has flushed to disk. The indicator idles at "Saved",
 *  so first give the Edited/Saving transition a moment to appear —
 *  otherwise a call racing the dirty event would return on the
 *  stale pre-edit state. */
export async function waitForSaved(window: Page): Promise<void> {
  const label = window.locator("annot-save-status .save-status-label");
  await label
    .filter({ hasText: /Edited|Saving/ })
    .waitFor({ timeout: 2_000 })
    .catch(() => {
      // Missed the (≥500 ms) window — the save already flushed.
    });
  await expect(label).toHaveText("Saved", { timeout: 10_000 });
}
