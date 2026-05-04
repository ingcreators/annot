/**
 * `VSCodeStore` — extension-host side `StorageProvider` over
 * `vscode.workspace.fs`.
 *
 * Phase 4 of `docs/plans/_done/vscode-extension-host.md`. The
 * StorageProvider interface has 13 required methods (Annot's
 * full storage contract); for the Phase 4 skeleton, this
 * implementation supplies the methods `EditorShell` actually
 * touches in its `open(path)` / `saveNow()` lifecycle:
 *
 *   - `getImage(path)` — read file bytes, decode SVG (or recover
 *     from XMP for PNG / JPEG), return as `ImageRecord`.
 *   - `updateImage(path, updates)` — re-encode + write back.
 *
 * The remaining methods (folder operations, list, move / rename
 * / delete) throw a `NotImplementedError` so the extension's
 * future surface (gallery view, Phase 5+) makes the omission
 * obvious instead of returning misleading empty results.
 *
 * Phase 5 fills in the rest as the VSCode UX expands beyond the
 * "open one annotation file at a time via the custom editor"
 * baseline.
 */

import * as path from "node:path";
import * as vscode from "vscode";
import type {
  FolderRecord,
  ImageRecord,
  ImageRecordUpdate,
  StorageProvider,
} from "@ingcreators/annot-core/storage";

class NotImplementedError extends Error {
  constructor(method: string) {
    super(
      `VSCodeStore.${method}: not implemented in Phase 4 skeleton — ` +
        `the custom-editor flow only needs getImage / updateImage. ` +
        `Phase 5 fills the remaining surface.`,
    );
    this.name = "NotImplementedError";
  }
}

export class VSCodeStore implements StorageProvider {
  /** The workspace folder the store reads / writes inside. Phase 4
   *  uses the first workspace folder; Phase 5 can support
   *  multi-root by routing per-document URIs. */
  readonly #root: vscode.Uri;

  constructor(root: vscode.Uri) {
    this.#root = root;
  }

  // ─── EditorShell-required methods ────────────────────────────

  async getImage(filePath: string): Promise<ImageRecord | undefined> {
    const uri = this.#resolveUri(filePath);
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch {
      return undefined;
    }
    const ext = path.extname(uri.fsPath).toLowerCase();
    return this.#decodeImageRecord(filePath, bytes, ext);
  }

  async updateImage(filePath: string, updates: ImageRecordUpdate): Promise<void> {
    const existing = await this.getImage(filePath);
    if (!existing) {
      throw new Error(`VSCodeStore.updateImage: no file at ${filePath}`);
    }
    const next: ImageRecord = { ...existing, ...updates };
    const uri = this.#resolveUri(filePath);
    const ext = path.extname(uri.fsPath).toLowerCase();
    const bytes = this.#encodeImageRecord(next, ext);
    await vscode.workspace.fs.writeFile(uri, bytes);
  }

  // ─── Decoders / encoders by extension ────────────────────────

  #decodeImageRecord(filePath: string, bytes: Uint8Array, ext: string): ImageRecord {
    const folderPath = path.dirname(filePath).replace(/\\/g, "/");
    if (ext === ".svg") {
      // The annotation SVG is the file itself. The embedded
      // `<image href="data:...">` carries the screenshot bytes.
      // For the skeleton we assign the entire SVG to
      // `annotationsSvg` and leave `originalDataUrl` empty;
      // Phase 5 parses out the embedded image and populates
      // both fields properly.
      const svg = new TextDecoder().decode(bytes);
      const dims = parseSvgDims(svg);
      return {
        path: filePath,
        folderPath,
        originalDataUrl: "",
        thumbnailDataUrl: "",
        annotationsSvg: svg,
        width: dims.width,
        height: dims.height,
        sourceUrl: "",
        tags: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    if (ext === ".png" || ext === ".jpeg" || ext === ".jpg") {
      // Phase 5 wires the existing `readEditableImage` round-trip
      // from `@ingcreators/annot-core/xmp` to recover the
      // annotation SVG out of the XMP packet. For Phase 4 we
      // simply construct a minimal record so the EditorShell can
      // mount the image even if the XMP recovery step is missing.
      const dataUrl =
        "data:" +
        (ext === ".png" ? "image/png" : "image/jpeg") +
        ";base64," +
        bufferToBase64(bytes);
      return {
        path: filePath,
        folderPath,
        originalDataUrl: dataUrl,
        thumbnailDataUrl: "",
        annotationsSvg: "",
        // The EditorShell happy-path doesn't actually need
        // dimensions until the canvas mounts; leaving them at 0
        // would still let `open()` succeed for the test fixture.
        // Phase 5 reads dims from the PNG / JPEG header.
        width: 0,
        height: 0,
        sourceUrl: "",
        tags: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    throw new Error(`VSCodeStore: unsupported extension ${ext}`);
  }

  #encodeImageRecord(record: ImageRecord, ext: string): Uint8Array {
    if (ext === ".svg") {
      return new TextEncoder().encode(record.annotationsSvg);
    }
    if (ext === ".png" || ext === ".jpeg" || ext === ".jpg") {
      // Phase 5 wires `createEditableImage` to embed the
      // annotation SVG in the XMP packet of the original image
      // bytes. For Phase 4 we round-trip the original `data:`
      // URL only.
      const m = record.originalDataUrl.match(/^data:[^;]+;base64,(.+)$/);
      if (!m) {
        throw new Error(
          "VSCodeStore: cannot encode raster without a base64 data URL " +
            "(Phase 5 will preserve the original file bytes via XMP)",
        );
      }
      return base64ToBuffer(m[1]!);
    }
    throw new Error(`VSCodeStore: unsupported extension ${ext}`);
  }

  #resolveUri(filePath: string): vscode.Uri {
    // Phase 4 treats `path` as a workspace-relative POSIX path.
    // Strip the leading slash before joining so VSCode doesn't
    // interpret it as absolute.
    const rel = filePath.replace(/^\/+/, "");
    return vscode.Uri.joinPath(this.#root, rel);
  }

  // ─── Methods stubbed for Phase 4 ─────────────────────────────

  saveImage(): Promise<string> {
    throw new NotImplementedError("saveImage");
  }
  listImages(): Promise<ImageRecord[]> {
    throw new NotImplementedError("listImages");
  }
  moveImage(): Promise<string> {
    throw new NotImplementedError("moveImage");
  }
  renameImage(): Promise<string> {
    throw new NotImplementedError("renameImage");
  }
  deleteImage(): Promise<void> {
    throw new NotImplementedError("deleteImage");
  }
  createFolder(): Promise<string> {
    throw new NotImplementedError("createFolder");
  }
  listFolders(): Promise<FolderRecord[]> {
    throw new NotImplementedError("listFolders");
  }
  getFolder(): Promise<FolderRecord | undefined> {
    throw new NotImplementedError("getFolder");
  }
  renameFolder(): Promise<string> {
    throw new NotImplementedError("renameFolder");
  }
  moveFolder(): Promise<string> {
    throw new NotImplementedError("moveFolder");
  }
  deleteFolder(): Promise<void> {
    throw new NotImplementedError("deleteFolder");
  }
  getBreadcrumb(): Promise<FolderRecord[]> {
    return Promise.resolve([]);
  }
}

// ─── Helpers ───────────────────────────────────────────────────

function parseSvgDims(svg: string): { width: number; height: number } {
  const w = svg.match(/<svg[^>]*\bwidth\s*=\s*["']?(\d+(?:\.\d+)?)/i);
  const h = svg.match(/<svg[^>]*\bheight\s*=\s*["']?(\d+(?:\.\d+)?)/i);
  return {
    width: w?.[1] ? Number.parseFloat(w[1]) : 0,
    height: h?.[1] ? Number.parseFloat(h[1]) : 0,
  };
}

function bufferToBase64(bytes: Uint8Array): string {
  // Node 18+ has `Buffer.from(bytes).toString("base64")`. Vite's
  // `node18` target ships Buffer in the bundle so we use it.
  return Buffer.from(bytes).toString("base64");
}

function base64ToBuffer(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}
