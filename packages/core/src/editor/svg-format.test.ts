// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  ANNOT_SVG_VERSION,
  ANNOT_SVG_VERSION_ATTR,
  ANNOT_SVG_VERSION_UNSTAMPED,
  getAnnotVersionFromString,
  readAnnotVersion,
  stampAnnotVersion,
} from "./svg-format.js";

describe("ANNOT_SVG_VERSION_* constants", () => {
  it("exposes the current version as a string", () => {
    expect(typeof ANNOT_SVG_VERSION).toBe("string");
    expect(ANNOT_SVG_VERSION).toBe("1");
  });

  it("exposes the unstamped sentinel", () => {
    expect(ANNOT_SVG_VERSION_UNSTAMPED).toBe("0");
  });

  it("exposes the attribute name used on the SVG root", () => {
    expect(ANNOT_SVG_VERSION_ATTR).toBe("data-annot-version");
  });
});

describe("stampAnnotVersion + readAnnotVersion (round trip via DOM)", () => {
  const ns = "http://www.w3.org/2000/svg";

  it("stamps the current version onto a fresh SVG root", () => {
    const svg = document.createElementNS(ns, "svg");
    stampAnnotVersion(svg);
    expect(svg.getAttribute(ANNOT_SVG_VERSION_ATTR)).toBe(ANNOT_SVG_VERSION);
  });

  it("readAnnotVersion returns the stamped version", () => {
    const svg = document.createElementNS(ns, "svg");
    stampAnnotVersion(svg);
    expect(readAnnotVersion(svg)).toBe(ANNOT_SVG_VERSION);
  });

  it("readAnnotVersion returns the unstamped sentinel for unstamped SVG", () => {
    const svg = document.createElementNS(ns, "svg");
    expect(readAnnotVersion(svg)).toBe(ANNOT_SVG_VERSION_UNSTAMPED);
  });

  it("stampAnnotVersion is idempotent", () => {
    const svg = document.createElementNS(ns, "svg");
    stampAnnotVersion(svg);
    stampAnnotVersion(svg);
    expect(svg.getAttribute(ANNOT_SVG_VERSION_ATTR)).toBe(ANNOT_SVG_VERSION);
  });

  it("stampAnnotVersion overwrites a stale older version", () => {
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute(ANNOT_SVG_VERSION_ATTR, "0");
    stampAnnotVersion(svg);
    expect(svg.getAttribute(ANNOT_SVG_VERSION_ATTR)).toBe(ANNOT_SVG_VERSION);
  });
});

describe("getAnnotVersionFromString (pure text probe)", () => {
  it("finds the attribute on the SVG root", () => {
    const s = `<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1"><g/></svg>`;
    expect(getAnnotVersionFromString(s)).toBe("1");
  });

  it("returns the unstamped sentinel when the attribute is absent", () => {
    const s = `<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>`;
    expect(getAnnotVersionFromString(s)).toBe(ANNOT_SVG_VERSION_UNSTAMPED);
  });

  it("handles non-1 version strings (future-proofing)", () => {
    const s = `<svg data-annot-version="2-rc1"></svg>`;
    expect(getAnnotVersionFromString(s)).toBe("2-rc1");
  });

  it("picks the first occurrence when the attribute appears more than once", () => {
    // Defensive regression check: first-occurrence semantics keep
    // callers from having to reason about document-order surprises.
    const s = `<svg data-annot-version="1"><g data-annot-version="9"/></svg>`;
    expect(getAnnotVersionFromString(s)).toBe("1");
  });

  it("requires a whitespace boundary so it doesn't latch onto lookalike attrs", () => {
    // The regex is `\sdata-annot-version=`. An attribute named
    // `not-data-annot-version` must not match.
    const s = `<svg not-data-annot-version="9"></svg>`;
    expect(getAnnotVersionFromString(s)).toBe(ANNOT_SVG_VERSION_UNSTAMPED);
  });
});
