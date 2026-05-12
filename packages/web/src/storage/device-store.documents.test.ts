/**
 * @vitest-environment happy-dom
 *
 * `DeviceStore` document-method tests — Phase 7a of
 * `docs/plans/_done/annot-html-document.md`. Same in-memory FSA mock
 * the contract suite uses; covers the four `StorageWithDocuments`
 * methods (saveDocument / getDocument / listDocuments /
 * updateDocument), the `deleteImage` cross-kind path-keyed
 * delete, and the `supportsDocuments` predicate narrowing on a
 * real `DeviceStore` instance.
 */

import { supportsDocuments } from "@ingcreators/annot-core/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRoot } from "./device-fs.test-mock.js";
import { DeviceStore } from "./device-store.js";

vi.mock("../workers/encode-client.js", () => ({
  encodeCaptureInWorker: async (dataUrl: string) => ({ dataUrl }),
}));

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

function makeStore(): DeviceStore {
  return new DeviceStore(createMockRoot() as unknown as FileSystemDirectoryHandle);
}

function makePayload(overrides: Partial<Parameters<DeviceStore["saveDocument"]>[0]> = {}) {
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

beforeEach(() => {});
afterEach(() => {});

describe("DeviceStore.saveDocument + getDocument round-trip", () => {
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

describe("DeviceStore.listDocuments", () => {
  it("scopes by folderPath via the index", async () => {
    const store = makeStore();
    await store.saveDocument(makePayload({ folderPath: "" }), { filename: "root.annot.html" });
    // Create the Manuals folder first so getDirHandle({create:true})
    // path matches the contract; saveDocument uses {create:true}
    // anyway via #getDirHandle(folderPath, true).
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

describe("DeviceStore.updateDocument", () => {
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

describe("DeviceStore.deleteImage on document paths (Phase 7a)", () => {
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
  it("narrows DeviceStore to StorageWithDocuments", () => {
    const store = makeStore();
    expect(supportsDocuments(store)).toBe(true);
  });
});
