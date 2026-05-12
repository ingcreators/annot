// @vitest-environment happy-dom
//
// Round-trip byte-equivalence: parse the canonical fixture →
// serialise → assert the bytes match. This is the contract
// `docs/annot-html-format.md` declares. happy-dom provides
// `globalThis.DOMParser`; the test consumes it indirectly through
// `parseDocument`'s lazy resolution.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument, serializeDocument } from "./headless.js";

// vitest's cwd is the monorepo root (where the root vitest.config.ts
// lives). We resolve fixtures from there rather than from
// `import.meta.url` because happy-dom rewrites URL schemes.
const FIXTURE_DIR = resolve(process.cwd(), "docs/annot-html-format-examples");

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURE_DIR, name), "utf8");
}

const FIXTURES = [
  "empty.annot.html",
  "with-image.annot.html",
  "mixed.annot.html",
  // Phase 1 of `docs/plans/_done/card-procedure-template.md` — step
  // blocks land in the round-trip corpus once the parser /
  // serializer understand them. The three fixtures were authored
  // in Phase 0 as the canonical-form contract.
  "steps-only.annot.html",
  "steps-mixed.annot.html",
  "steps-fill.annot.html",
] as const;

describe("annot-doc: round-trip byte equivalence", () => {
  for (const name of FIXTURES) {
    it(`${name} round-trips byte-for-byte`, () => {
      const bytes = loadFixture(name);
      const parsed = parseDocument(bytes);
      const reSerialised = serializeDocument(parsed);
      expect(reSerialised).toBe(bytes);
    });
  }
});

describe("annot-doc: parse coverage", () => {
  it("decodes title from <head> + JSON sidecar", () => {
    const bytes = loadFixture("with-image.annot.html");
    const doc = parseDocument(bytes);
    expect(doc.title).toBe("Login flow");
    expect(doc.lang).toBe("en");
    expect(doc.version).toBe(1);
  });

  it("recognises every v1 block kind in the mixed fixture", () => {
    const bytes = loadFixture("mixed.annot.html");
    const doc = parseDocument(bytes);
    const kinds = doc.blocks.map((b) => b.kind);
    // Order matches the fixture's article children.
    expect(kinds).toEqual([
      "heading",
      "paragraph",
      "heading",
      "paragraph",
      "list",
      "paragraph",
      "list",
      "heading",
      "code",
      "heading",
      "quote",
      "callout",
      "callout",
      "divider",
      "heading",
      "image",
    ]);
  });

  it("preserves image-block fields", () => {
    const bytes = loadFixture("with-image.annot.html");
    const doc = parseDocument(bytes);
    const image = doc.blocks.find((b) => b.kind === "image");
    expect(image).toBeDefined();
    if (image?.kind !== "image") throw new Error("expected image block");
    expect(image.id).toBe("img-login-screen");
    expect(image.svg).toContain('<svg data-annot-version="1"');
    expect(image.svg).toContain('<g id="annotations"/>');
    expect(image.caption).toBe("Figure 1: Login screen.");
  });

  it("preserves code-block lang + verbatim content", () => {
    const bytes = loadFixture("mixed.annot.html");
    const doc = parseDocument(bytes);
    const code = doc.blocks.find((b) => b.kind === "code");
    if (code?.kind !== "code") throw new Error("expected code block");
    expect(code.lang).toBe("bash");
    expect(code.text).toBe("echo hello\necho world");
  });

  it("preserves callout tone", () => {
    const bytes = loadFixture("mixed.annot.html");
    const doc = parseDocument(bytes);
    const callouts = doc.blocks.filter((b) => b.kind === "callout");
    expect(callouts).toHaveLength(2);
    const tones = callouts.map((c) => (c.kind === "callout" ? c.tone : null));
    expect(tones).toEqual(["info", "warn"]);
  });
});

describe("annot-doc: standalone TOC", () => {
  // Background: the standalone-view TOC (`<nav data-annot-toc>`)
  // is a serializer-generated artifact regenerated on every save.
  // The parser skips it so the model never round-trips through
  // stale TOC bytes; the next save re-stamps the nav from the
  // current heading list.

  it("emits no TOC when the doc has 0 headings", () => {
    const bytes = loadFixture("empty.annot.html");
    const doc = parseDocument(bytes);
    const out = serializeDocument(doc);
    expect(out).not.toContain("data-annot-toc");
    expect(out).not.toContain("annot-h-");
  });

  it("emits no TOC when the doc has 1 heading", () => {
    const bytes = loadFixture("with-image.annot.html");
    const doc = parseDocument(bytes);
    const out = serializeDocument(doc);
    expect(out).not.toContain("data-annot-toc");
    // A single-heading doc still gets `id="annot-h-0"` so the
    // saved file's heading is anchorable from external link
    // sharing — only the chrome is suppressed.
    expect(out).toContain('id="annot-h-0"');
  });

  it("emits a TOC entry per heading when the doc has ≥2 headings", () => {
    const bytes = loadFixture("mixed.annot.html");
    const doc = parseDocument(bytes);
    const out = serializeDocument(doc);
    expect(out).toContain("<nav data-annot-toc");
    expect(out).toContain("<h2 data-annot-toc-title>Contents</h2>");
    expect(out).toContain('href="#annot-h-0"');
    expect(out).toContain('href="#annot-h-4"');
    expect(out).toContain('id="annot-h-0"');
    expect(out).toContain('id="annot-h-4"');
    // TOC label text comes from the heading's plain text.
    expect(out).toContain(">Format showcase</a>");
    expect(out).toContain(">Lists</a>");
  });

  it("the TOC nav is not surfaced as an `unknown` block on parse", () => {
    const bytes = loadFixture("mixed.annot.html");
    const doc = parseDocument(bytes);
    expect(doc.blocks.some((b) => b.kind === "unknown")).toBe(false);
  });

  it("strips inline tags from the TOC label", () => {
    // Hand-build a doc whose first heading has inline emphasis.
    const html = `<!doctype html>
<html data-annot-doc-version="1" lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="annot-document" content="1">
    <title>Inline-emphasis labels</title>
  </head>
  <body>
    <article data-annot-doc>
      <h1 data-annot-block="heading" data-level="1">Hello <strong>world</strong> &amp; friends</h1>
      <h2 data-annot-block="heading" data-level="2">Plain</h2>
    </article>
    <script type="application/annot+json" data-annot-doc-meta>{"title":"Inline-emphasis labels"}</script>
  </body>
</html>
`;
    const doc = parseDocument(html);
    const out = serializeDocument(doc);
    // Inline tags stripped; ampersand decoded then re-escaped
    // exactly once. The serializer must NOT emit `&amp;amp;`.
    expect(out).toContain(">Hello world &amp; friends</a>");
    expect(out).not.toContain("&amp;amp;");
  });
});

describe("annot-doc: malformed input", () => {
  it("rejects missing data-annot-doc-version", () => {
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="annot-document" content="1">
    <title>Bad</title>
  </head>
  <body>
    <article data-annot-doc>
      <p data-annot-block="paragraph">x</p>
    </article>
    <script type="application/annot+json" data-annot-doc-meta>{"title":"Bad"}</script>
  </body>
</html>
`;
    expect(() => parseDocument(html)).toThrow(/data-annot-doc-version/);
  });

  it("rejects unsupported version", () => {
    const html = `<!doctype html>
<html data-annot-doc-version="99" lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="annot-document" content="1">
    <title>From the future</title>
  </head>
  <body>
    <article data-annot-doc>
      <p data-annot-block="paragraph">x</p>
    </article>
    <script type="application/annot+json" data-annot-doc-meta>{"title":"From the future"}</script>
  </body>
</html>
`;
    expect(() => parseDocument(html)).toThrow(/version/);
  });

  it("rejects missing detection meta tag", () => {
    const html = `<!doctype html>
<html data-annot-doc-version="1" lang="en">
  <head>
    <meta charset="utf-8">
    <title>Stranger HTML</title>
  </head>
  <body>
    <article data-annot-doc>
      <p data-annot-block="paragraph">x</p>
    </article>
    <script type="application/annot+json" data-annot-doc-meta>{"title":"Stranger HTML"}</script>
  </body>
</html>
`;
    expect(() => parseDocument(html)).toThrow(/annot-document/);
  });
});
