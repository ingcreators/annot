/**
 * Unit tests for the popup-vs-tab classification (Phase 5B of
 * `docs/plans/desktop-browser-mode.md`).
 *
 * Covers every features-string permutation the Browse window's
 * embedded `<webview>` realistically hands `setWindowOpenHandler`,
 * including the OAuth popups this PR's classifier exists to
 * preserve. The handler logic in `main.ts` is a thin wrapper
 * around `classifyWindowOpenRequest` — testing the classifier
 * here means the wrapper is mostly mechanical.
 */

import { describe, expect, it } from "vitest";
import {
  classifyWindowOpenRequest,
  hasExplicitDimensions,
  parseFeatureDim,
} from "./webview-popup-policy.js";

describe("hasExplicitDimensions", () => {
  it("returns true when width is set", () => {
    expect(hasExplicitDimensions("width=600")).toBe(true);
  });
  it("returns true when height is set", () => {
    expect(hasExplicitDimensions("height=700")).toBe(true);
  });
  it("returns true when both are set with extra features", () => {
    expect(hasExplicitDimensions("popup,width=600,height=700,resizable=1")).toBe(true);
  });
  it("returns false for empty features (target='_blank')", () => {
    expect(hasExplicitDimensions("")).toBe(false);
  });
  it("returns false for popup=1 / resizable=1 with no dims", () => {
    expect(hasExplicitDimensions("popup=1,resizable=1")).toBe(false);
  });
  it("is case-insensitive (Width / HEIGHT)", () => {
    expect(hasExplicitDimensions("Width=600")).toBe(true);
    expect(hasExplicitDimensions("HEIGHT=700")).toBe(true);
  });
  it("ignores width-prefixed-but-not-key tokens", () => {
    // "widthIsh=600" doesn't start with "width=" so it shouldn't
    // count.
    expect(hasExplicitDimensions("widthIsh=600")).toBe(false);
  });
});

describe("parseFeatureDim", () => {
  it("returns the parsed integer", () => {
    expect(parseFeatureDim("width=600", "width")).toBe(600);
    expect(parseFeatureDim("height=700,width=600", "height")).toBe(700);
  });
  it("returns null when the key is missing", () => {
    expect(parseFeatureDim("popup=1", "width")).toBeNull();
  });
  it("returns null for non-numeric values", () => {
    expect(parseFeatureDim("width=foo", "width")).toBeNull();
  });
  it("returns null for zero / negative (defensive)", () => {
    expect(parseFeatureDim("width=0", "width")).toBeNull();
  });
  it("ignores whitespace around the value", () => {
    expect(parseFeatureDim("popup=1, width=600 ,resizable=1", "width")).toBe(600);
  });
});

describe("classifyWindowOpenRequest", () => {
  it("classifies OAuth-pattern popup as 'popup' with parsed dims", () => {
    const result = classifyWindowOpenRequest({
      url: "https://accounts.google.com/o/oauth2/auth?...",
      features: "width=480,height=640,popup=1",
      disposition: "new-window",
    });
    expect(result).toEqual({ kind: "popup", width: 480, height: 640 });
  });

  it("classifies target='_blank' as 'tab' (no features)", () => {
    const result = classifyWindowOpenRequest({
      url: "https://example.com/article",
      features: "",
      disposition: "foreground-tab",
    });
    expect(result).toEqual({ kind: "tab" });
  });

  it("classifies bare window.open(url) as 'tab' (no dims)", () => {
    const result = classifyWindowOpenRequest({
      url: "https://example.com/",
      features: "",
      disposition: "new-window",
    });
    expect(result).toEqual({ kind: "tab" });
  });

  it("uses default dims when only one of width/height is present", () => {
    const heightOnly = classifyWindowOpenRequest({
      url: "https://appleid.apple.com/auth/authorize",
      features: "height=600",
      disposition: "new-window",
    });
    expect(heightOnly.kind).toBe("popup");
    if (heightOnly.kind === "popup") {
      expect(heightOnly.height).toBe(600);
      expect(heightOnly.width).toBe(600); // DEFAULT_POPUP_WIDTH
    }

    const widthOnly = classifyWindowOpenRequest({
      url: "https://example.com/popup",
      features: "width=400",
      disposition: "new-window",
    });
    expect(widthOnly.kind).toBe("popup");
    if (widthOnly.kind === "popup") {
      expect(widthOnly.width).toBe(400);
      expect(widthOnly.height).toBe(700); // DEFAULT_POPUP_HEIGHT
    }
  });

  it("classifies popup with non-numeric dims as 'popup' with fallback dims", () => {
    // Edge case: features contains `width=` but the value is bogus.
    // We still treat it as popup (the explicit `width=` is intent
    // signal) but use fallback dimensions.
    const result = classifyWindowOpenRequest({
      url: "https://example.com/oauth",
      features: "width=foo,height=bar",
      disposition: "new-window",
    });
    expect(result).toEqual({ kind: "popup", width: 600, height: 700 });
  });
});
