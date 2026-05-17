// @vitest-environment happy-dom
//
// `importFiles` covers the file manager's multi-file upload pipeline
// (sidebar picker + drag-drop). The tests exercise:
//
//   - Plain image → image-save path with computed thumb + dims.
//   - Embedded-XMP image → readEditableImage extracts the original
//     bytes / annotations / tags; saved record carries them through.
//   - `.annot.html` document → document-save path against a
//     `supportsDocuments`-opting store.
//   - Plain `.html` without the `data-annot-doc-version` marker is
//     skipped, not saved.
//   - Unsupported extension is skipped with `kind: "skipped"`.
//   - Per-file failure isolation — a thrown `saveImage` doesn't abort
//     the rest of the batch.
//   - Documents store that doesn't opt in skips with the matching
//     `skipReason`.
//   - Progress callback fires per file.

import type {
  DocumentRecord,
  DocumentRecordUpdate,
  FolderRecord,
  ImageRecord,
  ImageRecordUpdate,
  StorageProvider,
  StorageWithDocuments,
} from "@ingcreators/annot-core/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the thumbnail pipeline so happy-dom's missing OffscreenCanvas
// doesn't tank the image tests. Real success is exercised by the
// store contract tests; here we just need a deterministic
// (dataUrl, w, h) triple.
vi.mock("../image-thumbnail.js", () => ({
  renderThumbnailWithDims: vi.fn(async (_blob: Blob) => ({
    dataUrl: "data:image/jpeg;base64,FAKE_THUMB",
    width: 800,
    height: 600,
  })),
  generateThumbnailFromDataUrl: vi.fn(async (_dataUrl: string) => ""),
}));

// Mock the XMP probe so tests can flip "this file has annotations
// embedded" without crafting a real iTXt-bearing PNG byte sequence.
const readEditableImageMock = vi.fn();
vi.mock("@ingcreators/annot-core/xmp", () => ({
  readEditableImage: (data: Uint8Array) => readEditableImageMock(data),
}));

import { importFiles } from "./import-files.js";

beforeEach(() => {
  readEditableImageMock.mockReset();
  readEditableImageMock.mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Stub storage ────────────────────────────────────────────────

interface SavedImage {
  record: Omit<ImageRecord, "path">;
  opts?: { filename?: string };
}

interface SavedDocument {
  record: Omit<DocumentRecord, "path">;
  opts?: { filename?: string };
}

class StubImageStore implements StorageProvider {
  savedImages: SavedImage[] = [];
  failNextSave = false;
  /** Paths that already exist before the import — used to seed
   *  the conflict pre-check. Records added via `saveImage` are
   *  ALSO indexed here so a successful save shows up on a
   *  subsequent `getImage`. */
  existingImagePaths = new Set<string>();
  /** Auto-uniquify on collision the same way real stores do —
   *  the loop matches `(2)` / `(3)` until a free slot is found.
   *  Without this, `keepBoth` would silently overwrite. */
  #uniquify(folderPath: string, name: string): string {
    const folder = folderPath ? `${folderPath}/` : "";
    let candidate = name;
    let n = 2;
    while (this.existingImagePaths.has(`${folder}${candidate}`)) {
      const dot = name.lastIndexOf(".");
      const base = dot >= 0 ? name.slice(0, dot) : name;
      const ext = dot >= 0 ? name.slice(dot) : "";
      candidate = `${base} (${n})${ext}`;
      n += 1;
      if (n > 9999) throw new Error("uniquify limit");
    }
    return candidate;
  }

  async saveImage(
    record: Omit<ImageRecord, "path">,
    opts?: { filename?: string },
  ): Promise<string> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("simulated save failure");
    }
    const folder = record.folderPath ? `${record.folderPath}/` : "";
    const desired = opts?.filename ?? `image-${this.savedImages.length + 1}.png`;
    const name = this.#uniquify(record.folderPath, desired);
    const path = `${folder}${name}`;
    this.savedImages.push({ record, opts: { filename: name } });
    this.existingImagePaths.add(path);
    return path;
  }
  async getImage(path: string): Promise<ImageRecord | undefined> {
    if (!this.existingImagePaths.has(path)) return undefined;
    return { path } as ImageRecord;
  }
  async listImages(): Promise<ImageRecord[]> {
    return [];
  }
  async updateImage(_path: string, _updates: ImageRecordUpdate): Promise<void> {}
  async deleteImage(path: string): Promise<void> {
    this.existingImagePaths.delete(path);
    this.savedImages = this.savedImages.filter((s) => {
      const folder = s.record.folderPath ? `${s.record.folderPath}/` : "";
      return `${folder}${s.opts?.filename ?? ""}` !== path;
    });
  }
  async moveImage(_path: string, _toFolder: string): Promise<string> {
    return "";
  }
  async renameImage(_path: string, _name: string): Promise<string> {
    return "";
  }
  async listFolders(): Promise<FolderRecord[]> {
    return [];
  }
  async getFolder(): Promise<FolderRecord | undefined> {
    return undefined;
  }
  async createFolder(): Promise<string> {
    return "";
  }
  async renameFolder(): Promise<string> {
    return "";
  }
  async moveFolder(): Promise<string> {
    return "";
  }
  async deleteFolder(): Promise<void> {}
  async getBreadcrumb(): Promise<FolderRecord[]> {
    return [];
  }
}

class StubDocsStore extends StubImageStore implements StorageWithDocuments {
  savedDocuments: SavedDocument[] = [];
  existingDocumentPaths = new Set<string>();

  async saveDocument(
    record: Omit<DocumentRecord, "path">,
    opts?: { filename?: string },
  ): Promise<string> {
    const folder = record.folderPath ? `${record.folderPath}/` : "";
    const desired = opts?.filename ?? `doc-${this.savedDocuments.length + 1}.annot.html`;
    let candidate = desired;
    let n = 2;
    while (this.existingDocumentPaths.has(`${folder}${candidate}`)) {
      const dot = desired.lastIndexOf(".");
      const base = dot >= 0 ? desired.slice(0, dot) : desired;
      const ext = dot >= 0 ? desired.slice(dot) : "";
      candidate = `${base} (${n})${ext}`;
      n += 1;
    }
    const path = `${folder}${candidate}`;
    this.savedDocuments.push({ record, opts: { filename: candidate } });
    this.existingDocumentPaths.add(path);
    return path;
  }
  async getDocument(path: string): Promise<DocumentRecord | undefined> {
    if (!this.existingDocumentPaths.has(path)) return undefined;
    return { path } as DocumentRecord;
  }
  async listDocuments(): Promise<DocumentRecord[]> {
    return [];
  }
  async updateDocument(_path: string, _updates: DocumentRecordUpdate): Promise<void> {}
  override async deleteImage(path: string): Promise<void> {
    this.existingDocumentPaths.delete(path);
    this.savedDocuments = this.savedDocuments.filter((s) => {
      const folder = s.record.folderPath ? `${s.record.folderPath}/` : "";
      return `${folder}${s.opts?.filename ?? ""}` !== path;
    });
    await super.deleteImage(path);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function makeFile(name: string, content: string | Uint8Array, type = "image/png"): File {
  const part: BlobPart = typeof content === "string" ? content : (content as BlobPart);
  return new File([part], name, { type });
}

// ─── Tests ───────────────────────────────────────────────────────

describe("importFiles — image path", () => {
  it("saves a plain PNG via storage.saveImage with computed thumb + dims", async () => {
    const store = new StubImageStore();
    const file = makeFile("screenshot.png", "fake-png-bytes");

    const results = await importFiles([file], { storage: store, folderPath: "Inbox" });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: "image", path: "Inbox/screenshot.png" });
    expect(store.savedImages).toHaveLength(1);
    const saved = store.savedImages[0]!.record;
    expect(saved.folderPath).toBe("Inbox");
    expect(saved.width).toBe(800);
    expect(saved.height).toBe(600);
    expect(saved.thumbnailDataUrl).toBe("data:image/jpeg;base64,FAKE_THUMB");
    expect(saved.annotationsSvg).toBe("");
    expect(saved.originalDataUrl.startsWith("data:")).toBe(true);
    expect(store.savedImages[0]!.opts).toEqual({ filename: "screenshot.png" });
  });

  it("extracts embedded XMP annotations + tags when present (annot.png round-trip)", async () => {
    const store = new StubImageStore();
    readEditableImageMock.mockReturnValue({
      annotationsSvg: "<svg data-annot-version='3'/>",
      originalImageDataUrl: "data:image/png;base64,ORIGINAL_BYTES",
      width: 1280,
      height: 720,
      tags: { "click.url": "https://example.com" },
    });
    const file = makeFile("shot.annot.png", "fake-annot-png-bytes");

    const results = await importFiles([file], { storage: store, folderPath: "" });

    expect(results[0]?.kind).toBe("image");
    const saved = store.savedImages[0]!.record;
    expect(saved.annotationsSvg).toBe("<svg data-annot-version='3'/>");
    expect(saved.originalDataUrl).toBe("data:image/png;base64,ORIGINAL_BYTES");
    expect(saved.width).toBe(1280);
    expect(saved.height).toBe(720);
    expect(saved.tags).toEqual({ "click.url": "https://example.com" });
  });

  it("isolates per-file failures so the batch continues", async () => {
    const store = new StubImageStore();
    const a = makeFile("a.png", "a");
    const bad = makeFile("bad.png", "bad");
    const c = makeFile("c.png", "c");

    // Inject a failure on the SECOND save only.
    let saves = 0;
    const realSave = store.saveImage.bind(store);
    store.saveImage = async (rec, opts) => {
      saves += 1;
      if (saves === 2) throw new Error("disk full");
      return realSave(rec, opts);
    };

    const results = await importFiles([a, bad, c], { storage: store, folderPath: "" });

    expect(results).toHaveLength(3);
    expect(results[0]?.kind).toBe("image");
    expect(results[0]?.error).toBeUndefined();
    expect(results[1]?.kind).toBe("image");
    expect((results[1]?.error as Error)?.message).toBe("disk full");
    expect(results[2]?.kind).toBe("image");
    expect(results[2]?.error).toBeUndefined();
    expect(store.savedImages).toHaveLength(2);
  });
});

describe("importFiles — document path", () => {
  it("saves a `.annot.html` document via storage.saveDocument", async () => {
    const store = new StubDocsStore();
    const html = `
      <!DOCTYPE html>
      <html data-annot-doc-version="1">
        <head><title>Onboarding Manual</title></head>
        <body>
          <article data-annot-doc>
            <section data-annot-block="heading">Welcome</section>
            <section data-annot-block="image">A</section>
            <section data-annot-block="image">B</section>
          </article>
        </body>
      </html>
    `;
    const file = makeFile("onboarding.annot.html", html, "text/html");

    const results = await importFiles([file], { storage: store, folderPath: "Manuals" });

    expect(results[0]?.kind).toBe("document");
    expect(results[0]?.path).toBe("Manuals/onboarding.annot.html");
    expect(store.savedDocuments).toHaveLength(1);
    const saved = store.savedDocuments[0]!.record;
    expect(saved.folderPath).toBe("Manuals");
    expect(saved.title).toBe("Onboarding Manual");
    expect(saved.blockCount).toBe(3);
    expect(saved.imageCount).toBe(2);
    expect(saved.bytes).toContain("data-annot-doc-version");
  });

  it("skips plain .html files lacking the annot-doc marker", async () => {
    const store = new StubDocsStore();
    const file = makeFile(
      "blog.html",
      "<!DOCTYPE html><html><body>Regular HTML</body></html>",
      "text/html",
    );

    const results = await importFiles([file], { storage: store, folderPath: "" });

    expect(results[0]?.kind).toBe("skipped");
    expect(results[0]?.skipReason).toBe("unsupported-type");
    expect(store.savedDocuments).toHaveLength(0);
  });

  it("skips `.annot.html` when storage doesn't support documents", async () => {
    const store = new StubImageStore(); // no saveDocument
    const file = makeFile(
      "onboarding.annot.html",
      "<html data-annot-doc-version='1'><head><title>X</title></head><body/></html>",
      "text/html",
    );

    const results = await importFiles([file], { storage: store, folderPath: "" });

    expect(results[0]?.kind).toBe("skipped");
    expect(results[0]?.skipReason).toBe("documents-not-supported");
  });
});

describe("importFiles — dispatch + skip behaviour", () => {
  it("skips unsupported file types without invoking save", async () => {
    const store = new StubImageStore();
    const file = makeFile("notes.txt", "hello", "text/plain");

    const results = await importFiles([file], { storage: store, folderPath: "" });

    expect(results[0]).toEqual({
      file,
      kind: "skipped",
      skipReason: "unsupported-type",
    });
    expect(store.savedImages).toHaveLength(0);
  });

  it("skips empty files", async () => {
    const store = new StubImageStore();
    const file = new File([], "empty.png", { type: "image/png" });

    const results = await importFiles([file], { storage: store, folderPath: "" });

    expect(results[0]?.kind).toBe("skipped");
    expect(results[0]?.skipReason).toBe("empty-file");
  });

  it("handles a mixed batch: image + document + skipped", async () => {
    const store = new StubDocsStore();
    const img = makeFile("a.png", "img-bytes");
    const doc = makeFile(
      "b.annot.html",
      "<html data-annot-doc-version='1'><head><title>B</title></head><body/></html>",
      "text/html",
    );
    const txt = makeFile("c.txt", "skip me", "text/plain");

    const results = await importFiles([img, doc, txt], {
      storage: store,
      folderPath: "Mix",
    });

    expect(results.map((r) => r.kind)).toEqual(["image", "document", "skipped"]);
    expect(store.savedImages).toHaveLength(1);
    expect(store.savedDocuments).toHaveLength(1);
  });
});

describe("importFiles — progress callback", () => {
  it("fires once per file with (done, total) advancing", async () => {
    const store = new StubImageStore();
    const files = [makeFile("a.png", "a"), makeFile("b.png", "b"), makeFile("c.png", "c")];
    const calls: Array<[number, number]> = [];

    await importFiles(files, {
      storage: store,
      folderPath: "",
      onProgress: (done, total) => calls.push([done, total]),
    });

    expect(calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });
});

describe("importFiles — conflict detection", () => {
  it("falls back to legacy auto-uniquify when no onConflict handler is provided", async () => {
    const store = new StubImageStore();
    store.existingImagePaths.add("Inbox/screenshot.png");
    const file = makeFile("screenshot.png", "bytes");

    const results = await importFiles([file], { storage: store, folderPath: "Inbox" });

    expect(results[0]?.kind).toBe("image");
    expect(results[0]?.path).toBe("Inbox/screenshot (2).png");
    expect(store.existingImagePaths.has("Inbox/screenshot.png")).toBe(true);
    expect(store.existingImagePaths.has("Inbox/screenshot (2).png")).toBe(true);
  });

  it("invokes onConflict when an existing file would collide", async () => {
    const store = new StubImageStore();
    store.existingImagePaths.add("a.png");
    const file = makeFile("a.png", "bytes");
    const calls: Array<{ filename: string; total: number; kind: string }> = [];

    await importFiles([file], {
      storage: store,
      folderPath: "",
      onConflict: async (info) => {
        calls.push({ filename: info.file.name, total: info.total, kind: info.kind });
        return { action: "keepBoth" };
      },
    });

    expect(calls).toEqual([{ filename: "a.png", total: 1, kind: "image" }]);
  });

  it("does NOT invoke onConflict when the would-be path is free", async () => {
    const store = new StubImageStore();
    const onConflict = vi.fn();
    const file = makeFile("fresh.png", "x");

    await importFiles([file], { storage: store, folderPath: "", onConflict });

    expect(onConflict).not.toHaveBeenCalled();
    expect(store.savedImages).toHaveLength(1);
  });

  it("`replace` deletes the existing record and saves with the original name", async () => {
    const store = new StubImageStore();
    store.existingImagePaths.add("Inbox/a.png");
    const file = makeFile("a.png", "new-bytes");

    const results = await importFiles([file], {
      storage: store,
      folderPath: "Inbox",
      onConflict: async () => ({ action: "replace" }),
    });

    // No " (2)" suffix; lands at the original path.
    expect(results[0]?.path).toBe("Inbox/a.png");
    // Only the new save remains; the pre-existing record was
    // deleted and replaced.
    expect(store.existingImagePaths.size).toBe(1);
    expect(store.existingImagePaths.has("Inbox/a.png")).toBe(true);
    expect(store.savedImages).toHaveLength(1);
  });

  it("`skip` reports the file as skipped with the duplicate reason", async () => {
    const store = new StubImageStore();
    store.existingImagePaths.add("a.png");
    const file = makeFile("a.png", "bytes");

    const results = await importFiles([file], {
      storage: store,
      folderPath: "",
      onConflict: async () => ({ action: "skip" }),
    });

    expect(results[0]).toMatchObject({
      kind: "skipped",
      skipReason: "duplicate-skipped",
    });
    expect(store.savedImages).toHaveLength(0);
  });

  it("`cancel` aborts the batch; remaining files report duplicate-cancelled", async () => {
    const store = new StubImageStore();
    store.existingImagePaths.add("a.png");
    const a = makeFile("a.png", "a");
    const b = makeFile("b.png", "b");
    const c = makeFile("c.png", "c");

    const results = await importFiles([a, b, c], {
      storage: store,
      folderPath: "",
      onConflict: async () => ({ action: "cancel" }),
    });

    expect(results.map((r) => r.skipReason)).toEqual([
      "duplicate-cancelled",
      "duplicate-cancelled",
      "duplicate-cancelled",
    ]);
    expect(store.savedImages).toHaveLength(0);
  });

  it("`applyToAll` reuses the action for subsequent conflicts without re-prompting", async () => {
    const store = new StubImageStore();
    store.existingImagePaths.add("a.png");
    store.existingImagePaths.add("b.png");
    store.existingImagePaths.add("c.png");
    const files = [makeFile("a.png", "a"), makeFile("b.png", "b"), makeFile("c.png", "c")];

    const onConflict = vi.fn().mockResolvedValue({ action: "replace", applyToAll: true });

    const results = await importFiles(files, {
      storage: store,
      folderPath: "",
      onConflict,
    });

    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.path)).toEqual(["a.png", "b.png", "c.png"]);
    expect(store.savedImages).toHaveLength(3);
  });

  it("`applyToAll` is ignored when the chosen action is `cancel`", async () => {
    // Cancel is special: it shouldn't be sticky because the batch
    // is already aborted. We assert the loop short-circuits even
    // when the host accidentally sets applyToAll on cancel.
    const store = new StubImageStore();
    store.existingImagePaths.add("a.png");
    store.existingImagePaths.add("b.png");
    const files = [makeFile("a.png", "a"), makeFile("b.png", "b")];

    const onConflict = vi.fn().mockResolvedValue({ action: "cancel", applyToAll: true });
    const results = await importFiles(files, {
      storage: store,
      folderPath: "",
      onConflict,
    });

    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.skipReason)).toEqual([
      "duplicate-cancelled",
      "duplicate-cancelled",
    ]);
  });

  it("conflict pre-check covers documents too", async () => {
    const store = new StubDocsStore();
    store.existingDocumentPaths.add("Manuals/onboarding.annot.html");
    const file = makeFile(
      "onboarding.annot.html",
      "<html data-annot-doc-version='1'><head><title>X</title></head><body/></html>",
      "text/html",
    );

    const onConflict = vi.fn().mockResolvedValue({ action: "replace" });
    const results = await importFiles([file], {
      storage: store,
      folderPath: "Manuals",
      onConflict,
    });

    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(onConflict.mock.calls[0]?.[0]?.kind).toBe("document");
    expect(results[0]?.path).toBe("Manuals/onboarding.annot.html");
    expect(store.existingDocumentPaths.size).toBe(1);
  });

  it("does not prompt for files that won't collide alongside ones that will", async () => {
    const store = new StubImageStore();
    store.existingImagePaths.add("dup.png");
    const dup = makeFile("dup.png", "x");
    const fresh = makeFile("fresh.png", "y");

    const onConflict = vi.fn().mockResolvedValue({ action: "skip" });
    const results = await importFiles([dup, fresh], {
      storage: store,
      folderPath: "",
      onConflict,
    });

    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(results[0]?.skipReason).toBe("duplicate-skipped");
    expect(results[1]?.kind).toBe("image");
    expect(results[1]?.path).toBe("fresh.png");
  });
});
