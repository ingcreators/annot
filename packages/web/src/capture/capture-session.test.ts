// @vitest-environment happy-dom

/**
 * Smoke tests for `CaptureSession`. happy-dom doesn't fully implement
 * `HTMLMediaElement.srcObject` or `<canvas>.getContext("2d")` — both
 * succeed in real browsers but not under the test runner — so we only
 * exercise the surfaces that are testable here:
 *
 *   - `start()` returns false when `getDisplayMedia` rejects.
 *   - `stop()` is idempotent.
 *   - the constructor accepts the documented options shape.
 *
 * The full lifecycle (attach stream, capture frame, fire `ended`) is
 * exercised end-to-end during the manual verification step listed in
 * `docs/plans/web-capture-redesign.md` (`pnpm --filter
 * @ingcreators/annot-web dev` → `Capture Screen...` → real screen
 * picker).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptureSession } from "./capture-session.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CaptureSession", () => {
  it("returns false when getDisplayMedia rejects (user cancelled)", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia: vi.fn().mockRejectedValue(new Error("cancelled")) },
    });

    const video = document.createElement("video");
    const session = new CaptureSession({ video });
    const ok = await session.start();
    expect(ok).toBe(false);
    expect(session.isLive).toBe(false);
  });

  it("stop() is idempotent (safe to call repeatedly)", () => {
    const video = document.createElement("video");
    const session = new CaptureSession({ video });
    expect(() => session.stop()).not.toThrow();
    expect(() => session.stop()).not.toThrow();
    expect(session.isLive).toBe(false);
  });

  it("threads the cursor preference through the constructor", () => {
    const video = document.createElement("video");
    const session = new CaptureSession({ video, cursor: "never" });
    // No public getter for cursor — round-trip is exercised through
    // start() in real browsers. Constructor not throwing is the
    // only assertion we can make here.
    expect(session.isLive).toBe(false);
  });
});
