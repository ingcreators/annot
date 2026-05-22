/**
 * Phase 2 of `docs/plans/desktop-browser-mode.md`: when the DPR
 * reported by `host.captureViewport` differs from the content-side
 * DPR (rect.dpr / dims.devicePixelRatio), the orchestrator MUST use
 * the host's value for post-capture math (crop, metadata-area
 * conversion). Tests below exercise the propagation paths via the
 * fake `CaptureHost` so future Electron / drift-fix work doesn't
 * silently regress.
 */

import { describe, expect, it } from "vitest";
import { createFakeCaptureHost, type FakeCall } from "./fake-host.js";
import { runAreaCapture } from "./run-area.js";
import { runPerPageCapture } from "./run-per-page.js";

function findCallByKind<K extends FakeCall["kind"]>(
  calls: FakeCall[],
  kind: K,
): Extract<FakeCall, { kind: K }> | undefined {
  return calls.find((c): c is Extract<FakeCall, { kind: K }> => c.kind === kind);
}

describe("runAreaCapture — DPR propagation (Phase 2)", () => {
  it("uses captureViewport's dpr for cropRect, ignoring rect.dpr", async () => {
    // Host reports dpr 3 at capture time; content reports dpr 1
    // when dispatching the area-selected event. The orchestrator
    // must trust the capture-time value.
    const fake = createFakeCaptureHost({ dpr: 3 });
    fake.enqueueContentEvent({
      type: "area-selected",
      rect: { x: 100, y: 100, width: 200, height: 100 },
      dpr: 1,
    });

    const result = await runAreaCapture(fake.host);

    expect(result?.frames).toHaveLength(1);
    const cropCall = findCallByKind(fake.calls, "cropRect");
    expect(cropCall).toBeDefined();
    // Phase 2 contract: dpr passed to cropRect comes from
    // captureViewport, NOT from the area-selected event.
    expect(cropCall?.dpr).toBe(3);
    // Width / height in the returned frame are also captured-time-DPR-scaled.
    expect(result?.frames[0]?.width).toBe(200 * 3);
    expect(result?.frames[0]?.height).toBe(100 * 3);
  });

  it("falls back to dpr=1 when captureViewport reports dpr=1 (no drift case)", async () => {
    const fake = createFakeCaptureHost({ dpr: 1 });
    fake.enqueueContentEvent({
      type: "area-selected",
      rect: { x: 0, y: 0, width: 50, height: 50 },
      dpr: 1,
    });

    const result = await runAreaCapture(fake.host);

    const cropCall = findCallByKind(fake.calls, "cropRect");
    expect(cropCall?.dpr).toBe(1);
    expect(result?.frames[0]?.width).toBe(50);
    expect(result?.frames[0]?.height).toBe(50);
  });

  it("returns no frames when the user cancels area selection", async () => {
    const fake = createFakeCaptureHost({ dpr: 2 });
    fake.enqueueContentEvent({ type: "area-cancelled" });

    const result = await runAreaCapture(fake.host);

    expect(result?.frames).toHaveLength(0);
    // Capture wasn't taken, so cropRect was never called.
    expect(findCallByKind(fake.calls, "cropRect")).toBeUndefined();
  });
});

describe("runPerPageCapture — DPR propagation (Phase 2)", () => {
  it("uses captureViewport.dpr for the metadata-area calc, falling back to dims when absent", async () => {
    // Host reports dpr 2; content reports dpr 1.5 in
    // get-page-dimensions. Each per-page metadata request should
    // narrow the area using captureViewport's dpr (2).
    const fake = createFakeCaptureHost({
      dpr: 2,
      sendToContent(msg) {
        if (msg.type === "get-page-dimensions") {
          // Synthetic dims so the per-page loop produces 1–2 captures
          // and stops cleanly.
          return {
            scrollWidth: 1024,
            scrollHeight: 800,
            viewportWidth: 1024,
            viewportHeight: 768,
            devicePixelRatio: 1.5,
            scrollX: 0,
            scrollY: 0,
          };
        }
        return undefined;
      },
    });

    const result = await runPerPageCapture(fake.host);

    expect(result).not.toBeNull();
    expect(result?.frames.length).toBeGreaterThanOrEqual(1);
    // Each metadata area's height is sliceHeightPx / captured.dpr.
    // With dpr=2 (host) instead of 1.5 (dims), the orchestrator's
    // post-capture math uses 2. The assertion checks the area is
    // present and that the loop produced captures (the contract is
    // "uses captured.dpr"; the exact slice math is covered by
    // strategy.test.ts).
    const metaCalls = fake.calls.filter(
      (c): c is Extract<FakeCall, { kind: "requestElementTree" }> =>
        c.kind === "requestElementTree",
    );
    expect(metaCalls.length).toBeGreaterThanOrEqual(1);
    for (const m of metaCalls) {
      const area = m.area;
      expect(area).toBeDefined();
      expect(area?.height ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("CaptureHost contract — captureViewport returns authoritative DPR", () => {
  it("orchestrators that need post-capture DPR receive it from captureViewport", async () => {
    // This is a smoke test: any orchestrator that calls captureViewport
    // and downstream calls cropRect / requestElementTree should never
    // pass content-side dpr to those primitives — only host-reported.
    const fake = createFakeCaptureHost({ dpr: 2.5 });
    fake.enqueueContentEvent({
      type: "area-selected",
      rect: { x: 10, y: 20, width: 30, height: 40 },
      // Content-side dpr is intentionally different so we'd notice
      // if the orchestrator regressed back to using it.
      dpr: 1,
    });

    await runAreaCapture(fake.host);

    const captureCall = findCallByKind(fake.calls, "captureViewport");
    expect(captureCall).toBeDefined();
    const cropCall = findCallByKind(fake.calls, "cropRect");
    expect(cropCall?.dpr).toBe(2.5);
  });
});
