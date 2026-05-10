// Pure-Node test: `isTemplateFromHead` doesn't touch the DOM,
// so we run it under the default Node environment.

import { describe, expect, it } from "vitest";
import { isTemplateFromHead } from "./is-template-head.js";

describe("isTemplateFromHead", () => {
  it("returns true for the canonical serialiser output shape", () => {
    const bytes = `<!doctype html>
<html data-annot-doc-version="1" data-annot-doc-template="1" lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="annot-document" content="1">
    <meta name="annot-template" content="1">
    <title>Manual</title>
  </head>
</html>`;
    expect(isTemplateFromHead(bytes)).toBe(true);
  });

  it("returns false for a non-template document", () => {
    const bytes = `<!doctype html>
<html data-annot-doc-version="1" lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="annot-document" content="1">
    <title>Notes</title>
  </head>
</html>`;
    expect(isTemplateFromHead(bytes)).toBe(false);
  });

  it("returns false on completely unrelated bytes", () => {
    expect(isTemplateFromHead("just some text")).toBe(false);
    expect(isTemplateFromHead("<html><body>plain</body></html>")).toBe(false);
    expect(isTemplateFromHead("")).toBe(false);
  });

  it("tolerates single-quoted attributes", () => {
    const bytes = `<!doctype html><meta name='annot-template' content='1'>`;
    expect(isTemplateFromHead(bytes)).toBe(true);
  });

  it("tolerates extra whitespace between attributes", () => {
    const bytes = `<meta   name="annot-template"   content="1"   />`;
    expect(isTemplateFromHead(bytes)).toBe(true);
  });

  it("tolerates self-closing form", () => {
    expect(isTemplateFromHead(`<meta name="annot-template" content="1"/>`)).toBe(true);
    expect(isTemplateFromHead(`<meta name="annot-template" content="1">`)).toBe(true);
  });

  it("tolerates uppercase / mixed-case tag + attr names", () => {
    expect(isTemplateFromHead(`<META Name="annot-template" Content="1">`)).toBe(true);
  });

  it("returns false for content !== '1' (non-template marker tagged)", () => {
    // Hypothetical future: `content="2"` or empty. The check is
    // strict on the exact marker the format spec declares.
    expect(isTemplateFromHead(`<meta name="annot-template" content="2">`)).toBe(false);
    expect(isTemplateFromHead(`<meta name="annot-template" content="">`)).toBe(false);
  });

  it("returns false when only some other annot-* meta is present", () => {
    expect(isTemplateFromHead(`<meta name="annot-document" content="1">`)).toBe(false);
  });
});
