// Headless-Chromium instance pool. The `_url` MCP tools share a
// single browser across calls so launch cost (~500 ms) is amortised,
// then close the browser after a configurable idle window so we
// don't pin ~150 MB of RAM forever.
//
// Refcount model: every `acquire()` returns a borrow that the
// caller MUST `release()`. When the refcount hits zero, an idle
// timer starts; if it expires without another acquire, the
// underlying browser is closed. A subsequent acquire transparently
// re-launches.
//
// Tests inject a fake `launcher` to avoid bringing up real
// Chromium in the workspace test suite.

export interface BrowserLike {
  /** Close the browser. Mirrors `playwright-core` `Browser.close`. */
  close(): Promise<void>;
}

export interface BrowserLauncher {
  /** Launch a headless browser instance. */
  launch(): Promise<BrowserLike>;
}

export interface BrowserPoolOptions {
  /** Milliseconds the pool will keep a browser alive after the last
   *  release before closing it. Default 30000. */
  idleTimeoutMs?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

export class BrowserPool {
  readonly #launcher: BrowserLauncher;
  readonly #idleTimeoutMs: number;

  #browser: BrowserLike | undefined;
  #launching: Promise<BrowserLike> | undefined;
  #refcount = 0;
  #idleTimer: NodeJS.Timeout | undefined;

  constructor(launcher: BrowserLauncher, options: BrowserPoolOptions = {}) {
    this.#launcher = launcher;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  /**
   * Acquire a browser instance. The pool launches lazily on the
   * first call. Subsequent acquires return the same shared
   * instance until every borrow has been released and the idle
   * timeout has elapsed.
   *
   * The caller MUST call {@link release} (typically in a `finally`)
   * after they're done so the pool can track outstanding borrows
   * accurately.
   */
  async acquire(): Promise<BrowserLike> {
    this.#cancelIdleTimer();
    this.#refcount += 1;
    if (this.#browser) {
      return this.#browser;
    }
    if (!this.#launching) {
      this.#launching = this.#launcher
        .launch()
        .then((browser) => {
          this.#browser = browser;
          this.#launching = undefined;
          return browser;
        })
        .catch((err) => {
          // On launch failure we must clean up the speculative
          // refcount + launch promise so the next attempt can try
          // again from a clean slate.
          this.#launching = undefined;
          this.#refcount = Math.max(0, this.#refcount - 1);
          throw err;
        });
    }
    return this.#launching;
  }

  /**
   * Release a previously-acquired browser. Decrements the
   * refcount; when it reaches zero an idle timer starts. A
   * follow-up `acquire` within the idle window reuses the same
   * instance; otherwise the timer fires and the browser closes.
   */
  release(): void {
    if (this.#refcount === 0) {
      return; // unmatched release — defensively no-op.
    }
    this.#refcount -= 1;
    if (this.#refcount === 0 && this.#browser) {
      this.#scheduleIdleClose();
    }
  }

  /**
   * Close the pooled browser immediately, regardless of refcount.
   * Intended for explicit teardown (e.g. SIGINT / SIGTERM
   * handlers); regular flows should rely on the idle timer.
   */
  async shutdown(): Promise<void> {
    this.#cancelIdleTimer();
    const browser = this.#browser;
    this.#browser = undefined;
    this.#refcount = 0;
    if (browser) {
      await browser.close();
    }
  }

  /** Refcount of outstanding borrows. Exposed for tests / metrics. */
  get activeBorrows(): number {
    return this.#refcount;
  }

  /** Whether a browser is currently launched. Exposed for tests. */
  get isLaunched(): boolean {
    return this.#browser !== undefined;
  }

  // ─── internals ────────────────────────────────────────────────

  #cancelIdleTimer(): void {
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = undefined;
    }
  }

  #scheduleIdleClose(): void {
    this.#cancelIdleTimer();
    this.#idleTimer = setTimeout(() => {
      const browser = this.#browser;
      this.#browser = undefined;
      this.#idleTimer = undefined;
      // Fire-and-forget close. If close throws, the next acquire
      // simply launches a fresh browser; nothing else depends on
      // a clean teardown of the dead instance.
      browser?.close().catch(() => {
        /* ignore */
      });
    }, this.#idleTimeoutMs);
    // Don't keep the Node event loop alive on the idle timer alone
    // — the bin shim should exit cleanly when stdio closes.
    this.#idleTimer.unref?.();
  }
}

/**
 * Construct a {@link BrowserPool} backed by `playwright-core`'s
 * Chromium launcher. Uses dynamic import so consumers who never
 * touch `_url` tools don't pay the playwright-core load cost on
 * startup AND so we can surface a friendly error when the
 * package is missing (e.g. accidentally stripped from
 * dependencies).
 */
export function createChromiumPool(options: BrowserPoolOptions = {}): BrowserPool {
  return new BrowserPool(
    {
      async launch() {
        let chromium: typeof import("playwright-core").chromium;
        try {
          ({ chromium } = await import("playwright-core"));
        } catch (err) {
          throw new ChromiumUnavailableError(
            "Failed to load `playwright-core`. Reinstall `@ingcreators/annot-mcp` to restore the dependency.",
            err,
          );
        }
        try {
          return (await chromium.launch({ headless: true })) as unknown as BrowserLike;
        } catch (err) {
          throw new ChromiumUnavailableError(
            "Failed to launch Chromium. Run `npx playwright install chromium` to download the runtime, then retry.",
            err,
          );
        }
      },
    },
    options,
  );
}

export class ChromiumUnavailableError extends Error {
  override readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ChromiumUnavailableError";
    this.cause = cause;
  }
}
