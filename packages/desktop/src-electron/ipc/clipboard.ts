/**
 * Office-clipboard IPC.
 *
 * Direct port of the GVML packaging from the deleted
 * `packages/desktop/src-tauri/src/commands/clipboard.rs`. One
 * channel:
 *
 *   - `copy_as_office(drawing_xml, mosaic_media, screenshot, png)`
 *     → builds the GVML OPC ZIP envelope (content_types + rels +
 *       theme + drawing + media), packs the source PNG into a
 *       `CF_DIB` payload, and writes BOTH formats to the system
 *       clipboard atomically. Office / Word / PowerPoint paste
 *       the GVML side as native shapes; Paint, browsers, Google
 *       Sheets, and other consumers paste the `CF_DIB` side as
 *       a bitmap.
 *
 * **How the atomic multi-format write works.** Win32 does not
 * accumulate clipboard formats across calls — each
 * `OpenClipboard + EmptyClipboard + SetClipboardData +
 * CloseClipboard` cycle replaces whatever was on the clipboard
 * before. Electron's `clipboard.writeBuffer(format, buffer)` runs
 * exactly that sequence per call, so back-to-back calls
 * structurally cannot accumulate. To set GVML + CF_DIB together
 * we drive Win32 directly through a small native addon that does
 * one `OpenClipboard + EmptyClipboard + N×SetClipboardData +
 * CloseClipboard` cycle per `writeFormats` invocation. The host
 * adapter loads
 * `packages/desktop/native/win-clipboard/prebuilds/win-clipboard.win32-x64.node`
 * and exposes the resulting function via the
 * `ClipboardDeps.writeFormats` callback below; tests inject a
 * fake. The `writeBuffer` shape from the Phase 4 single-format
 * implementation is gone — callers always go through
 * `writeFormats`.
 *
 * **macOS / Linux** still throw with the same Windows-only error
 * — `NSPasteboard` and X11 selection wiring stay queued for a
 * follow-up. The native addon is Windows-x64-only by
 * construction (its source uses `windows::Win32::*`); the
 * `isSupported` gate keeps non-Windows hosts from reaching it.
 */

import { buildZipBytes } from "@ingcreators/annot-core/zip-bytes";
import { bgraToDib, CF_DIB } from "./dib.js";

// ---- Types matching the renderer-side IPC payload ──────────────

export interface MosaicMedia {
  filename: string;
  /** Raw image bytes (PNG / JPEG). The renderer JSON-serializes
   *  these as a number array; the IPC adapter converts to
   *  Uint8Array before invoking the handler. */
  bytes: Uint8Array;
}

export interface CopyAsOfficeInput {
  drawingXml: string;
  mosaicMedia: MosaicMedia[];
  /** Optional base64 data URL (e.g. `data:image/png;base64,...`)
   *  of the source screenshot that ships in the GVML envelope as
   *  the visible-fallback image. Word / PowerPoint show this when
   *  the `<a:graphicData>` payload isn't fully understood. */
  screenshotData?: string;
  /** Optional PNG data URL for the `CF_DIB` clipboard fallback
   *  (Paint, browsers, Sheets, …). When absent, only the GVML
   *  format is written and non-Office consumers see an empty
   *  paste. */
  pngDataUrl?: string;
}

export interface ClipboardHandlers {
  copyAsOffice(input: CopyAsOfficeInput): Promise<void>;
}

// ---- Multi-format clipboard write ──────────────────────────────

/** One format/payload pair fed to `writeFormats`. The format may
 *  be either:
 *
 *   - A `string` — the addon registers it via
 *     `RegisterClipboardFormatW` (custom Win32 format like
 *     `Art::GVML ClipFormat`).
 *   - A `number` — the addon uses it directly as a Win32 format
 *     id (standard formats like `CF_DIB = 8`).
 */
export interface ClipboardFormatWrite {
  format: string | number;
  data: Uint8Array;
}

// ---- Dependency injection seam ─────────────────────────────────

export interface ClipboardDeps {
  /** Atomically write every entry in `formats` to the system
   *  clipboard in one Win32 transaction
   *  (`OpenClipboard + EmptyClipboard + N×SetClipboardData +
   *  CloseClipboard`). The production wiring loads the in-tree
   *  `win-clipboard` napi addon; tests pass a fake that records
   *  the calls. */
  writeFormats(formats: ClipboardFormatWrite[]): void;
  /** Convert PNG bytes → JPEG bytes. Reuses the same
   *  `nativeImage.toJPEG(90)` callback the Phase 2 XMP handler is
   *  constructed with. The GVML envelope embeds the screenshot as
   *  JPEG (smaller than PNG) so Office's paste-fallback rendering
   *  doesn't bloat the clipboard payload. */
  pngToJpeg(png: Uint8Array): Promise<Uint8Array>;
  /** Decode PNG bytes → 4-channel BGRA pixel data + dimensions.
   *  The host wiring uses
   *  `nativeImage.createFromBuffer(png).toBitmap()` (BGRA layout
   *  on Windows / Linux). Used for the `CF_DIB` fallback — see
   *  `bgraToDib` in `./dib.ts` for the encoder. */
  pngToBgra(png: Uint8Array): { data: Uint8Array; width: number; height: number };
  /** Whether the host can actually write to the system
   *  clipboard. macOS / Linux return `false` until a follow-up
   *  wires up the matching native paths; the handler surfaces a
   *  clear "Windows-only" error in that case. */
  isSupported(): boolean;
}

export function createClipboardHandlers(deps: ClipboardDeps): ClipboardHandlers {
  return {
    async copyAsOffice(input) {
      if (!deps.isSupported()) {
        throw new Error(
          "Office clipboard paste is currently Windows-only on the Electron build. " +
            "macOS / Linux support is tracked as a follow-up.",
        );
      }

      // Optional source screenshot for the GVML envelope. The
      // Rust impl converted PNG → progressive JPEG before
      // embedding; the Electron port uses the host-supplied
      // `pngToJpeg` (which under `nativeImage.toJPEG` produces
      // baseline Q90 JPEG). Other formats are embedded as-is.
      let imageBytes: Uint8Array | undefined;
      if (input.screenshotData) {
        const raw = parseDataUrlBytes(input.screenshotData);
        if (!raw) {
          // Match the Rust impl's silent fallback: a malformed
          // data URL just means no embedded screenshot.
        } else if (input.screenshotData.includes("image/png")) {
          try {
            imageBytes = await deps.pngToJpeg(raw);
          } catch {
            // If conversion fails, fall back to embedding the
            // PNG directly. The content_types section adapts to
            // whichever extension is present (image1.jpeg).
            imageBytes = raw;
          }
        } else {
          imageBytes = raw;
        }
      }

      const gvmlBytes = buildGvmlZip(input.drawingXml, input.mosaicMedia, imageBytes);
      const formats: ClipboardFormatWrite[] = [{ format: GVML_FORMAT_NAME, data: gvmlBytes }];

      // Add CF_DIB so non-Office consumers (Paint, browsers,
      // Sheets, …) can paste a bitmap. The PNG passes through
      // the host's `pngToBgra` (Electron's `nativeImage.toBitmap`)
      // and the in-tree `bgraToDib` encoder. Errors here
      // degrade to GVML-only — Office paste still works, only
      // the bitmap fallback is missing.
      if (input.pngDataUrl) {
        const png = parseDataUrlBytes(input.pngDataUrl);
        if (png) {
          try {
            const { data, width, height } = deps.pngToBgra(png);
            const dib = bgraToDib(data, width, height);
            formats.push({ format: CF_DIB, data: dib });
          } catch {
            // PNG decode failure — fall back to GVML-only.
          }
        }
      }

      deps.writeFormats(formats);
    },
  };
}

// ---- GVML packaging ────────────────────────────────────────────

/** Custom Windows clipboard format name registered by Microsoft
 *  Office for native shape paste. The native addon registers it
 *  via `RegisterClipboardFormatW` on each
 *  `writeFormats({format: "Art::GVML ClipFormat", ...})` call —
 *  Win32 caches the registration per-session, so repeat calls are
 *  cheap. */
export const GVML_FORMAT_NAME = "Art::GVML ClipFormat";

/** Pack the pre-built drawing XML + mosaic media + optional
 *  background screenshot into the GVML OPC ZIP that the Office
 *  clipboard expects. Direct port of `build_gvml_zip` in the
 *  deleted `clipboard.rs`. The ZIP is a Stored-method package (no
 *  Deflate); Office accepts both. */
export function buildGvmlZip(
  drawingXml: string,
  mosaicMedia: MosaicMedia[],
  imageBytes?: Uint8Array,
): Uint8Array {
  const hasImage = imageBytes !== undefined;
  const hasAnyImage = hasImage || mosaicMedia.length > 0;

  const imgCt = hasAnyImage
    ? `<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/>`
    : "";
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imgCt}<Override PartName="/clipboard/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/clipboard/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="clipboard/drawings/drawing1.xml"/></Relationships>`;

  // rId numbering: rId1=theme, rId2=screenshot (when present),
  // rId3+ = mosaic media in declaration order. The TS-side
  // `buildDrawingXml` in `@ingcreators/annot-render` writes the
  // matching `<a:blip r:embed="rId{N}"/>` references that
  // depend on this exact numbering, so DO NOT reorder.
  const relsEntries: string[] = [
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>`,
  ];
  if (hasImage) {
    relsEntries.push(
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.jpeg"/>`,
    );
  }
  const mosaicRidStart = hasImage ? 3 : 2;
  for (let i = 0; i < mosaicMedia.length; i++) {
    const rid = mosaicRidStart + i;
    const m = mosaicMedia[i]!;
    relsEntries.push(
      `<Relationship Id="rId${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${m.filename}"/>`,
    );
  }
  const drawingRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsEntries.join("")}</Relationships>`;

  const enc = new TextEncoder();
  const entries: { name: string; data: Uint8Array }[] = [
    { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
    { name: "_rels/.rels", data: enc.encode(rootRels) },
    { name: "clipboard/drawings/drawing1.xml", data: enc.encode(drawingXml) },
    { name: "clipboard/drawings/_rels/drawing1.xml.rels", data: enc.encode(drawingRels) },
    { name: "clipboard/theme/theme1.xml", data: enc.encode(CLIPBOARD_THEME) },
  ];
  if (imageBytes) {
    entries.push({ name: "clipboard/media/image1.jpeg", data: imageBytes });
  }
  for (const m of mosaicMedia) {
    entries.push({ name: `clipboard/media/${m.filename}`, data: m.bytes });
  }

  return buildZipBytes(entries);
}

function parseDataUrlBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  try {
    return new Uint8Array(Buffer.from(dataUrl.slice(comma + 1), "base64"));
  } catch {
    return null;
  }
}

/** Verbatim copy of the OOXML clipboard theme from the Rust
 *  impl. Office requires a `theme1.xml` relationship target on
 *  the drawing's rels file — without it, the paste is rejected
 *  as malformed. The contents don't drive the rendered shapes
 *  (per-shape colours come from the drawing XML); this is just
 *  the OOXML scaffolding Office expects. */
const CLIPBOARD_THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:clipboardTheme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:clipboardTheme>`;

// ---- IPC channel inventory ──────────────────────────────────────

export const CLIPBOARD_CHANNELS = {
  copyAsOffice: "copy_as_office",
} as const;

export type ClipboardChannel = (typeof CLIPBOARD_CHANNELS)[keyof typeof CLIPBOARD_CHANNELS];

export const CLIPBOARD_CHANNEL_TO_HANDLER: Record<ClipboardChannel, keyof ClipboardHandlers> = {
  [CLIPBOARD_CHANNELS.copyAsOffice]: "copyAsOffice",
};
