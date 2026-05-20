// `captureAriaSnapshot` — open a URL in headless Chromium and
// return Playwright's AI-mode aria-snapshot (YAML with
// `[ref=eN]` markers).
//
// Phase 0 Stage 1 of `docs/plans/living-product-docs.md`. The
// foundational primitive: the YAML that the `annot:snapshot`
// MDX comment block in `*.screen.mdx` files will be populated
// from.
//
// Mirrors `capturePage` in shape but skips the screenshot and
// closes the page eagerly — callers don't need the live page
// after the snapshot is in hand (no follow-up locator
// resolution).

import type { BrowserPool } from "./pool.js";

export interface AriaSnapshotOptions {
  url: string;
  viewport?: { width: number; height: number; deviceScaleFactor?: number };
  waitFor?: "load" | "domcontentloaded" | "networkidle";
  /**
   * Selector for the locator whose subtree is snapshotted.
   * Defaults to `"body"` (whole page).
   */
  rootSelector?: string;
  /**
   * Pass-through to Playwright's `ariaSnapshot({ timeout })`.
   * Defaults to Playwright's own default (30 s).
   */
  timeout?: number;
}

export interface AriaSnapshotResult {
  /**
   * YAML-formatted accessibility tree. When `mode: "ai"` is used
   * (which `captureAriaSnapshot` always does), each interactive
   * element carries a `[ref=eN]` marker.
   */
  yaml: string;
}

const DEFAULT_VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };
const DEFAULT_WAIT_FOR: NonNullable<AriaSnapshotOptions["waitFor"]> = "load";
const DEFAULT_ROOT_SELECTOR = "body";

/**
 * Acquire a browser, open a context + page, navigate to the URL,
 * take an AI-mode aria-snapshot of the root locator's subtree,
 * and close everything.
 *
 * On any error after browser acquisition, the page + context are
 * closed and the browser is released before the error propagates.
 */
export async function captureAriaSnapshot(
  pool: BrowserPool,
  options: AriaSnapshotOptions,
): Promise<AriaSnapshotResult> {
  const viewport = { ...DEFAULT_VIEWPORT, ...options.viewport };
  const waitFor = options.waitFor ?? DEFAULT_WAIT_FOR;
  const rootSelector = options.rootSelector ?? DEFAULT_ROOT_SELECTOR;

  const browser = (await pool.acquire()) as unknown as PlaywrightBrowserLike;
  let context: PlaywrightContextLike | undefined;
  let released = false;
  const releaseBorrow = () => {
    if (!released) {
      released = true;
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
    const yaml = await page.locator(rootSelector).ariaSnapshot({
      mode: "ai",
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
    });
    await context.close();
    releaseBorrow();
    return { yaml };
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
// Mirrored locally; same pattern as `capture.ts`. Keeps the
// module load cost off the hot path via the pool's dynamic
// `playwright-core` import.

interface PlaywrightBrowserLike {
  newContext(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor?: number;
  }): Promise<PlaywrightContextLike>;
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
  locator(selector: string): {
    ariaSnapshot(options?: { mode?: "ai" | "default"; timeout?: number }): Promise<string>;
  };
}
