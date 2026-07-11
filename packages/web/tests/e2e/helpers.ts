import { deflateSync } from "node:zlib";
import { expect, type Locator, type Page } from "@playwright/test";

// ---------------------------------------------------------------
// Test-image generation
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
// Navigation
// ---------------------------------------------------------------

/** Open the gallery root and wait for the file manager to render.
 *  `"./"` resolves against the configured baseURL (`…/app/`). */
export async function gotoGallery(page: Page): Promise<void> {
  await page.goto("./");
  await expect(page.locator("#file-manager")).toBeVisible();
  await expect(page.locator("annot-gallery-page")).toBeVisible();
}

// ---------------------------------------------------------------
// Gallery interactions
// ---------------------------------------------------------------

/** The gallery card for an uploaded image, matched by visible title. */
export function imageCard(page: Page, title: string): Locator {
  return page.locator(".gallery-item", {
    has: page.locator(".gallery-item-name", { hasText: title }),
  });
}

/** Import a PNG through the sidebar "New → Upload Files…" flow —
 *  the same transient `<input type=file>` a real user drives. The
 *  input never attaches to the DOM, so the file arrives via the
 *  filechooser event rather than `setInputFiles` on a locator. */
export async function uploadTestImage(page: Page, name = "sample.png"): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.locator("button.sidebar-new-btn").click();
  await page.locator("button.new-menu-item", { hasText: "Upload Files…" }).click();
  await (await chooser).setFiles({
    name,
    mimeType: "image/png",
    buffer: makeTestPng(),
  });
  await expect(imageCard(page, name.replace(/\.[^.]+$/, ""))).toBeVisible();
}

/** Open a gallery image into the editor by double-click (the
 *  primary open gesture) and wait for editor mode to engage. */
export async function openImageInEditor(page: Page, title: string): Promise<void> {
  await imageCard(page, title).dblclick();
  await expect(page.locator("body")).toHaveClass(/editor-mode/);
  await expect(page.locator("#svg-root image")).toBeVisible();
}

/** Upload a fresh image and open it — the standard editor-test setup. */
export async function setupEditorWithImage(page: Page, name = "sample.png"): Promise<void> {
  await gotoGallery(page);
  await uploadTestImage(page, name);
  await openImageInEditor(page, name.replace(/\.[^.]+$/, ""));
}

/** Open the per-card actions menu (`…` button) and click an item. */
export async function clickCardMenuItem(card: Locator, item: string): Promise<void> {
  await card.hover();
  await card.locator(".gallery-card-more").click();
  const page = card.page();
  await page.locator("annot-context-menu .context-menu-item", { hasText: item }).click();
}

// ---------------------------------------------------------------
// Editor interactions
// ---------------------------------------------------------------

/** Toolbar button for a tool id ("" = Select). */
export function toolButton(page: Page, toolId: string): Locator {
  return page.locator(`#editor-sidebar button.toolbar-btn[data-tool="${toolId}"]`);
}

export async function selectTool(page: Page, toolId: string): Promise<void> {
  await toolButton(page, toolId).click();
  await expect(toolButton(page, toolId)).toHaveClass(/active/);
}

/** Drag on the canvas in svg#svg-root client space. */
export async function dragOnCanvas(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const box = await page.locator("#svg-root").boundingBox();
  if (!box) throw new Error("#svg-root has no bounding box");
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 });
  await page.mouse.up();
}

/** Annotation elements currently on the canvas. */
export function annotations(page: Page): Locator {
  return page.locator("#svg-root #annotations > *");
}

/** Wait until the header save indicator reports the debounced
 *  autosave has flushed to storage. The indicator idles at
 *  "Saved", so first give the Edited/Saving transition a moment to
 *  appear — otherwise a call racing the dirty event would return
 *  on the stale pre-edit state. */
export async function waitForSaved(page: Page): Promise<void> {
  const label = page.locator("annot-save-status .save-status-label");
  await label
    .filter({ hasText: /Edited|Saving/ })
    .waitFor({ timeout: 2_000 })
    .catch(() => {
      // Missed the (≥500 ms) window — the save already flushed.
    });
  await expect(label).toHaveText("Saved", { timeout: 10_000 });
}
