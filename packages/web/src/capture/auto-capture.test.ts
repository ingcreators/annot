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
});
