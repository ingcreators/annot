// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  readSvgProvenanceAttrs,
  SVG_PROVENANCE_ATTRS,
  writeSvgProvenanceAttrs,
} from "./svg-format.js";

function makeRoot(): Element {
  return document.createElementNS("http://www.w3.org/2000/svg", "svg");
}

describe("SVG provenance attributes (schema-2.0 parity)", () => {
  it("round-trips all four fields", () => {
    const root = makeRoot();
    writeSvgProvenanceAttrs(root, {
      sourceUrl: "https://example.com/pricing?plan=pro&x=<1>",
      createdAt: "2026-07-12T03:00:00.000Z",
      producer: "vscode",
      dpr: 2,
    });
    expect(readSvgProvenanceAttrs(root)).toEqual({
      sourceUrl: "https://example.com/pricing?plan=pro&x=<1>",
      createdAt: "2026-07-12T03:00:00.000Z",
      producer: "vscode",
      dpr: 2,
    });
  });

  it("defaults missing attributes to empty string / 0", () => {
    expect(readSvgProvenanceAttrs(makeRoot())).toEqual({
      sourceUrl: "",
      createdAt: "",
      producer: "",
      dpr: 0,
    });
  });

  it("removes stale attributes when a field is unset on re-write", () => {
    const root = makeRoot();
    writeSvgProvenanceAttrs(root, { sourceUrl: "https://a.example", dpr: 1.5 });
    writeSvgProvenanceAttrs(root, { producer: "web" });
    expect(root.hasAttribute(SVG_PROVENANCE_ATTRS.sourceUrl)).toBe(false);
    expect(root.hasAttribute(SVG_PROVENANCE_ATTRS.dpr)).toBe(false);
    expect(root.getAttribute(SVG_PROVENANCE_ATTRS.producer)).toBe("web");
  });

  it("survives XML serialization (attribute escaping handled by the serializer)", () => {
    const root = makeRoot();
    const url = 'https://example.com/q?a=1&b="x"';
    writeSvgProvenanceAttrs(root, { sourceUrl: url });
    const xml = new XMLSerializer().serializeToString(root);
    const reparsed = new DOMParser().parseFromString(xml, "image/svg+xml").documentElement;
    expect(readSvgProvenanceAttrs(reparsed).sourceUrl).toBe(url);
  });
});
