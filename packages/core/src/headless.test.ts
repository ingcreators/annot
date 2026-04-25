// Default `node` environment — no `happy-dom`, no `document`, no `window`.
// This is the ENTIRE point of the test: importing `@ingcreators/annot-core/headless`
// must succeed in pure Node, the same way the future Playwright fixture and
// GitHub Action would. If any DOM-dependent symbol leaks into the headless
// barrel, the import below throws `ReferenceError: document is not defined`
// at module load time and the test fails.
//
// Stage 4-1 of `docs/plans/pre-release-cleanup.md` — codify the headless
// boundary so any new symbol that pulls in DOM access is caught before it
// breaks downstream consumers.

import { describe, expect, it } from "vitest";
import * as headless from "./headless.js";

describe("@ingcreators/annot-core/headless boundary", () => {
  it("imports cleanly under a pure-Node environment", () => {
    // The `import` above is the actual assertion — if it threw, vitest
    // would surface the load-time error long before this `it` runs. The
    // expect below just gives the test a visible body so the suite shows
    // up in the run output.
    expect(typeof headless).toBe("object");
  });

  it("exports the documented headless surface", () => {
    // Spot-check a representative symbol from each section of headless.ts
    // (storage types are erased at runtime, so they aren't checked here).
    expect(typeof headless.ANNOT_SVG_VERSION).toBe("string");
    expect(typeof headless.joinPath).toBe("function");
    expect(typeof headless.assertNonNull).toBe("function");
    expect(typeof headless.newIdB58).toBe("function");
    expect(typeof headless.buildZip).toBe("function");
    expect(typeof headless.computeDasharray).toBe("function");
    // Capability predicates added in Stage 2.
    expect(typeof headless.supportsResync).toBe("function");
    expect(typeof headless.supportsForceRefresh).toBe("function");
    expect(typeof headless.supportsTokenRefresher).toBe("function");
  });

  it("does not leak `document` / `window` into the importing context", () => {
    // The `node` environment makes these globals undefined. If a
    // headless-side module had `(globalThis as any).document = …` in its
    // top-level code (a polyfill leak), this would catch it.
    // (`navigator` is intentionally not checked — Node 21+ exposes a
    // built-in `globalThis.navigator`, so its presence isn't a signal.)
    const g = globalThis as Record<string, unknown>;
    expect(g.document).toBeUndefined();
    expect(g.window).toBeUndefined();
  });
});
