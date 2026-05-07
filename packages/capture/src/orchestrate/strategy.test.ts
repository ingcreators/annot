// Pure-Node tests for capture-strategy. Every input is a plain
// number / object; no chrome.* APIs, no DOM. Drives every branch of
// the segment plan + window-size math.

import { describe, expect, it } from "vitest";
import { MAX_CANVAS_DIMENSION } from "./constants.js";
import {
  computeChromeDelta,
  computeDesiredWindowSize,
  MIN_WINDOW_DIMENSION,
  pixelToCssSize,
  planScrollSegments,
} from "./strategy.js";

// ─── computeChromeDelta ──────────────────────────────────────────────

describe("computeChromeDelta", () => {
  it("subtracts the inner viewport from the outer window for both axes", () => {
    expect(computeChromeDelta({ width: 1280, height: 800 }, { width: 1264, height: 720 })).toEqual({
      width: 16,
      height: 80,
    });
  });

  it("clamps negative deltas (transparent overlay edge case) to 0", () => {
    // Some pages report a viewport LARGER than the window when a
    // translucent address bar overlays the page area; we don't want
    // a negative chrome height to subtract from the desired window.
    expect(computeChromeDelta({ width: 100, height: 100 }, { width: 200, height: 200 })).toEqual({
      width: 0,
      height: 0,
    });
  });

  it("returns zeros when either side is missing (window not yet measured)", () => {
    expect(computeChromeDelta({}, { width: 1264, height: 720 })).toEqual({ width: 0, height: 0 });
    expect(computeChromeDelta({ width: 1280, height: 800 }, {})).toEqual({ width: 0, height: 0 });
    expect(computeChromeDelta({}, {})).toEqual({ width: 0, height: 0 });
  });
});

// ─── pixelToCssSize ──────────────────────────────────────────────────

describe("pixelToCssSize", () => {
  it("returns the input unchanged when DPR = 1", () => {
    expect(pixelToCssSize({ width: 1920, height: 1080 }, 1)).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("divides by DPR for high-density displays", () => {
    expect(pixelToCssSize({ width: 1920, height: 1080 }, 2)).toEqual({ width: 960, height: 540 });
    expect(pixelToCssSize({ width: 1920, height: 1080 }, 1.5)).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("rounds to integers (window-size APIs require ints)", () => {
    // 100/3 = 33.333 → 33; 200/3 = 66.666 → 67.
    expect(pixelToCssSize({ width: 100, height: 200 }, 3)).toEqual({ width: 33, height: 67 });
  });

  it("treats DPR <= 0 as 1 to avoid division by zero", () => {
    expect(pixelToCssSize({ width: 100, height: 200 }, 0)).toEqual({ width: 100, height: 200 });
    expect(pixelToCssSize({ width: 100, height: 200 }, -2)).toEqual({ width: 100, height: 200 });
  });
});

// ─── computeDesiredWindowSize ────────────────────────────────────────

describe("computeDesiredWindowSize", () => {
  it("at DPR=1 with no chrome delta, returns the pixel target verbatim", () => {
    expect(computeDesiredWindowSize({ width: 1280, height: 720 }, 1, { width: 0, height: 0 })).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("adds the chrome delta to land the inner viewport on target", () => {
    // Target: 1280×720 pixels. DPR=1 → CSS 1280×720. Chrome
    // delta 16×100 → outer window must be 1296×820.
    expect(
      computeDesiredWindowSize({ width: 1280, height: 720 }, 1, { width: 16, height: 100 }),
    ).toEqual({ width: 1296, height: 820 });
  });

  it("compensates for high DPR by halving the CSS target before adding chrome", () => {
    // Target 1920×1080 physical at DPR=2 → CSS 960×540, plus 16×100
    // chrome → 976×640 outer window.
    expect(
      computeDesiredWindowSize({ width: 1920, height: 1080 }, 2, { width: 16, height: 100 }),
    ).toEqual({ width: 976, height: 640 });
  });

  it("clamps each dimension to MIN_WINDOW_DIMENSION", () => {
    // Tiny target: 50×50 → CSS 50×50 + 0 chrome → would be 50×50,
    // but clamps up to MIN_WINDOW_DIMENSION on each axis.
    expect(
      computeDesiredWindowSize({ width: 50, height: 50 }, 1, { width: 0, height: 0 }),
    ).toEqual({ width: MIN_WINDOW_DIMENSION, height: MIN_WINDOW_DIMENSION });
  });

  it("respects an alternative minDim", () => {
    expect(
      computeDesiredWindowSize({ width: 50, height: 50 }, 1, { width: 0, height: 0 }, 100),
    ).toEqual({ width: 100, height: 100 });
  });

  it("ignores negative chrome deltas (defensive — they would shrink the result)", () => {
    expect(
      computeDesiredWindowSize({ width: 1280, height: 720 }, 1, { width: -50, height: -50 }),
    ).toEqual({ width: 1280, height: 720 });
  });
});

// ─── planScrollSegments ──────────────────────────────────────────────

const dims = (over: Partial<Parameters<typeof planScrollSegments>[0]> = {}) => ({
  scrollWidth: 1280,
  scrollHeight: 3000,
  viewportWidth: 1280,
  viewportHeight: 800,
  devicePixelRatio: 1,
  ...over,
});

describe("planScrollSegments — segment layout", () => {
  it("produces ceil(scrollHeight / vpHeight) segments", () => {
    const plan = planScrollSegments(dims({ scrollHeight: 3000, viewportHeight: 800 }));
    // ceil(3000/800) = 4
    expect(plan.segments).toHaveLength(4);
  });

  it("walks scrollY top-down at viewport-height intervals for non-last segments", () => {
    const plan = planScrollSegments(dims({ scrollHeight: 3000, viewportHeight: 800 }));
    // numSegments=4. Non-last segments at i*800.
    expect(plan.segments[0]!.scrollY).toBe(0);
    expect(plan.segments[1]!.scrollY).toBe(800);
    expect(plan.segments[2]!.scrollY).toBe(1600);
  });

  it("shifts the last segment upward so its bottom aligns with the page bottom", () => {
    // 3000 / 800 = 3.75 → 4 segments. Last scrollY = 3000 - 800 = 2200,
    // NOT 3*800 = 2400 (which would put the bottom edge past the page).
    const plan = planScrollSegments(dims({ scrollHeight: 3000, viewportHeight: 800 }));
    expect(plan.segments[3]!.scrollY).toBe(2200);
    expect(plan.segments[3]!.isLast).toBe(true);
  });

  it("handles an exact multiple of the viewport (last segment NOT shifted)", () => {
    // 2400 / 800 = 3 exactly → 3 segments at 0, 800, 1600. Last
    // segment's scrollY would be 2400 - 800 = 1600, same as the
    // i*vp formula. Both expressions land on 1600.
    const plan = planScrollSegments(dims({ scrollHeight: 2400, viewportHeight: 800 }));
    expect(plan.segments).toHaveLength(3);
    expect(plan.segments.map((s) => s.scrollY)).toEqual([0, 800, 1600]);
  });

  it("returns a single segment at scrollY=0 for a page shorter than one viewport", () => {
    const plan = planScrollSegments(dims({ scrollHeight: 600, viewportHeight: 800 }));
    expect(plan.segments).toHaveLength(1);
    expect(plan.segments[0]).toEqual({ index: 0, scrollY: 0, isLast: true });
  });

  it("flags only the last segment with isLast=true", () => {
    const plan = planScrollSegments(dims({ scrollHeight: 3000, viewportHeight: 800 }));
    const lasts = plan.segments.map((s) => s.isLast);
    expect(lasts).toEqual([false, false, false, true]);
  });

  it("survives a zero-height viewport without infinite-loop / negative scrollY", () => {
    const plan = planScrollSegments(dims({ scrollHeight: 1000, viewportHeight: 0 }));
    expect(plan.segments).toHaveLength(1000); // ceil(1000 / 1)
    // No NaN, no negative scrollY — values are all numeric.
    expect(plan.segments.every((s) => Number.isFinite(s.scrollY))).toBe(true);
  });
});

describe("planScrollSegments — stitch dimensions", () => {
  it("stitchWidth = viewportWidth × DPR", () => {
    const plan = planScrollSegments(dims({ viewportWidth: 1280, devicePixelRatio: 2 }));
    expect(plan.stitchWidth).toBe(2560);
  });

  it("stitchHeight = scrollHeight × DPR when below cap", () => {
    const plan = planScrollSegments(dims({ scrollHeight: 3000, devicePixelRatio: 2 }));
    expect(plan.stitchHeight).toBe(6000);
    expect(plan.capped).toBe(false);
  });

  it("caps stitchHeight at maxCanvasDim and reports capped=true", () => {
    // 3000 × 2 = 6000 > cap 2000 → cap kicks in.
    const plan = planScrollSegments(dims({ scrollHeight: 3000, devicePixelRatio: 2 }), 2000);
    expect(plan.stitchHeight).toBe(2000);
    expect(plan.capped).toBe(true);
  });

  it("uses the published MAX_CANVAS_DIMENSION when no override is supplied", () => {
    // Construct dims that exactly hit the cap: scrollHeight × DPR == MAX.
    const cap = MAX_CANVAS_DIMENSION;
    const plan = planScrollSegments(dims({ scrollHeight: cap, devicePixelRatio: 1 }));
    // Boundary: capped iff natural > cap. natural == cap → not capped.
    expect(plan.capped).toBe(false);
    expect(plan.stitchHeight).toBe(cap);
  });
});

// ─── planPerPageStep ─────────────────────────────────────────────────

import {
  DEFAULT_MIN_LAST_PAGE_CONTENT_PX,
  planPerPageStep,
  type PerPageStepInput,
} from "./strategy.js";

const stepInput = (over: Partial<PerPageStepInput> = {}): PerPageStepInput => ({
  pageIndex: 0,
  nextDocTop: 0,
  viewportHeight: 800,
  scrollHeight: 3000,
  actualScrollY: 0,
  devicePixelRatio: 1,
  lastActualScrollY: -1,
  ...over,
});

describe("planPerPageStep — capture happy path", () => {
  it("first iteration of a tall page produces the top viewport-sized slice", () => {
    const out = planPerPageStep(stepInput());
    expect(out.action).toBe("capture");
    if (out.action !== "capture") return;
    expect(out.slice.intendedTopCss).toBe(0);
    expect(out.slice.intendedBotCss).toBe(800);
    expect(out.slice.sliceCss).toBe(800);
    expect(out.slice.srcYpx).toBe(0);
    expect(out.slice.sliceHeightPx).toBe(800);
    expect(out.slice.nextDocTopAfter).toBe(800);
    expect(out.slice.doneAfter).toBe(false);
  });

  it("scales the physical-pixel fields by devicePixelRatio", () => {
    const out = planPerPageStep(stepInput({ devicePixelRatio: 2 }));
    expect(out.action).toBe("capture");
    if (out.action !== "capture") return;
    expect(out.slice.srcYpx).toBe(0);
    expect(out.slice.sliceHeightPx).toBe(1600);
  });

  it("middle iteration: trims the captured PNG so srcYpx skips already-shown content", () => {
    // Page asked us to scroll to 1500 but the page only landed at 1200
    // (e.g. snap-stop), AND nextDocTop was 1500. The first 300 CSS
    // pixels of the captured PNG are content the previous slice
    // already showed, so srcYpx skips past them.
    const out = planPerPageStep(
      stepInput({
        pageIndex: 1,
        nextDocTop: 1500,
        actualScrollY: 1200,
        lastActualScrollY: 400,
      }),
    );
    expect(out.action).toBe("capture");
    if (out.action !== "capture") return;
    // intendedTopCss = max(1500, 1200) = 1500 → srcYpx = (1500 - 1200) * 1 = 300.
    expect(out.slice.intendedTopCss).toBe(1500);
    expect(out.slice.srcYpx).toBe(300);
    expect(out.slice.sliceCss).toBe(500); // 2000 - 1500
    expect(out.slice.nextDocTopAfter).toBe(2000);
  });

  it("clamps the bottom edge to scrollHeight when the viewport extends past the page", () => {
    // Last slice on a 2900-px page with 800 vp: scroll to 2200, vp
    // covers 2200..3000 — but scrollHeight is 2900, so the visible
    // bottom clamps to 2900. Slice height is 700, not 800.
    const out = planPerPageStep(
      stepInput({
        pageIndex: 3,
        nextDocTop: 2200,
        scrollHeight: 2900,
        actualScrollY: 2200,
        lastActualScrollY: 1500,
      }),
    );
    expect(out.action).toBe("capture");
    if (out.action !== "capture") return;
    expect(out.slice.sliceCss).toBe(700);
    expect(out.slice.nextDocTopAfter).toBe(2900);
    expect(out.slice.doneAfter).toBe(true);
  });
});

describe("planPerPageStep — stop conditions", () => {
  it("no-advance: actualScrollY beyond scrollHeight produces a 0 slice", () => {
    const out = planPerPageStep(
      stepInput({
        pageIndex: 1,
        nextDocTop: 3000,
        scrollHeight: 2900, // page got SHORTER (lazy-load reverted, etc.)
        actualScrollY: 2900,
        lastActualScrollY: 2200,
      }),
    );
    expect(out).toEqual({ action: "stop", reason: "no-advance" });
  });

  it("no-advance: viewport already past scrollHeight (visibleBot <= visibleTop)", () => {
    const out = planPerPageStep(
      stepInput({
        pageIndex: 2,
        nextDocTop: 5000,
        scrollHeight: 4000,
        actualScrollY: 4000,
        lastActualScrollY: 3000,
      }),
    );
    expect(out).toEqual({ action: "stop", reason: "no-advance" });
  });

  it("trailing-too-small: a final slice below the threshold is dropped", () => {
    // Page: 3000 px; we asked for 2950 → only 50 px of slice. Below
    // the 80 px threshold and pageIndex > 0 → stop.
    const out = planPerPageStep(
      stepInput({
        pageIndex: 3,
        nextDocTop: 2950,
        scrollHeight: 3000,
        actualScrollY: 2200,
        lastActualScrollY: 1500,
      }),
    );
    expect(out).toEqual({ action: "stop", reason: "trailing-too-small" });
  });

  it("trailing-too-small: NOT triggered on the first page (pageIndex=0)", () => {
    // Tiny page (50 px tall) — first capture should still produce a
    // slice rather than stopping with "trailing-too-small".
    const out = planPerPageStep(
      stepInput({
        pageIndex: 0,
        scrollHeight: 50,
        actualScrollY: 0,
      }),
    );
    expect(out.action).toBe("capture");
  });

  it("trailing-too-small: respects an alternative threshold", () => {
    // 30 px slice with a custom 20 px threshold → still captured.
    const out = planPerPageStep(
      stepInput({
        pageIndex: 2,
        nextDocTop: 2970,
        scrollHeight: 3000,
        actualScrollY: 2200,
        lastActualScrollY: 1500,
        minLastPageContentPx: 20,
      }),
    );
    expect(out.action).toBe("capture");
  });

  it("scroll-stuck: actualScrollY === lastActualScrollY AND intendedTop matches → stop", () => {
    // Page refuses to scroll past 1500 (sticky footer? CSS overflow trap?).
    // Two iterations in a row land at scrollY=1500 with nextDocTop=1500,
    // so the second iteration would just re-capture the same slice.
    const out = planPerPageStep(
      stepInput({
        pageIndex: 2,
        nextDocTop: 1500,
        actualScrollY: 1500,
        lastActualScrollY: 1500,
      }),
    );
    expect(out).toEqual({ action: "stop", reason: "scroll-stuck" });
  });

  it("does NOT trigger scroll-stuck when intendedTop is BEYOND lastActualScrollY", () => {
    // Same scrollY twice, BUT we're asking the page to advance further
    // than where it landed last time. That's a legitimate forward
    // advance (the page is just slow); not stuck.
    const out = planPerPageStep(
      stepInput({
        pageIndex: 1,
        nextDocTop: 2000,
        actualScrollY: 1500,
        lastActualScrollY: 1500,
      }),
    );
    expect(out.action).toBe("capture");
  });
});

describe("planPerPageStep — defaults", () => {
  it("DEFAULT_MIN_LAST_PAGE_CONTENT_PX matches the historical literal of 80", () => {
    expect(DEFAULT_MIN_LAST_PAGE_CONTENT_PX).toBe(80);
  });

  it("uses DEFAULT_MIN_LAST_PAGE_CONTENT_PX when minLastPageContentPx is omitted", () => {
    const out = planPerPageStep(
      stepInput({
        pageIndex: 1,
        nextDocTop: 2950,
        scrollHeight: 3000,
        actualScrollY: 2200,
        lastActualScrollY: 1500,
      }),
    );
    expect(out).toEqual({ action: "stop", reason: "trailing-too-small" });
  });
});

describe("planPerPageStep — sequencing simulation", () => {
  it("walks a 2400-px page in 3 captures + a final no-advance stop", () => {
    // Drive `planPerPageStep` like the orchestrator would, threading
    // outputs back into the next iteration's inputs. Asserts that
    // the loop terminates cleanly via `doneAfter` after the third
    // capture — no extra "fake" stop condition needed.
    const seq: ("capture" | { stop: string })[] = [];
    let pageIndex = 0;
    let nextDocTop = 0;
    let lastActualScrollY = -1;
    for (let i = 0; i < 6; i++) {
      // Page honors the requested scroll exactly (no clamping).
      const actualScrollY = Math.min(nextDocTop, 2400 - 800);
      const decision = planPerPageStep({
        pageIndex,
        nextDocTop,
        viewportHeight: 800,
        scrollHeight: 2400,
        actualScrollY,
        devicePixelRatio: 1,
        lastActualScrollY,
      });
      if (decision.action === "stop") {
        seq.push({ stop: decision.reason });
        break;
      }
      seq.push("capture");
      pageIndex += 1;
      nextDocTop = decision.slice.nextDocTopAfter;
      lastActualScrollY = actualScrollY;
      if (decision.slice.doneAfter) break;
    }
    // 2400 / 800 = 3 captures, then doneAfter ends the loop.
    expect(seq).toEqual(["capture", "capture", "capture"]);
  });
});
