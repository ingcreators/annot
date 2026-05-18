// Tier-A invariant verification — kept and extended through Phase 1.
//
// `packages/core/src/headless.test.ts` proves `annot-core/headless`
// imports cleanly in a pure Node environment. This test sharpens
// that claim: it imports `headless` AND the annotator's full
// public surface (which transitively imports `@resvg/resvg-js` +
// `@xmldom/xmldom`) in the same process, then confirms `document`
// and `window` are still absent from `globalThis`. If any of those
// modules had polluted globals at import time, this test would fail.
//
// The vitest config sets `environment: "node"` globally (see
// `vitest.config.ts`), so this test runs under V8 with no DOM
// polyfill. That is the same Node runtime an eventual Playwright
// fixture or GitHub Action would run on.

import * as headless from "@ingcreators/annot-core/headless";
import { describe, expect, it } from "vitest";
import { createAnnotator } from "./annotator.js";
import { sanitiseAnnotationsSvg } from "./sanitise-svg.js";

describe("Tier A coexistence under plain Node", () => {
  it("imports annot-core/headless + the annotator surface in one process", () => {
    expect(typeof headless.ANNOT_SVG_VERSION).toBe("string");
    expect(typeof createAnnotator).toBe("function");
    expect(typeof sanitiseAnnotationsSvg).toBe("function");
  });

  it("confirms no DOM global leaked into the test environment", () => {
    // `@xmldom/xmldom` exposes a `DOMParser` class via named exports,
    // but does NOT assign anything to `globalThis`. resvg-js is a
    // NAPI native addon — pure function surface, no global side
    // effects. annot-core/headless is provably DOM-free by its own
    // CI invariant. If any of these had drifted, this assertion
    // would catch it.
    expect(typeof (globalThis as Record<string, unknown>).document).toBe("undefined");
    expect(typeof (globalThis as Record<string, unknown>).window).toBe("undefined");
  });
});
