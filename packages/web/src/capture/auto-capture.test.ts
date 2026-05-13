// @vitest-environment happy-dom

/**
 * `AutoCaptureEngine` — happy-dom unit tests with a fake clock and
 * a fake `CaptureSession`. happy-dom's `<canvas>` doesn't paint, so
 * we monkey-patch the engine's comparison canvas's
 * `getContext("2d")` to return null on the path that would call
 * `getImageData` — the engine handles that gracefully and skips
 * the tick. The transitions we CAN drive are:
 *
 *   - `start()` schedules the loop
 *   - `stop()` clears the timer
 *   - the engine no-ops cleanly when `session.isLive` becomes
 *     false (after a `stop()` from another path)
 *   - `resetBaseline()` flips state to idle
 *   - dimension change recovery (regression for the resize bug)
 *
 * The diff-detection logic itself has its own test suite
 * (`diff-detection.test.ts`); this file scopes to engine plumbing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AutoCaptureEngine,
  type AutoCaptureFrame,
  type AutoCaptureOptions,
} from "./auto-capture.js";
import type { CaptureSession } from "./capture-session.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function makeFakeSession(opts: { isLive?: boolean } = {}): CaptureSession {
  const isLive = opts.isLive ?? true;
  return {
    isLive,
    sourceWidth: 1280,
    sourceHeight: 720,
    captureFrame: vi.fn().mockReturnValue({
      dataUrl: "data:image/jpeg;base64,YWFh",
      width: 1280,
      height: 720,
    }),
    getVideoElementForSampling: vi.fn().mockReturnValue(null),
    stop: vi.fn(),
  } as unknown as CaptureSession;
}

function makeOpts(
  overrides: { session?: CaptureSession; onCaptureReady?: (frame: AutoCaptureFrame) => void } = {},
): AutoCaptureOptions {
  let capturedCount = 0;
  return {
    session: overrides.session ?? makeFakeSession(),
    intervalMs: 1000,
    stableWaitMs: 700,
    minMsBetweenCaptures: 1500,
    comparisonWidth: 320,
    ignoreCursorOnlyChanges: true,
    getCapturedCount: () => capturedCount,
    onCaptureReady:
      overrides.onCaptureReady ??
      (() => {
        capturedCount++;
      }),
  };
}

describe("AutoCaptureEngine", () => {
  it("schedules ticks via setTimeout once started", () => {
    const engine = new AutoCaptureEngine(makeOpts());
    expect(engine.isRunning).toBe(false);
    engine.start();
    expect(engine.isRunning).toBe(true);
    void vi.advanceTimersByTimeAsync(0);
    engine.stop();
    expect(engine.isRunning).toBe(false);
  });

  it("stops when the session reports it's no longer live", async () => {
    const engine = new AutoCaptureEngine(makeOpts({ session: makeFakeSession({ isLive: false }) }));
    engine.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(engine.isRunning).toBe(false);
  });

  it("resetBaseline() drops state to idle", () => {
    const engine = new AutoCaptureEngine(makeOpts());
    engine.resetBaseline();
    expect(engine.state).toBe("idle");
  });

  it("stop() is idempotent", () => {
    const engine = new AutoCaptureEngine(makeOpts());
    expect(() => {
      engine.stop();
      engine.stop();
    }).not.toThrow();
  });

  it("recovers from dimension change instead of throwing on every tick", async () => {
    // Regression for "screen change isn't detected after window
    // resize" — the engine cached a baseline at original source
    // dims; resizing the shared window triggered a
    // `computeDiffScore` dimension-mismatch throw on every tick.
    // The fix: re-baseline + fire a fresh capture instead.
    let nextW = 320;
    let nextH = 180;
    const fakeCtx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => {
        const data = new Uint8ClampedArray(nextW * nextH * 4);
        return {
          data,
          width: nextW,
          height: nextH,
          colorSpace: "srgb",
        } as unknown as ImageData;
      }),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(fakeCtx);

    let sourceW = 1280;
    let sourceH = 720;
    const session = {
      get isLive() {
        return true;
      },
      get sourceWidth() {
        return sourceW;
      },
      get sourceHeight() {
        return sourceH;
      },
      captureFrame: vi.fn().mockReturnValue({
        dataUrl: "data:image/jpeg;base64,YWFh",
        width: 1280,
        height: 720,
      }),
      getVideoElementForSampling: vi.fn().mockReturnValue({} as HTMLVideoElement),
      stop: vi.fn(),
    } as unknown as CaptureSession;

    let captureCount = 0;
    const onCaptureReady = vi.fn(() => {
      captureCount++;
    });

    const engine = new AutoCaptureEngine({
      session,
      intervalMs: 1000,
      stableWaitMs: 700,
      minMsBetweenCaptures: 0, // disable throttle for the test
      comparisonWidth: 320,
      ignoreCursorOnlyChanges: false,
      getCapturedCount: () => captureCount,
      onCaptureReady,
    });

    engine.start();
    // First tick: engine establishes baseline + first capture.
    await vi.advanceTimersByTimeAsync(50);
    const beforeResize = captureCount;
    expect(beforeResize).toBeGreaterThanOrEqual(1);

    // Simulate user resize. New target dimensions for the
    // comparison canvas.
    sourceW = 1916;
    sourceH = 1872;
    nextW = 320;
    nextH = Math.round((1872 / 1916) * 320);

    await vi.advanceTimersByTimeAsync(1000);
    expect(captureCount).toBeGreaterThan(beforeResize);
    engine.stop();
  });
});
