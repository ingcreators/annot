// Phase 0 spike — Tier A invariant verification.
//
// `packages/core/src/headless.test.ts` proves `annot-core/headless`
// imports cleanly in a pure Node environment. This test sharpens
// that claim: it imports `headless` AND `@resvg/resvg-js` AND the
// new `render.ts` module in the same process, then confirms the
// surface is usable. If any of these transitively pulled in a
// browser global, this test would throw at load time.
//
// The vitest config sets `environment: "node"` globally (see
// `vitest.config.ts`), so this test runs under V8 with no DOM
// polyfill. That is the same Node runtime an eventual Playwright
// fixture or GitHub Action would run on.

import * as headless from "@ingcreators/annot-core/headless";
import { describe, expect, it } from "vitest";
import { renderImageRecordToPngBytes } from "./render.js";

describe("Phase 0 spike — Tier A coexistence", () => {
  it("imports annot-core/headless + resvg-js in the same Node process", () => {
    // Spot-check both surfaces are live. If either failed to load,
    // vitest would have surfaced the import-time error before this
    // body runs.
    expect(typeof headless.ANNOT_SVG_VERSION).toBe("string");
    expect(typeof renderImageRecordToPngBytes).toBe("function");
  });

  it("confirms no DOM global leaked into the test environment", () => {
    // The annot-core headless boundary AND resvg-js are both
    // supposed to work without `document` / `window`. If a test-
    // setup file (or one of those modules at load time) had
    // installed a polyfill, this would fail.
    expect(typeof (globalThis as Record<string, unknown>).document).toBe("undefined");
    expect(typeof (globalThis as Record<string, unknown>).window).toBe("undefined");
  });
});
