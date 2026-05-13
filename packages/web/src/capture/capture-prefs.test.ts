// @vitest-environment happy-dom

/**
 * Round-trip tests for the localStorage-backed capture prefs. Both
 * helpers are pure wrappers over `localStorage` so the only failure
 * modes worth exercising are: defaults when unset, persistence on
 * write, and rejection of values outside the union.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  loadCursorPreference,
  loadModePreference,
  saveCursorPreference,
  saveModePreference,
} from "./capture-prefs.js";

afterEach(() => {
  localStorage.clear();
});

describe("capture-prefs", () => {
  describe("cursor preference", () => {
    it("defaults to 'always' when nothing is stored", () => {
      expect(loadCursorPreference()).toBe("always");
    });

    it("persists 'motion' across load", () => {
      saveCursorPreference("motion");
      expect(loadCursorPreference()).toBe("motion");
    });

    it("persists 'never' across load", () => {
      saveCursorPreference("never");
      expect(loadCursorPreference()).toBe("never");
    });

    it("falls back to 'always' on unrecognised stored value", () => {
      localStorage.setItem("annot-capture-cursor", "garbage");
      expect(loadCursorPreference()).toBe("always");
    });
  });

  describe("mode preference", () => {
    it("defaults to 'auto' when nothing is stored", () => {
      expect(loadModePreference()).toBe("auto");
    });

    it("persists 'once' across load", () => {
      saveModePreference("once");
      expect(loadModePreference()).toBe("once");
    });

    it("persists 'area' across load", () => {
      saveModePreference("area");
      expect(loadModePreference()).toBe("area");
    });

    it("falls back to 'auto' on unrecognised stored value", () => {
      localStorage.setItem("annot-capture-mode", "garbage");
      expect(loadModePreference()).toBe("auto");
    });
  });
});
