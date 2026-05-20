// `capturePage` — open a URL in headless Chromium, take a
// screenshot, and return PNG bytes + the live `Page` so the
// caller can resolve locators before closing.
//
// The caller MUST close the returned page (via `closePage`) after
// it's done with locator resolution. We expose it through the
// returned handle rather than auto-closing here because the
// `_url` tool needs the page alive between screenshot and
// `resolveLocator` calls.

import type { BrowserPool } from "./pool.js";

export interface ViewportOptions {
  width: number;
  height: number;
  deviceScaleFactor?: number;
}

export interface CapturePageOptions {
  url: string;
  viewport?: ViewportOptions;
  fullPage?: boolean;
  waitFor?: "load" | "domcontentloaded" | "networkidle";
}

export interface PageHandle {
  /** Page-shaped object (`playwright-core`'s `Page`). */
  page: {
    locator(selector: string): {
      boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
    };
  };
  /** Close the page and release the browser borrow. Idempotent. */
  close(): Promise<void>;
}

export interface CapturePageResult {
  pngBytes: Uint8Array;
  handle: PageHandle;
}

const DEFAULT_VIEWPORT: ViewportOptions = { width: 1280, height: 800, deviceScaleFactor: 1 };
const DEFAULT_WAIT_FOR: NonNullable<CapturePageOptions["waitFor"]> = "load";

/**
 * Acquire a browser, open a new context + page, navigate to the
 * given URL, take a screenshot, and return the bytes + a page
 * handle for follow-up locator resolution.
 *
 * On any error after browser acquisition, the page + context are
 * closed and the browser is released before the error propagates.
 */
export async function capturePage(
  pool: BrowserPool,
  options: CapturePageOptions,
): Promise<CapturePageResult> {
  const viewport = { ...DEFAULT_VIEWPORT, ...options.viewport };
  const waitFor = options.waitFor ?? DEFAULT_WAIT_FOR;
  const fullPage = options.fullPage ?? false;

  const browser = (await pool.acquire()) as unknown as PlaywrightBrowserLike;
  let context: PlaywrightContextLike | undefined;
  let closed = false;
  const releaseBorrow = () => {
    if (!closed) {
      closed = true;
      pool.release();
    }
  };

  try {
    context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
    });
    const page = await context.newPage();
    await page.goto(options.url, { waitUntil: waitFor });
    const buffer = await page.screenshot({ fullPage, type: "png" });
    const pngBytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    const localContext = context;
    const handle: PageHandle = {
      page,
      async close() {
        if (closed) return;
        try {
          await localContext.close();
        } finally {
          releaseBorrow();
        }
      },
    };
    return { pngBytes, handle };
  } catch (err) {
    if (context) {
      try {
        await context.close();
      } catch {
        /* ignore */
      }
    }
    releaseBorrow();
    throw err;
  }
}

// ─── playwright-core structural shapes ──────────────────────────
//
// Mirrored locally to avoid taking a hard type-dep on
// `playwright-core` from this file (the pool's dynamic-import
// pattern keeps the module load cost off the hot path).

interface PlaywrightBrowserLike {
  newContext(options: NewContextOptions): Promise<PlaywrightContextLike>;
}

interface NewContextOptions {
  viewport: { width: number; height: number };
  deviceScaleFactor?: number;
}

interface PlaywrightContextLike {
  newPage(): Promise<PlaywrightPageLike>;
  close(): Promise<void>;
}

interface PlaywrightPageLike {
  goto(
    url: string,
    options: { waitUntil: "load" | "domcontentloaded" | "networkidle" },
  ): Promise<unknown>;
  screenshot(options: { fullPage: boolean; type: "png" }): Promise<Buffer>;
  locator(selector: string): PlaywrightLocatorLike;
}

interface PlaywrightLocatorLike {
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  ariaSnapshot(options?: { mode?: "ai" | "default"; timeout?: number }): Promise<string>;
}
