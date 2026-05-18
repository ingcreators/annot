// Data-URL ↔ bytes helpers. Self-contained so cloud-store doesn't
// pull in `@ingcreators/annot-core/zip` (which has a deeper
// dependency graph) just for these two primitives.

/** Parse a `data:image/...;base64,...` URL into raw bytes +
 *  mime type. Throws on malformed inputs — callers that handle
 *  user input should validate first. */
export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mimeType: string } {
  const match = /^data:([^;,]+)(?:;base64)?,(.*)$/.exec(dataUrl);
  if (!match) {
    throw new Error("Malformed data URL");
  }
  const mimeType = match[1] ?? "application/octet-stream";
  const payload = match[2] ?? "";
  const isBase64 = dataUrl.startsWith(`data:${mimeType};base64,`);
  if (isBase64) {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mimeType };
  }
  // URL-encoded payload (rare for images, common for SVG). Decode
  // then UTF-8 encode so the output bytes match a "raw" view.
  const decoded = decodeURIComponent(payload);
  return { bytes: new TextEncoder().encode(decoded), mimeType };
}

/** Build a `data:<mime>;base64,...` URL from raw bytes. */
export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  // Avoid `String.fromCharCode(...bytes)` which blows the stack on
  // large arrays. Build a binary string in 32 KB chunks instead.
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mimeType};base64,${btoa(bin)}`;
}
