/**
 * Phase 2e of `docs/plans/living-spec-authoring-roadmap.md`.
 * Tests for the legacy-`<Overlay>` soft-deprecation shim.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetLegacyOverlayDedupForTests,
  formatLegacyOverlayWarning,
  warnLegacyOverlay,
} from "./deprecation.js";

describe("formatLegacyOverlayWarning", () => {
  it("mentions the migration CLI", () => {
    const msg = formatLegacyOverlayWarning({
      mdxPath: "/abs/docs/login.mdx",
      screenId: "login",
      overlayCount: 3,
    });
    expect(msg).toContain("annot docs migrate-overlays-to-annotations");
    expect(msg).toContain("login");
    expect(msg).toContain("3 inline <Overlay>");
  });

  it("references OQ-08 so the removal schedule is discoverable", () => {
    const msg = formatLegacyOverlayWarning({
      mdxPath: "x.mdx",
      screenId: "y",
      overlayCount: 1,
    });
    expect(msg).toContain("OQ-08");
  });
});

describe("warnLegacyOverlay", () => {
  beforeEach(() => {
    _resetLegacyOverlayDedupForTests();
  });

  it("emits exactly once per (mdxPath, screenId) pair per process", () => {
    const emit = vi.fn();
    warnLegacyOverlay({ mdxPath: "a.mdx", screenId: "s1", overlayCount: 1 }, emit);
    warnLegacyOverlay({ mdxPath: "a.mdx", screenId: "s1", overlayCount: 1 }, emit);
    warnLegacyOverlay({ mdxPath: "a.mdx", screenId: "s1", overlayCount: 1 }, emit);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("differentiates pairs by mdxPath", () => {
    const emit = vi.fn();
    warnLegacyOverlay({ mdxPath: "a.mdx", screenId: "s1", overlayCount: 1 }, emit);
    warnLegacyOverlay({ mdxPath: "b.mdx", screenId: "s1", overlayCount: 1 }, emit);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("differentiates pairs by screenId", () => {
    const emit = vi.fn();
    warnLegacyOverlay({ mdxPath: "a.mdx", screenId: "s1", overlayCount: 1 }, emit);
    warnLegacyOverlay({ mdxPath: "a.mdx", screenId: "s2", overlayCount: 1 }, emit);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it("defaults to console.warn when no emitter supplied", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      warnLegacyOverlay({ mdxPath: "default.mdx", screenId: "s", overlayCount: 1 });
      expect(spy).toHaveBeenCalledTimes(1);
      const [line] = spy.mock.calls[0]!;
      expect(line).toMatch(/migrate-overlays-to-annotations/);
    } finally {
      spy.mockRestore();
    }
  });
});
