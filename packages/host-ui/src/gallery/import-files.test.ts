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

  async saveImage(
    record: Omit<ImageRecord, "path">,
    opts?: { filename?: string },
  ): Promise<string> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("simulated save failure");
    }
    this.savedImages.push({ record, opts });
    const folder = record.folderPath ? `${record.folderPath}/` : "";
    const name = opts?.filename ?? `image-${this.savedImages.length}.png`;
    return `${folder}${name}`;
  }
  async getImage(): Promise<ImageRecord | undefined> {
    return undefined;
  }
  async listImages(): Promise<ImageRecord[]> {
    return [];
  }
  async updateImage(_path: string, _updates: ImageRecordUpdate): Promise<void> {}
  async deleteImage(): Promise<void> {}
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

  async saveDocument(
    record: Omit<DocumentRecord, "path">,
    opts?: { filename?: string },
  ): Promise<string> {
    this.savedDocuments.push({ record, opts });
    const folder = record.folderPath ? `${record.folderPath}/` : "";
    return `${folder}${opts?.filename ?? `doc-${this.savedDocuments.length}.annot.html`}`;
  }
  async getDocument(): Promise<DocumentRecord | undefined> {
    return undefined;
  }
  async listDocuments(): Promise<DocumentRecord[]> {
    return [];
  }
  async updateDocument(_path: string, _updates: DocumentRecordUpdate): Promise<void> {}
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
