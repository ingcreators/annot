// @vitest-environment happy-dom

import { DEFAULT_AUTO_CAPTURE_OPTIONS } from "@ingcreators/annot-core/auto-capture-options";
import { afterEach, describe, expect, it } from "vitest";
import { loadAutoCaptureOptions, saveAutoCaptureOptions } from "./auto-capture-options.js";

afterEach(() => {
  localStorage.clear();
});

describe("loadAutoCaptureOptions", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadAutoCaptureOptions()).toEqual(DEFAULT_AUTO_CAPTURE_OPTIONS);
  });

  it("round-trips a fully-formed object", () => {
    const opts = {
      interval: "fast" as const,
      sensitivity: "major" as const,
      stableWait: "long" as const,
      ignoreCursorOnlyChanges: false,
    };
    saveAutoCaptureOptions(opts);
    expect(loadAutoCaptureOptions()).toEqual(opts);
  });

  it("falls back per-field when stored values are unrecognised", () => {
    localStorage.setItem(
      "annot-auto-capture-options",
      JSON.stringify({
        interval: "lightning",
        sensitivity: 5,
        stableWait: "forever",
        ignoreCursorOnlyChanges: "yes",
      }),
    );
    expect(loadAutoCaptureOptions()).toEqual(DEFAULT_AUTO_CAPTURE_OPTIONS);
  });

  it("returns defaults on a corrupt JSON blob", () => {
    localStorage.setItem("annot-auto-capture-options", "{not json");
    expect(loadAutoCaptureOptions()).toEqual(DEFAULT_AUTO_CAPTURE_OPTIONS);
  });

  it("preserves valid fields when other fields are bad", () => {
    localStorage.setItem(
      "annot-auto-capture-options",
      JSON.stringify({
        interval: "fast",
        sensitivity: "lol",
        stableWait: "long",
        ignoreCursorOnlyChanges: false,
      }),
    );
    const got = loadAutoCaptureOptions();
    expect(got.interval).toBe("fast");
    expect(got.stableWait).toBe("long");
    expect(got.ignoreCursorOnlyChanges).toBe(false);
    expect(got.sensitivity).toBe(DEFAULT_AUTO_CAPTURE_OPTIONS.sensitivity);
  });
});
