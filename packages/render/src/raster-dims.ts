/**
 * Raster dimension probing — the shared raw-raster fallback for
 * hosts opening images that carry no Annot XMP packet (an external
 * screenshot dropped into a library / device folder / renamed to
 * `*.annot.png` by hand).
 *
 * A 0×0 `ImageRecord` mounts a 0×0 canvas svg (blank editor):
 * EditorShell sizes the canvas from the record, not from the
 * decoded bitmap. Storage backends (DesktopStore, DeviceStore) and
 * the vscode webview's raw-raster open path all probe through this
 * helper before building the record.
 *
 * Tier C-render: needs `createImageBitmap`, no live editor session.
 */

/** Decode raster bytes to recover pixel dimensions. Fail-soft:
 *  returns 0×0 when decoding is unavailable (non-browser test
 *  environments) or the bytes are unparseable — callers treat
 *  that the same as "dimensions unknown". */
export async function probeRasterDims(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(blob);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    return { width: 0, height: 0 };
  }
}
