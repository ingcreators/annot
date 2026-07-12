/**
 * XMP-bearing image read/write IPC — Phase 2 of
 * `docs/plans/desktop-electron-migration.md`, collapsed onto the
 * shared `@ingcreators/annot-core/xmp-bytes` primitives by
 * `docs/plans/metadata-unification.md` Phase 1.
 *
 * History: this file used to be a self-contained direct port of
 * `src-tauri/src/commands/xmp.rs` — its own XMP builder, parser,
 * and PNG/JPEG chunk walkers, byte-for-byte compatible with the
 * core implementation but maintained separately. The schema-2.0
 * work made the duplication a liability (every packet change would
 * have to land twice), so the handlers are now a thin adapter over
 * the Tier-A core writers/readers. The wire format is unchanged —
 * both implementations descend from the same Rust layout
 * (PNG: XMP in `iTXt` + original in `svGo`; JPEG: XMP in APP1 +
 * original across `annot:OriginalImage\0` APP2 segments).
 *
 * Behaviour gap from the Rust impl (deliberate, unchanged): the
 * `image_to_progressive_jpeg` compression of the embedded original
 * is not ported. When `filePath` ends with `.jpg`/`.jpeg` and the
 * rendered image is a PNG, the host-supplied `pngToJpeg` callback
 * converts (Electron `nativeImage.toJPEG(90)`, baseline).
 */

import { promises as fs } from "node:fs";
import {
  buildXmp,
  readEditableImage,
  writeJpegWithMetadata,
  writePngWithMetadata,
} from "@ingcreators/annot-core/xmp-bytes";

/** Wire shape returned to the renderer over `read_xmp`. Snake_case
 *  mirrors the original Tauri command output the renderer's
 *  `desktop-bridge.ts` still types against. */
export interface AnnotMetadata {
  original_image_b64: string;
  annotations_svg: string;
  width: number;
  height: number;
  tags?: string;
}

export interface SaveWithXmpInput {
  renderedImageB64: string;
  originalImageB64: string;
  annotationsSvg: string;
  width: number;
  height: number;
  filePath: string;
  tags?: Record<string, string>;
}

export interface XmpHandlers {
  saveWithXmp(input: SaveWithXmpInput): Promise<void>;
  readXmp(input: { filePath: string }): Promise<AnnotMetadata | null>;
}

export interface XmpHandlerOptions {
  /** Convert PNG bytes → JPEG bytes. The Electron default in
   *  `main.ts` uses `nativeImage.toJPEG(90)` (baseline). Tests pass
   *  a stub that returns a fixed JPEG or throws to cover the error
   *  path. */
  pngToJpeg(png: Uint8Array): Promise<Uint8Array>;
}

export function createXmpHandlers(opts: XmpHandlerOptions): XmpHandlers {
  return {
    async saveWithXmp(input) {
      const xmpXml = buildXmp({
        annotationsSvg: input.annotationsSvg,
        width: input.width,
        height: input.height,
        tags: input.tags,
      });
      const xmpBytes = new TextEncoder().encode(xmpXml);
      const imgBytes = base64ToBytes(input.renderedImageB64);
      // The Rust impl ran the original through
      // `image_to_progressive_jpeg` to compress it. The TS port
      // embeds the bytes as-is — see file-level comment.
      const originalBytes = base64ToBytes(input.originalImageB64);

      if (input.filePath.toLowerCase().endsWith(".png")) {
        const out = writePngWithMetadata(imgBytes, xmpBytes, originalBytes);
        await fs.writeFile(input.filePath, out);
        return;
      }
      // JPEG output. If the rendered image came in as a PNG
      // (typical — `getPngDataUrl(canvas)`), convert first via
      // the host-supplied callback.
      let jpegBytes: Uint8Array = imgBytes;
      if (startsWithPngSignature(imgBytes)) {
        jpegBytes = await opts.pngToJpeg(imgBytes);
      }
      const out = writeJpegWithMetadata(jpegBytes, xmpBytes, originalBytes);
      await fs.writeFile(input.filePath, out);
    },

    async readXmp({ filePath }) {
      const data = await fs.readFile(filePath);
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const meta = readEditableImage(bytes);
      if (!meta) return null;
      const originalB64 = meta.originalImageDataUrl
        ? meta.originalImageDataUrl.slice(meta.originalImageDataUrl.indexOf(",") + 1)
        : "";
      return {
        original_image_b64: originalB64,
        annotations_svg: meta.annotationsSvg,
        width: meta.width,
        height: meta.height,
        tags: Object.keys(meta.tags).length > 0 ? JSON.stringify(meta.tags) : "",
      };
    },
  };
}

// ---- Helpers ────────────────────────────────────────────────────

function startsWithPngSignature(data: Uint8Array): boolean {
  return data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
}

function base64ToBytes(b64: string): Uint8Array {
  // Buffer is universally available in the Electron main process
  // (Node), and far faster than the atob loop xmp-browser uses.
  return new Uint8Array(Buffer.from(b64, "base64"));
}

// ---- Channel registration map ───────────────────────────────────

export const XMP_CHANNELS = {
  saveWithXmp: "save_with_xmp",
  readXmp: "read_xmp",
} as const;

export type XmpChannel = (typeof XMP_CHANNELS)[keyof typeof XMP_CHANNELS];

export const XMP_CHANNEL_TO_HANDLER: Record<XmpChannel, keyof XmpHandlers> = {
  [XMP_CHANNELS.saveWithXmp]: "saveWithXmp",
  [XMP_CHANNELS.readXmp]: "readXmp",
};
