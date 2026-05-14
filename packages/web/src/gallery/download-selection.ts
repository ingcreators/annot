/**
 * PWA-side glue for the file-manager's selection-bar "Download"
 * button. Encodes the selected records into their canonical
 * file representations and triggers a browser download — single
 * file → direct `<a download>`, multiple files → ZIP via the
 * shared `@ingcreators/annot-core/zip` builder.
 *
 * Boundary: host-ui (`packages/host-ui/src/gallery/file-manager.ts`)
 * exposes `onDownloadSelection` as an optional callback. The PWA
 * (`packages/web/src/app.ts`) wires this helper. Hosts that don't
 * (yet) provide a download pipeline leave the callback unwired
 * and the button hides automatically.
 *
 * Image encoding reuses {@link buildEditableImageBlob} — the same
 * pipeline every persistent storage backend uses to produce the
 * XMP-embedded bytes that get written to disk. The downloaded
 * file is therefore byte-equivalent (modulo encoder timing) to
 * what an on-disk backend (DeviceStore / DesktopStore / GitHub /
 * Drive) stores; importing the downloaded `.png` back into annot
 * round-trips through `readEditableImage`.
 *
 * Documents are simpler — `DocumentRecord.bytes` already IS a
 * self-contained `.annot.html` file.
 */

import type { DocumentRecord, ImageRecord } from "@ingcreators/annot-core/storage";
import { getFilename } from "@ingcreators/annot-core/storage";
import { defaultAnnotFilenameStem } from "@ingcreators/annot-core/utils";
import { buildZip, type ZipEntry } from "@ingcreators/annot-core/zip";
import { buildEditableImageBlob } from "../storage/image-encode.js";

export interface GalleryDownloadSelection {
  images: readonly ImageRecord[];
  documents: readonly DocumentRecord[];
}

interface EncodedFile {
  name: string;
  bytes: Uint8Array;
  mime: string;
}

/** Pick the encode format for an image based on its stored path
 *  extension. Anything not explicitly JPEG falls back to PNG —
 *  PNG is the safer default (lossless) and matches the encode
 *  pipeline's expectation. */
function pickImageFormat(path: string): "jpg" | "png" {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg";
  return "png";
}

/** Encode an `ImageRecord` into its on-disk file bytes (XMP-
 *  embedded annotated PNG/JPEG). */
async function encodeImage(rec: ImageRecord): Promise<EncodedFile> {
  const format = pickImageFormat(rec.path);
  const blob = await buildEditableImageBlob(rec, format);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const name = getFilename(rec.path) || `${defaultAnnotFilenameStem()}.annot.${format}`;
  return { name, bytes, mime: format === "jpg" ? "image/jpeg" : "image/png" };
}

/** Encode a `DocumentRecord` into its on-disk file bytes — the
 *  stored `bytes` field is already a self-contained `.annot.html`
 *  document, so this is just a text-encode. */
function encodeDocument(rec: DocumentRecord): EncodedFile {
  const name = getFilename(rec.path) || `${defaultAnnotFilenameStem()}.annot.html`;
  const bytes = new TextEncoder().encode(rec.bytes);
  return { name, bytes, mime: "text/html" };
}

/** Ensure every entry in `files` has a unique `name` by suffixing
 *  `(2)`, `(3)`, … before the last `.` on collisions. Operates
 *  in place on a fresh array — callers pass a single-use list. */
function deduplicateFilenames(files: EncodedFile[]): EncodedFile[] {
  const seen = new Map<string, number>();
  for (const file of files) {
    const lower = file.name.toLowerCase();
    const count = seen.get(lower) ?? 0;
    if (count > 0) {
      const dot = file.name.lastIndexOf(".");
      const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
      const ext = dot > 0 ? file.name.slice(dot) : "";
      let candidate = `${stem} (${count + 1})${ext}`;
      let probe = count + 1;
      while (seen.has(candidate.toLowerCase())) {
        probe += 1;
        candidate = `${stem} (${probe})${ext}`;
      }
      file.name = candidate;
      seen.set(lower, count + 1);
      seen.set(candidate.toLowerCase(), 1);
    } else {
      seen.set(lower, 1);
    }
  }
  return files;
}

/** Trigger a browser download for `bytes`. Mirrors the existing
 *  `<a download>` pattern in `@ingcreators/annot-editor/export`
 *  — Electron handles the click natively via its save dialog. */
function triggerDownload(filename: string, bytes: Uint8Array, mime: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Download the file-manager's current selection.
 *
 * Single file → direct download with the file's stored name.
 * Multiple files → flat ZIP, default name `annot-<timestamp>.zip`.
 *
 * Throws on encode failure so the host-ui `#downloadSelection`
 * wrapper can show an alert dialog.
 */
export async function downloadGallerySelection(selection: GalleryDownloadSelection): Promise<void> {
  const files: EncodedFile[] = [];
  for (const rec of selection.images) {
    files.push(await encodeImage(rec));
  }
  for (const rec of selection.documents) {
    files.push(encodeDocument(rec));
  }
  if (files.length === 0) return;

  if (files.length === 1) {
    const only = files[0]!;
    triggerDownload(only.name, only.bytes, only.mime);
    return;
  }

  deduplicateFilenames(files);
  const entries: ZipEntry[] = files.map((f) => ({ name: f.name, data: f.bytes }));
  const zipBlob = buildZip(entries);
  const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
  const zipName = `${defaultAnnotFilenameStem()}.zip`;
  triggerDownload(zipName, zipBytes, "application/zip");
}
