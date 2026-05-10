/**
 * @vitest-environment happy-dom
 *
 * `DesktopStore` document-method tests — Phase 7b of
 * `docs/plans/annot-html-document.md`. Mirror of
 * `device-store.documents.test.ts` against the in-memory
 * `DesktopFs` mock.
 */

import { DEFAULT_ENCODE_OPTIONS } from "@ingcreators/annot-core/encode";
import { supportsDocuments } from "@ingcreators/annot-core/storage";
import { createEditableImage } from "@ingcreators/annot-core/xmp";
import type { BuildEditableImageDeps } from "@ingcreators/annot-web/storage/image-encode";
import { describe, expect, it } from "vitest";
import { createMockDesktopFs } from "./desktop-fs.test-mock.js";
import { DesktopStore } from "./desktop-store.js";

const stubDeps: BuildEditableImageDeps = {
  renderImageRecord: async () => {
    throw new Error("renderImageRecord should not be called in document tests");
  },
  encodeCaptureInWorker: async (dataUrl: string) => ({ dataUrl, chosen: "png" }),
  loadEncodeOptions: () => DEFAULT_ENCODE_OPTIONS,
  createEditableImage,
};

const SAMPLE_BYTES = `<!doctype html>
<html data-annot-doc-version="1" lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="annot-document" content="1">
    <title>Sample</title>
  </head>
  <body>
    <article data-annot-doc>
      <p data-annot-block="paragraph">Hi.</p>
    </article>
    <script type="application/annot+json" data-annot-doc-meta>{"title":"Sample"}</script>
  </body>
</html>
`;

function makeStore(): DesktopStore {
  return new DesktopStore(createMockDesktopFs(), "mock-library", stubDeps);
}

function makePayload(overrides: Partial<Parameters<DesktopStore["saveDocument"]>[0]> = {}) {
  const now = new Date("2026-05-15T00:00:00Z").toISOString();
  return {
    folderPath: "",
    bytes: SAMPLE_BYTES,
    thumbnailDataUrl: "",
    title: "Sample",
    imageCount: 0,
    blockCount: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("DesktopStore.saveDocument + getDocument round-trip", () => {
  it("saves a document under the requested filename + reads it back", async () => {
    const store = makeStore();
    const path = await store.saveDocument(makePayload(), { filename: "manual.annot.html" });
    expect(path).toBe("manual.annot.html");
    const doc = await store.getDocument(path);
    expect(doc).toBeDefined();
    expect(doc?.title).toBe("Sample");
    expect(doc?.bytes).toBe(SAMPLE_BYTES);
    expect(doc?.path).toBe("manual.annot.html");
    expect(doc?.imageCount).toBe(0);
    expect(doc?.blockCount).toBe(1);
  });

  it("falls back to a timestamped filename when none is provided", async () => {
    const store = makeStore();
    const path = await store.saveDocument(makePayload());
    expect(path).toMatch(/^document-\d+\.annot\.html$/);
  });

  it("uniquifies on filename collision", async () => {
    const store = makeStore();
    const a = await store.saveDocument(makePayload(), { filename: "manual.annot.html" });
    const b = await store.saveDocument(makePayload(), { filename: "manual.annot.html" });
    expect(a).toBe("manual.annot.html");
    expect(b).toBe("manual.annot (2).html");
  });
});

describe("DesktopStore.listDocuments", () => {
  it("scopes by folderPath via the index", async () => {
    const store = makeStore();
    await store.saveDocument(makePayload({ folderPath: "" }), { filename: "root.annot.html" });
    await store.saveDocument(makePayload({ folderPath: "Manuals" }), {
      filename: "a.annot.html",
    });
    await store.saveDocument(makePayload({ folderPath: "Manuals" }), {
      filename: "b.annot.html",
    });
    const root = await store.listDocuments("");
    const manuals = await store.listDocuments("Manuals");
    expect(root.map((d) => d.path)).toEqual(["root.annot.html"]);
    expect(manuals.map((d) => d.path).sort()).toEqual([
      "Manuals/a.annot.html",
      "Manuals/b.annot.html",
    ]);
  });

  it("returns lazy records (bytes empty until getDocument)", async () => {
    const store = makeStore();
    await store.saveDocument(makePayload(), { filename: "x.annot.html" });
    const rows = await store.listDocuments("");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.bytes).toBe("");
  });

  it("returns [] for an empty / missing folder", async () => {
    const store = makeStore();
    expect(await store.listDocuments("")).toEqual([]);
    expect(await store.listDocuments("Missing")).toEqual([]);
  });
});

describe("DesktopStore.updateDocument", () => {
  it("writes new bytes + updates cached metadata", async () => {
    const store = makeStore();
    const path = await store.saveDocument(makePayload(), { filename: "doc.annot.html" });
    const newBytes = '<!doctype html><html data-annot-doc-version="1"></html>';
    await store.updateDocument(path, {
      bytes: newBytes,
      title: "Edited",
      blockCount: 5,
      imageCount: 2,
    });
    const doc = await store.getDocument(path);
    expect(doc?.bytes).toBe(newBytes);
    expect(doc?.title).toBe("Edited");
    expect(doc?.blockCount).toBe(5);
    expect(doc?.imageCount).toBe(2);
  });

  it("is idempotent on a missing source path", async () => {
    const store = makeStore();
    await expect(store.updateDocument("nope.annot.html", { title: "x" })).resolves.toBeUndefined();
  });
});

describe("DesktopStore.deleteImage on document paths (Phase 7b)", () => {
  it("deletes documents via the path-keyed deleteImage call", async () => {
    const store = makeStore();
    const path = await store.saveDocument(makePayload(), { filename: "deletable.annot.html" });
    expect(await store.getDocument(path)).toBeDefined();
    await store.deleteImage(path);
    expect(await store.getDocument(path)).toBeUndefined();
  });

  it("is idempotent on missing paths", async () => {
    const store = makeStore();
    await expect(store.deleteImage("nope.annot.html")).resolves.toBeUndefined();
  });
});

describe("supportsDocuments predicate", () => {
  it("narrows DesktopStore to StorageWithDocuments", () => {
    const store = makeStore();
    expect(supportsDocuments(store)).toBe(true);
  });
});
