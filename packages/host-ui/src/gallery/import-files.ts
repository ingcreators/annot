/**
 * Batch file import for the file manager — picker- AND drag-drop-
 * driven. Tier C: uses `FileReader`, `Image`, and `createImageBitmap`
 * via the shared thumbnail pipeline.
 *
 * Routes each input `File` to either the image-save path (PNG / JPEG
 * / SVG, plus embedded-XMP `.annot.png` / `.annot.jpeg` round-trip)
 * or the document-save path (`.annot.html`). Unsupported types are
 * reported as `{ kind: "skipped" }` rather than thrown so a single
 * stray file in a multi-drop doesn't abort the rest.
 *
 * Per-file failures are isolated — the loop continues with the next
 * file and the failure surfaces in the result list with the original
 * error attached. Mirrors the resilience pattern of the extension →
 * PWA transfer at
 * `packages/web/src/app/extension-transfer-host.ts`.
 */

import type { StorageProvider } from "@ingcreators/annot-core/storage";
import { supportsDocuments } from "@ingcreators/annot-core/storage";
import { readEditableImage } from "@ingcreators/annot-core/xmp";
import { parseDocumentMetaCheap } from "@ingcreators/annot-doc/headless";
import { generateThumbnailFromDataUrl, renderThumbnailWithDims } from "../image-thumbnail.js";
import type { ThumbnailManager } from "../thumbnail-manager.js";

export interface ImportFilesDeps {
  storage: StorageProvider;
  folderPath: string;
  /** Optional unified thumbnail cache. When supplied, each saved
   *  image's thumbnail is warmed via `tm.write(...)` so the gallery
   *  card lights up without a background prefetch round-trip. */
  thumbnailManager?: ThumbnailManager | null;
  /** Fired once per file as soon as that file's save settles
   *  (success, skip, or failure). `done` is the number completed
   *  so far including the current one; `total === files.length`. */
  onProgress?: (done: number, total: number) => void;
}

export interface ImportFileResult {
  file: File;
  kind: "image" | "document" | "skipped";
  /** Storage path the save resolved to (post-uniquification). Only
   *  present on success. */
  path?: string;
  /** Reason the file was skipped — included only on `kind:
   *  "skipped"` so the host can surface a useful message
   *  ("unsupported type", "storage doesn't support documents",
   *  etc.). */
  skipReason?: "unsupported-type" | "documents-not-supported" | "empty-file";
  /** Present on failure. Whatever the underlying storage call
   *  threw. */
  error?: unknown;
}

/** Lowercase extension extraction that handles compound `.annot.*`
 *  forms — `.annot.html` returns `annot.html`, plain `.png` returns
 *  `png`. Returns `""` for files without a `.`. */
function extOf(name: string): string {
  const lower = name.toLowerCase();
  // Compound annot-format extensions take precedence over the
  // simple last-segment match so `.annot.png` doesn't get classified
  // as a plain PNG before we read its XMP.
  if (lower.endsWith(".annot.html")) return "annot.html";
  if (lower.endsWith(".annot.svg")) return "annot.svg";
  if (lower.endsWith(".annot.png")) return "annot.png";
  if (lower.endsWith(".annot.jpg")) return "annot.jpg";
  if (lower.endsWith(".annot.jpeg")) return "annot.jpeg";
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot + 1) : "";
}

const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "svg",
  "annot.png",
  "annot.jpg",
  "annot.jpeg",
  "annot.svg",
]);

function isHtmlExt(ext: string): boolean {
  return ext === "html" || ext === "htm" || ext === "annot.html";
}

/** Wrap a `Blob`/`File` as a data URL via `FileReader`. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

interface SaveImageArgs {
  storage: StorageProvider;
  file: File;
  folderPath: string;
  thumbnailManager?: ThumbnailManager | null;
}

async function importOneImage({
  storage,
  file,
  folderPath,
  thumbnailManager,
}: SaveImageArgs): Promise<{ path: string }> {
  // Pull the bytes once: we need both an XMP probe (Uint8Array)
  // and (for the non-XMP path) a data URL for storage. The XMP
  // path additionally needs a Blob of the extracted original to
  // feed the thumbnail pipeline.
  const arrayBuf = await file.arrayBuffer();
  const meta = readEditableImage(new Uint8Array(arrayBuf));

  let originalUrl: string;
  let annotations = "";
  let tags: Record<string, string> = {};
  let w = 0;
  let h = 0;
  let thumbnailDataUrl = "";

  if (meta?.annotationsSvg) {
    // XMP round-trip: the embedded original takes precedence over
    // the outer container's bytes, since the container has the
    // annotation layer flattened in.
    originalUrl = meta.originalImageDataUrl || (await blobToDataUrl(file));
    annotations = meta.annotationsSvg;
    tags = meta.tags || {};
    w = meta.width || 0;
    h = meta.height || 0;
    if (originalUrl) {
      const resp = await fetch(originalUrl);
      const blob = await resp.blob();
      const thumb = await renderThumbnailWithDims(blob);
      thumbnailDataUrl = thumb.dataUrl;
      if (!w) w = thumb.width;
      if (!h) h = thumb.height;
    }
  } else {
    // Plain file (PNG / JPEG / SVG) — generate the thumbnail and
    // probe dimensions from the same decode.
    const thumb = await renderThumbnailWithDims(file);
    thumbnailDataUrl = thumb.dataUrl;
    w = thumb.width;
    h = thumb.height;
    originalUrl = await blobToDataUrl(file);
    // SVG falls through `renderThumbnailWithDims` returning zeros
    // (no `createImageBitmap` support) — fall back to a no-decode
    // thumbnail attempt via the data URL pipeline so the gallery
    // card still gets something.
    if (!thumbnailDataUrl) {
      thumbnailDataUrl = await generateThumbnailFromDataUrl(originalUrl);
    }
  }

  if (!originalUrl) {
    throw new Error("Failed to read file as data URL");
  }

  const now = new Date().toISOString();
  const path = await storage.saveImage(
    {
      originalDataUrl: originalUrl,
      thumbnailDataUrl,
      annotationsSvg: annotations,
      width: w,
      height: h,
      sourceUrl: "",
      tags,
      folderPath,
      createdAt: now,
      updatedAt: now,
    },
    { filename: file.name || undefined },
  );

  if (thumbnailManager && thumbnailDataUrl) {
    await thumbnailManager.write(storage, path, thumbnailDataUrl, {
      width: w,
      height: h,
    });
  }

  return { path };
}

async function importOneDocument({
  storage,
  file,
  folderPath,
}: SaveImageArgs): Promise<{ path: string }> {
  if (!supportsDocuments(storage)) {
    throw new Error("Storage backend does not support documents");
  }
  const text = await file.text();
  const meta = parseDocumentMetaCheap(text);
  const now = new Date().toISOString();
  const path = await storage.saveDocument(
    {
      folderPath,
      bytes: text,
      thumbnailDataUrl: "",
      title: meta.title,
      imageCount: meta.imageCount,
      blockCount: meta.blockCount,
      createdAt: now,
      updatedAt: now,
    },
    { filename: file.name || undefined },
  );
  return { path };
}

/**
 * Import a batch of `File`s into `deps.storage` under
 * `deps.folderPath`. Sequential (not parallel) so the storage
 * backend isn't swamped with concurrent writes — backends with
 * remote round-trips (GitHub / Drive) benefit most from this.
 *
 * Never throws: every file's outcome is captured in the returned
 * result list. Callers inspect `kind` + `error` to summarise.
 */
export async function importFiles(
  files: File[],
  deps: ImportFilesDeps,
): Promise<ImportFileResult[]> {
  const results: ImportFileResult[] = [];
  const total = files.length;
  const docsSupported = supportsDocuments(deps.storage);

  for (let i = 0; i < total; i++) {
    const file = files[i]!;
    const ext = extOf(file.name);
    let result: ImportFileResult;

    if (file.size === 0) {
      result = { file, kind: "skipped", skipReason: "empty-file" };
    } else if (IMAGE_EXTS.has(ext)) {
      try {
        const saved = await importOneImage({
          storage: deps.storage,
          file,
          folderPath: deps.folderPath,
          thumbnailManager: deps.thumbnailManager,
        });
        result = { file, kind: "image", path: saved.path };
      } catch (error) {
        result = { file, kind: "image", error };
      }
    } else if (isHtmlExt(ext)) {
      // Plain `.html` is treated as a document only if it carries the
      // annot-doc marker. `.annot.html` is presumed annot-format.
      let isAnnotDoc = ext === "annot.html";
      if (!isAnnotDoc) {
        try {
          const peek = await file.text();
          isAnnotDoc = /data-annot-doc-version=/i.test(peek);
        } catch {
          isAnnotDoc = false;
        }
      }
      if (!isAnnotDoc) {
        result = { file, kind: "skipped", skipReason: "unsupported-type" };
      } else if (!docsSupported) {
        result = { file, kind: "skipped", skipReason: "documents-not-supported" };
      } else {
        try {
          const saved = await importOneDocument({
            storage: deps.storage,
            file,
            folderPath: deps.folderPath,
          });
          result = { file, kind: "document", path: saved.path };
        } catch (error) {
          result = { file, kind: "document", error };
        }
      }
    } else {
      result = { file, kind: "skipped", skipReason: "unsupported-type" };
    }

    results.push(result);
    deps.onProgress?.(i + 1, total);
  }

  return results;
}
