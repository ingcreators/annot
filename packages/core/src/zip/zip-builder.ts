/**
 * Browser-side ZIP builder. Wraps the DOM-free
 * {@link buildZipBytes} from `./zip-bytes` in a `Blob` so existing
 * browser callers (PPTX export, GitHub publish flow) keep their
 * familiar return type. Node-side callers (Phase 4 of
 * `desktop-electron-migration.md`) import `buildZipBytes` directly.
 */

import { buildZipBytes, type ZipEntry } from "./zip-bytes.js";

export type { ZipEntry };
export { buildZipBytes };

export function buildZip(entries: ZipEntry[]): Blob {
  const bytes = buildZipBytes(entries);
  return new Blob([bytes as BlobPart], { type: "application/zip" });
}

/** Convert a data URL to Uint8Array binary. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(",")[1] || "";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/** Detect file extension from data URL mime type. */
export function dataUrlExt(dataUrl: string): string {
  if (dataUrl.startsWith("data:image/png")) return "png";
  return "jpg";
}
