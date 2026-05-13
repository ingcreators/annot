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
 *
 * The diff-detection logic itself has its own test suite
 * (`diff-detection.test.ts`); this file scopes to engine plumbing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoCaptureEngine } from "./auto-capture.js";
import { CandidateStore } from "./candidate-store.js";
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

describe("AutoCaptureEngine", () => {
  it("schedules ticks via setTimeout once started", () => {
    const session = makeFakeSession();
    const store = new CandidateStore();
    const engine = new AutoCaptureEngine({
      session,
      store,
      intervalMs: 1000,
      stableWaitMs: 700,
      minMsBetweenCaptures: 1500,
      comparisonWidth: 320,
      ignoreCursorOnlyChanges: true,
    });
    expect(engine.isRunning).toBe(false);
    engine.start();
    expect(engine.isRunning).toBe(true);
    // Drive a tick — getVideoElementForSampling returns null so
    // no diff happens, but the engine should re-schedule.
    void vi.advanceTimersByTimeAsync(0);
    engine.stop();
    expect(engine.isRunning).toBe(false);
  });

  it("stops when the session reports it's no longer live", async () => {
    const session = makeFakeSession({ isLive: false });
    const store = new CandidateStore();
    const engine = new AutoCaptureEngine({
      session,
      store,
      intervalMs: 1000,
      stableWaitMs: 700,
      minMsBetweenCaptures: 1500,
      comparisonWidth: 320,
      ignoreCursorOnlyChanges: true,
    });
    engine.start();
    await vi.advanceTimersByTimeAsync(50);
    // Engine self-stops on first tick because session.isLive is false.
    expect(engine.isRunning).toBe(false);
  });

  it("resetBaseline() drops state to idle", () => {
    const session = makeFakeSession();
    const store = new CandidateStore();
    const stateChanges: string[] = [];
    const engine = new AutoCaptureEngine({
      session,
      store,
      intervalMs: 1000,
      stableWaitMs: 700,
      minMsBetweenCaptures: 1500,
      comparisonWidth: 320,
      ignoreCursorOnlyChanges: true,
      onStateChange: (s) => stateChanges.push(s),
    });
    engine.resetBaseline();
    // Already idle internally; setState short-circuits when state
    // doesn't change. This asserts the public method doesn't
    // throw.
    expect(engine.state).toBe("idle");
  });

  it("stop() is idempotent", () => {
    const session = makeFakeSession();
    const store = new CandidateStore();
    const engine = new AutoCaptureEngine({
      session,
      store,
      intervalMs: 1000,
      stableWaitMs: 700,
      minMsBetweenCaptures: 1500,
      comparisonWidth: 320,
      ignoreCursorOnlyChanges: true,
    });
    expect(() => {
      engine.stop();
      engine.stop();
    }).not.toThrow();
  });

  it("recovers from dimension change instead of throwing on every tick", async () => {
    // Regression for the user-reported "screen change isn't detected
    // after window resize" bug. Before the fix, the engine cached a
    // baseline at the original source dimensions; when the user
    // resized the shared window, every subsequent
    // `computeDiffScore(baseline, current)` threw a dimension-
    // mismatch error which `#tick`'s try / catch swallowed
    // silently — engine paralysed.
    //
    // Drive a controlled scenario: stub canvas's `getContext` so
    // `#processFrame` actually runs (happy-dom returns null without
    // the stub). Pre-seed `getImageData` to return the engine's
    // current target dimensions so we can flip them mid-test and
    // assert recovery.
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

    // Session reports the shared window's dimensions. We flip them
    // mid-test to simulate a user resize.
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

    const store = new CandidateStore();
    const engine = new AutoCaptureEngine({
      session,
      store,
      intervalMs: 1000,
      stableWaitMs: 700,
      minMsBetweenCaptures: 0, // disable throttle for the test
      comparisonWidth: 320,
      ignoreCursorOnlyChanges: false,
    });

    engine.start();
    // First tick: engine establishes baseline + first capture.
    await vi.advanceTimersByTimeAsync(50);
    const beforeResize = store.size;
    expect(beforeResize).toBeGreaterThanOrEqual(1);

    // Simulate user resize. New target dimensions for the
    // comparison canvas (engine recomputes from sourceW / sourceH).
    sourceW = 1916;
    sourceH = 1872;
    nextW = 320; // comparisonWidth stays 320
    nextH = Math.round((1872 / 1916) * 320); // proportional new height

    // Without the fix, this tick would throw; the engine would log
    // the error and re-schedule. Subsequent ticks would do the same
    // forever. With the fix, the engine resets the baseline to the
    // new dimensions and captures a fresh frame.
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.size).toBeGreaterThan(beforeResize);
    engine.stop();
  });
});
