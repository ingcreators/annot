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
import { joinPath, supportsDocuments } from "@ingcreators/annot-core/storage";
import { readEditableImage } from "@ingcreators/annot-core/xmp";
import { parseDocumentMetaCheap } from "@ingcreators/annot-doc/headless";
import { generateThumbnailFromDataUrl, renderThumbnailWithDims } from "../image-thumbnail.js";
import type { ThumbnailManager } from "../thumbnail-manager.js";

/** Action the host returns from `onConflict` for each per-file
 *  collision. `replace` deletes the existing record first and
 *  saves with the exact requested filename; `keepBoth` lets the
 *  store auto-uniquify (the legacy behaviour); `skip` discards
 *  the incoming file; `cancel` aborts the entire batch — every
 *  remaining file is reported as `{ kind: "skipped",
 *  skipReason: "duplicate-cancelled" }`. */
export type ImportConflictAction = "replace" | "keepBoth" | "skip" | "cancel";

export interface ImportConflictInfo {
  file: File;
  /** The full storage path that would collide if we saved with
   *  `file.name` as the leaf. */
  existingPath: string;
  /** Which save surface the collision is on — drives the dialog
   *  copy ("image" vs "document"). */
  kind: "image" | "document";
  /** Total file count in the batch. The host can use this to
   *  decide whether to expose the "Apply to all" affordance. */
  total: number;
}

export interface ImportConflictDecision {
  action: ImportConflictAction;
  /** If true, the same `action` is automatically applied to every
   *  subsequent conflict in this batch without re-prompting. */
  applyToAll?: boolean;
}

export type ImportConflictHandler = (info: ImportConflictInfo) => Promise<ImportConflictDecision>;

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
  /** Invoked once per detected name collision. Host returns the
   *  user's choice (Replace / Keep both / Skip / Cancel). When
   *  omitted the importer falls back to the legacy "keep both"
   *  behaviour — the store auto-uniquifies with " (2)", " (3)"
   *  suffixes silently. */
  onConflict?: ImportConflictHandler;
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
  skipReason?:
    | "unsupported-type"
    | "documents-not-supported"
    | "empty-file"
    | "duplicate-skipped"
    | "duplicate-cancelled";
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
  /** When true, delete the existing record at the would-be path
   *  before saving. The post-delete save uses `file.name`
   *  verbatim so the store's auto-uniquify is a no-op (there's
   *  nothing to collide with) and the new record lands at the
   *  exact original path. */
  replaceExisting?: boolean;
}

async function importOneImage({
  storage,
  file,
  folderPath,
  thumbnailManager,
  replaceExisting,
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

  if (replaceExisting && file.name) {
    // Delete-then-save model: simpler + uniform across stores than
    // threading an `overwrite` flag through every backend's save
    // path. `deleteImage` is contractually silent on no-op, so a
    // concurrent deletion between the existence-check and here is
    // harmless. The subsequent save uses the original filename
    // unchanged, so the store's auto-uniquify is a no-op.
    await storage.deleteImage(joinPath(folderPath, file.name));
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
  replaceExisting,
}: SaveImageArgs): Promise<{ path: string }> {
  if (!supportsDocuments(storage)) {
    throw new Error("Storage backend does not support documents");
  }
  const text = await file.text();
  const meta = parseDocumentMetaCheap(text);
  if (replaceExisting && file.name) {
    // `deleteImage` covers documents too — the path-keyed model is
    // uniform per the types.ts contract ("`deleteImage(\"a/b.annot.html\")`
    // deletes a document just as it deletes an image").
    await storage.deleteImage(joinPath(folderPath, file.name));
  }
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

/** Probe storage for an existing record at the given path. Images
 *  and documents share the same path keyspace per the storage
 *  contract, so a name collision can be on either side. */
async function findExisting(
  storage: StorageProvider,
  path: string,
  kind: "image" | "document",
): Promise<boolean> {
  if (kind === "document" && supportsDocuments(storage)) {
    const rec = await storage.getDocument(path);
    if (rec) return true;
  }
  const img = await storage.getImage(path);
  return !!img;
}

/**
 * Import a batch of `File`s into `deps.storage` under
 * `deps.folderPath`. Sequential (not parallel) so the storage
 * backend isn't swamped with concurrent writes — backends with
 * remote round-trips (GitHub / Drive) benefit most from this. The
 * sequential loop is also load-bearing for the conflict-resolution
 * UX: the user sees one prompt at a time, in the order the files
 * were dropped, and the "Apply to all remaining" toggle behaves
 * predictably.
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
  // "Apply to all" cache. Once the user opts in for a conflict,
  // every subsequent collision in this batch is resolved with the
  // same action without re-prompting. A `cancel` decision short-
  // circuits the loop instead — it never reaches this cache.
  let stickyAction: ImportConflictAction | null = null;
  let aborted = false;

  for (let i = 0; i < total; i++) {
    const file = files[i]!;
    const ext = extOf(file.name);
    let result: ImportFileResult;

    if (aborted) {
      results.push({ file, kind: "skipped", skipReason: "duplicate-cancelled" });
      deps.onProgress?.(i + 1, total);
      continue;
    }

    // Decide what storage surface this file targets, so we can run
    // the conflict pre-check against the right path-key space.
    let saveKind: "image" | "document" | null = null;
    let isAnnotDocCached: boolean | null = null;
    let docTextCached: string | null = null;

    if (file.size === 0) {
      result = { file, kind: "skipped", skipReason: "empty-file" };
    } else if (IMAGE_EXTS.has(ext)) {
      saveKind = "image";
    } else if (isHtmlExt(ext)) {
      // Plain `.html` is treated as a document only if it carries the
      // annot-doc marker. `.annot.html` is presumed annot-format.
      let isAnnotDoc = ext === "annot.html";
      if (!isAnnotDoc) {
        try {
          const peek = await file.text();
          docTextCached = peek;
          isAnnotDoc = /data-annot-doc-version=/i.test(peek);
        } catch {
          isAnnotDoc = false;
        }
      }
      isAnnotDocCached = isAnnotDoc;
      if (!isAnnotDoc) {
        result = { file, kind: "skipped", skipReason: "unsupported-type" };
      } else if (!docsSupported) {
        result = { file, kind: "skipped", skipReason: "documents-not-supported" };
      } else {
        saveKind = "document";
      }
    } else {
      result = { file, kind: "skipped", skipReason: "unsupported-type" };
    }

    if (saveKind && file.name) {
      // Conflict pre-check. The current would-be path is
      // `joinPath(folderPath, file.name)`; if a record already
      // lives there, ask the host (or fall back to "keep both"
      // which mirrors the legacy auto-uniquify behaviour).
      const wouldBePath = joinPath(deps.folderPath, file.name);
      const existing = await findExisting(deps.storage, wouldBePath, saveKind);
      let action: ImportConflictAction = "keepBoth";
      if (existing) {
        if (stickyAction) {
          action = stickyAction;
        } else if (deps.onConflict) {
          const decision = await deps.onConflict({
            file,
            existingPath: wouldBePath,
            kind: saveKind,
            total,
          });
          action = decision.action;
          if (decision.applyToAll && action !== "cancel") {
            stickyAction = action;
          }
        }
        // No `onConflict` handler → silently keep both (legacy).
      }

      if (action === "cancel") {
        aborted = true;
        result = { file, kind: "skipped", skipReason: "duplicate-cancelled" };
      } else if (action === "skip") {
        result = { file, kind: "skipped", skipReason: "duplicate-skipped" };
      } else if (saveKind === "image") {
        try {
          const saved = await importOneImage({
            storage: deps.storage,
            file,
            folderPath: deps.folderPath,
            thumbnailManager: deps.thumbnailManager,
            replaceExisting: action === "replace",
          });
          result = { file, kind: "image", path: saved.path };
        } catch (error) {
          result = { file, kind: "image", error };
        }
      } else {
        // Document path. The earlier branch already validated
        // `docsSupported`, so we can reach `importOneDocument`
        // confidently.
        try {
          // Avoid re-reading the file when the annot-doc marker
          // peek already pulled the text — `file.text()` returns
          // a fresh Promise each call but the bytes are the same.
          if (docTextCached === null && isAnnotDocCached === true) {
            // `.annot.html` was trusted without a peek read; nothing
            // to forward. `importOneDocument` will read.
          }
          const saved = await importOneDocument({
            storage: deps.storage,
            file,
            folderPath: deps.folderPath,
            replaceExisting: action === "replace",
          });
          result = { file, kind: "document", path: saved.path };
        } catch (error) {
          result = { file, kind: "document", error };
        }
      }
    }

    // `result` is guaranteed assigned in every branch above —
    // either by the skip / empty branches or by the save flow.
    results.push(result!);
    deps.onProgress?.(i + 1, total);
  }

  return results;
}
