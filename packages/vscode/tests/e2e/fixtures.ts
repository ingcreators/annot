import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import {
  test as base,
  type ElectronApplication,
  _electron as electron,
  expect,
  type FrameLocator,
  type Page,
} from "@playwright/test";
import { VSCODE_PATH_FILE } from "./global-setup.js";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ---------------------------------------------------------------
// Fixture .annot.svg generation (self-contained, no binary assets)
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

function makeTestPng(width: number, height: number): Buffer {
  const raw = new Uint8Array(height * (1 + width * 4));
  let i = 0;
  for (let y = 0; y < height; y++) {
    raw[i++] = 0;
    for (let x = 0; x < width; x++) {
      raw[i++] = Math.round((x / width) * 255);
      raw[i++] = Math.round((y / height) * 255);
      raw[i++] = 0x90;
      raw[i++] = 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

/** A minimal valid Annot annotation SVG (versioned root + embedded
 *  base image + empty annotations group), per docs/svg-format.md. */
export function makeAnnotSvg(width = 640, height = 400): string {
  const dataUrl = `data:image/png;base64,${makeTestPng(width, height).toString("base64")}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `data-annot-version="1" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<image href="${dataUrl}" width="${width}" height="${height}"/>` +
    `<g id="annotations"/></svg>`
  );
}

// ---------------------------------------------------------------
// VS Code fixtures
// ---------------------------------------------------------------

interface VSCodeFixtures {
  /** Temp workspace folder seeded with sample.annot.svg. */
  workspace: string;
  app: ElectronApplication;
  window: Page;
}

export const SAMPLE_FILE = "sample.annot.svg";

export const test = base.extend<VSCodeFixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature
  workspace: async ({}, use) => {
    const ws = mkdtempSync(path.join(os.tmpdir(), "annot-vscode-e2e-"));
    writeFileSync(path.join(ws, SAMPLE_FILE), makeAnnotSvg());
    await use(ws);
  },
  app: async ({ workspace }, use) => {
    const executable = readFileSync(VSCODE_PATH_FILE, "utf8").trim();
    // The harness itself may run inside an Electron host —
    // ELECTRON_RUN_AS_NODE would demote VS Code to a plain Node
    // process ("bad option" on every VS Code flag). The cache
    // redirect keeps VS Code's crash-reporter dir writable in
    // sandboxed containers where ~/.cache is root-owned.
    const env = { ...process.env } as Record<string, string>;
    delete env.ELECTRON_RUN_AS_NODE;
    env.XDG_CACHE_HOME = mkdtempSync(path.join(os.tmpdir(), "annot-vscode-cache-"));
    const app = await electron.launch({
      executablePath: executable,
      env,
      args: [
        "--no-sandbox",
        "--disable-gpu",
        "--disable-updates",
        "--disable-workspace-trust",
        "--disable-telemetry",
        "--skip-welcome",
        "--skip-release-notes",
        "--new-window",
        `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), "annot-vscode-udd-"))}`,
        `--extensions-dir=${mkdtempSync(path.join(os.tmpdir(), "annot-vscode-ext-"))}`,
        `--extensionDevelopmentPath=${PKG_ROOT}`,
        workspace,
      ],
    });
    await use(app);
    await app.close();
  },
  window: async ({ app }, use) => {
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    // Wait for the workbench (explorer shows the workspace) so the
    // development extension's contributions are registered before
    // any file is opened.
    await window.locator(".explorer-folders-view").waitFor({ timeout: 60_000 });
    await use(window);
  },
});

export { expect };

/** Open a workspace file via Quick Open. Files must NOT be passed on
 *  the CLI: at launch the development extension's contributions
 *  aren't registered yet, so a CLI-opened *.annot.svg races the
 *  scan and falls back to the text editor. Opening after the
 *  workbench is up routes through the custom-editor association. */
export async function openAnnotFile(window: Page, filename: string): Promise<FrameLocator> {
  await window.keyboard.press("Control+P");
  await window.keyboard.type(filename);
  await window.locator(".quick-input-list .monaco-list-row").first().waitFor({ timeout: 10_000 });
  await window.keyboard.press("Enter");
  const webview = window.frameLocator("iframe.webview.ready").frameLocator("#active-frame");
  await webview.locator("[data-annot-shell-root]").waitFor({ timeout: 60_000 });
  return webview;
}

/** The editor canvas SVG inside the webview. The webview shell
 *  creates an anonymous svg tagged data-annot-shell-root — there is
 *  no #svg-root here (that id is the PWA host's). */
export function canvas(webview: FrameLocator) {
  return webview.locator("[data-annot-shell-root]");
}

export function annotations(webview: FrameLocator) {
  return webview.locator("[data-annot-shell-root] #annotations > *");
}

export function toolButton(webview: FrameLocator, toolId: string) {
  return webview.locator(`#annot-shell-toolbar button.toolbar-btn[data-tool="${toolId}"]`);
}

/** Drag on the webview canvas. Coordinates are FRACTIONS of the
 *  rendered canvas box (0..1): the svg is fit-scaled to the editor
 *  pane, so absolute pixel offsets can silently land outside the
 *  (small) fitted canvas — the pointerup then hits the container
 *  and the tool never commits. */
export async function dragOnCanvas(
  window: Page,
  webview: FrameLocator,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const box = await canvas(webview).boundingBox();
  if (!box) throw new Error("canvas has no bounding box");
  await window.mouse.move(box.x + box.width * from.x, box.y + box.height * from.y);
  await window.mouse.down();
  await window.mouse.move(box.x + box.width * to.x, box.y + box.height * to.y, { steps: 8 });
  await window.mouse.up();
}

/** VS Code's dirty indicator for the active editor tab. */
export function activeTab(window: Page) {
  return window.locator(".tabs-container .tab.active");
}
