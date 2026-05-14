/// <reference lib="dom" />
// @vitest-environment happy-dom
//
// Tests for the file-manager's selection-bar Download pipeline.
// `buildEditableImageBlob` is stubbed so we don't stand up the
// real render + worker chain — we only verify the dispatch logic
// (single → direct download, multi → ZIP, dedup of duplicate
// filenames, mixed image+document selections, etc.).

import type { DocumentRecord, ImageRecord } from "@ingcreators/annot-core/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../storage/image-encode.js", () => ({
  buildEditableImageBlob: vi.fn(
    async (rec: Partial<ImageRecord>, format: "jpg" | "png") =>
      new Blob([`fake-${format}-${rec.path}`], {
        type: `image/${format === "jpg" ? "jpeg" : "png"}`,
      }),
  ),
}));

const buildZipMock = vi.fn();
vi.mock("@ingcreators/annot-core/zip", async () => {
  const actual = await vi.importActual<typeof import("@ingcreators/annot-core/zip")>(
    "@ingcreators/annot-core/zip",
  );
  return {
    ...actual,
    buildZip: (entries: { name: string; data: Uint8Array }[]) => {
      buildZipMock(entries);
      return actual.buildZip(entries);
    },
  };
});

import { downloadGallerySelection } from "./download-selection.js";

interface CapturedDownload {
  filename: string;
  blob: Blob;
}

const captured: CapturedDownload[] = [];

// Track every blob URL handed out so we can resolve back to the
// underlying Blob when the SUT calls `a.href = url` + `a.click()`.
const blobByUrl = new Map<string, Blob>();

beforeEach(() => {
  captured.length = 0;
  blobByUrl.clear();
  buildZipMock.mockClear();

  let counter = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation((obj: Blob | MediaSource) => {
    counter += 1;
    const url = `blob:test:${counter}`;
    blobByUrl.set(url, obj as Blob);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

  const origCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = origCreate(tag) as HTMLElement;
    if (tag.toLowerCase() === "a") {
      const anchor = el as HTMLAnchorElement;
      const orig = anchor.click.bind(anchor);
      anchor.click = () => {
        const blob = blobByUrl.get(anchor.href);
        if (blob) captured.push({ filename: anchor.download, blob });
        orig();
      };
    }
    return el;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeImage(partial: Partial<ImageRecord> & Pick<ImageRecord, "path">): ImageRecord {
  return {
    folderPath: "",
    originalDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    thumbnailDataUrl: "",
    annotationsSvg: "",
    width: 100,
    height: 100,
    sourceUrl: "",
    tags: {},
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

function makeDocument(
  partial: Partial<DocumentRecord> & Pick<DocumentRecord, "path">,
): DocumentRecord {
  return {
    folderPath: "",
    bytes: "<html><body>doc</body></html>",
    thumbnailDataUrl: "",
    title: "Doc",
    imageCount: 0,
    blockCount: 1,
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("downloadGallerySelection", () => {
  it("no-ops when selection is empty", async () => {
    await downloadGallerySelection({ images: [], documents: [] });
    expect(captured).toHaveLength(0);
    expect(buildZipMock).not.toHaveBeenCalled();
  });

  it("single image → direct download with stored filename + image/png MIME", async () => {
    await downloadGallerySelection({
      images: [makeImage({ path: "Screenshots/img1.png" })],
      documents: [],
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.filename).toBe("img1.png");
    expect(captured[0]!.blob.type).toBe("image/png");
    expect(buildZipMock).not.toHaveBeenCalled();
  });

  it("single JPEG image → format=jpg picked from path extension", async () => {
    await downloadGallerySelection({
      images: [makeImage({ path: "Screenshots/photo.jpg" })],
      documents: [],
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.filename).toBe("photo.jpg");
    expect(captured[0]!.blob.type).toBe("image/jpeg");
  });

  it("single document → direct download with bytes as text/html", async () => {
    await downloadGallerySelection({
      images: [],
      documents: [makeDocument({ path: "Docs/guide.annot.html" })],
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.filename).toBe("guide.annot.html");
    expect(captured[0]!.blob.type).toBe("text/html");
  });

  it("multiple files → ZIP with all entries", async () => {
    await downloadGallerySelection({
      images: [makeImage({ path: "Screenshots/a.png" }), makeImage({ path: "Screenshots/b.jpg" })],
      documents: [makeDocument({ path: "Docs/guide.annot.html" })],
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.filename).toMatch(/^annot-\d{8}-\d{6}-\d{3}\.zip$/);
    expect(captured[0]!.blob.type).toBe("application/zip");
    expect(buildZipMock).toHaveBeenCalledTimes(1);
    const entries = buildZipMock.mock.calls[0]![0] as { name: string; data: Uint8Array }[];
    const names = entries.map((e) => e.name);
    expect(names).toEqual(["a.png", "b.jpg", "guide.annot.html"]);
    for (const entry of entries) {
      expect(entry.data).toBeInstanceOf(Uint8Array);
      expect(entry.data.length).toBeGreaterThan(0);
    }
  });

  it("duplicate filenames in ZIP get (2), (3) suffixed", async () => {
    await downloadGallerySelection({
      images: [
        makeImage({ path: "FolderA/screenshot.png" }),
        makeImage({ path: "FolderB/screenshot.png" }),
        makeImage({ path: "FolderC/screenshot.png" }),
      ],
      documents: [],
    });
    expect(buildZipMock).toHaveBeenCalledTimes(1);
    const entries = buildZipMock.mock.calls[0]![0] as { name: string; data: Uint8Array }[];
    expect(entries.map((e) => e.name)).toEqual([
      "screenshot.png",
      "screenshot (2).png",
      "screenshot (3).png",
    ]);
  });

  it("dedup is case-insensitive — `IMG.png` collides with `img.png`", async () => {
    await downloadGallerySelection({
      images: [makeImage({ path: "A/IMG.png" }), makeImage({ path: "B/img.png" })],
      documents: [],
    });
    const entries = buildZipMock.mock.calls[0]![0] as { name: string; data: Uint8Array }[];
    expect(entries.map((e) => e.name)).toEqual(["IMG.png", "img (2).png"]);
  });
});
