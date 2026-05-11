// Tier A — runs in the default Node environment (no DOM
// dependency). Tests `extractDocumentThumbnailDataUrl` across
// the canonical document shapes: image-bearing, image-free,
// non-data href, multi-image (first wins).

import { describe, expect, it } from "vitest";
import { extractDocumentThumbnailDataUrl } from "./extract-thumbnail.js";
import type { AnnotDocument, ImageBlock } from "./types.js";

const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
const SECOND_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAAxbutwAAAACklEQVR4XmNgAAAAAgABoaGSEwAAAABJRU5ErkJggg==";

function makeImageBlock(id: string, href: string): ImageBlock {
  return {
    kind: "image",
    id,
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 10 10" width="10" height="10">` +
      `<image href="${href}" width="10" height="10"/>` +
      `<g id="annotations"></g>` +
      "</svg>",
  };
}

function makeDoc(blocks: AnnotDocument["blocks"]): AnnotDocument {
  return {
    version: 1,
    lang: "en",
    title: "Thumb test",
    meta: { title: "Thumb test" },
    styleBlock: null,
    blocks,
  };
}

describe("extractDocumentThumbnailDataUrl", () => {
  it("returns empty string for a document with no image blocks", () => {
    const doc = makeDoc([
      { kind: "heading", level: 1, inlineHtml: "Title" },
      { kind: "paragraph", inlineHtml: "Hello" },
    ]);
    expect(extractDocumentThumbnailDataUrl(doc)).toBe("");
  });

  it("returns the first image block's data URL", () => {
    const doc = makeDoc([
      { kind: "paragraph", inlineHtml: "Intro" },
      makeImageBlock("img-1", TINY_PNG_DATA_URL),
    ]);
    expect(extractDocumentThumbnailDataUrl(doc)).toBe(TINY_PNG_DATA_URL);
  });

  it("returns the FIRST image when there are multiple", () => {
    const doc = makeDoc([
      makeImageBlock("img-1", TINY_PNG_DATA_URL),
      makeImageBlock("img-2", SECOND_PNG_DATA_URL),
    ]);
    expect(extractDocumentThumbnailDataUrl(doc)).toBe(TINY_PNG_DATA_URL);
  });

  it("handles xlink:href in addition to plain href", () => {
    const doc = makeDoc([
      {
        kind: "image",
        id: "img-x",
        svg:
          `<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 10 10" width="10" height="10">` +
          `<image xlink:href="${TINY_PNG_DATA_URL}" width="10" height="10"/>` +
          `<g id="annotations"></g>` +
          "</svg>",
      },
    ]);
    expect(extractDocumentThumbnailDataUrl(doc)).toBe(TINY_PNG_DATA_URL);
  });

  it("tolerates single-quoted href attributes", () => {
    const doc = makeDoc([
      {
        kind: "image",
        id: "img-sq",
        svg:
          `<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 10 10" width="10" height="10">` +
          `<image href='${TINY_PNG_DATA_URL}' width='10' height='10'/>` +
          `<g id="annotations"></g>` +
          "</svg>",
      },
    ]);
    expect(extractDocumentThumbnailDataUrl(doc)).toBe(TINY_PNG_DATA_URL);
  });

  it("returns empty string when the image href isn't a data: URL", () => {
    // External / relative URLs aren't safe to use as thumbnails
    // — they wouldn't render in a card without re-fetching, and
    // CORS rules may block them anyway. Fall back to the
    // article-icon CSS path instead.
    const doc = makeDoc([makeImageBlock("img-remote", "https://example.com/screenshot.png")]);
    expect(extractDocumentThumbnailDataUrl(doc)).toBe("");
  });

  it("skips image blocks without a usable href and continues", () => {
    // A malformed image block (no href) shouldn't stop the
    // helper — the next image block's data URL should be
    // returned instead.
    const broken: ImageBlock = {
      kind: "image",
      id: "img-broken",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 10 10" width="10" height="10"><g id="annotations"></g></svg>',
    };
    const doc = makeDoc([broken, makeImageBlock("img-good", TINY_PNG_DATA_URL)]);
    expect(extractDocumentThumbnailDataUrl(doc)).toBe(TINY_PNG_DATA_URL);
  });

  // Phase 7a — image-less step blocks (empty `svg`) yield no
  // thumbnail and the walker continues to the next block. A
  // document whose only step blocks are image-less falls back
  // to the empty-string sentinel (gallery card shows the
  // article icon).
  it("skips image-less step blocks (Phase 7a) and continues to image-bearing blocks", () => {
    const doc = makeDoc([
      {
        kind: "step",
        id: "img-empty",
        svg: "",
        title: "Recap",
        body: "Wrap up.",
        layout: "image-top",
      },
      makeImageBlock("img-good", TINY_PNG_DATA_URL),
    ]);
    expect(extractDocumentThumbnailDataUrl(doc)).toBe(TINY_PNG_DATA_URL);
  });

  it("returns empty string when the only step blocks are image-less", () => {
    const doc = makeDoc([
      {
        kind: "step",
        id: "img-empty",
        svg: "",
        title: "Recap",
        body: "Wrap up.",
        layout: "image-top",
      },
    ]);
    expect(extractDocumentThumbnailDataUrl(doc)).toBe("");
  });
});
