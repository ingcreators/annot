/**
 * Office-clipboard IPC — Phase 4 of
 * `docs/plans/desktop-electron-migration.md`.
 *
 * Direct port of the GVML packaging from
 * `packages/desktop/src-tauri/src/commands/clipboard.rs`. One
 * channel:
 *
 *   - `copy_as_office(drawing_xml, mosaic_media, screenshot, png)`
 *     → builds the GVML OPC ZIP envelope (content_types + rels +
 *       theme + drawing + media) and writes it to the system
 *       clipboard under the `Art::GVML ClipFormat` custom format
 *       that Word / PowerPoint / Excel recognise as native shape
 *       paste.
 *
 * **Architectural deviation from the plan.** The migration doc
 * specifies a `napi-rs` Rust addon that does the Win32 clipboard
 * write. The plan's reasoning ("Win32 COM patterns the GVML
 * write needs") doesn't actually apply — the write is just
 * `RegisterClipboardFormat` + `OpenClipboard` + `EmptyClipboard`
 * + `GlobalAlloc` + `SetClipboardData` + `CloseClipboard`. None of
 * those are COM. Electron's `clipboard.writeBuffer(format, buf)`
 * invokes the exact same Win32 sequence internally, so this port
 * uses the built-in API. Net effect:
 *
 *   - No new native artefact to compile, prebuild, sign, or
 *     publish to a per-OS subpackage.
 *   - No `electron-rebuild` step in `pnpm install`.
 *   - No supply-chain audit cost on a binary; the only signed
 *     artefact remains Electron itself.
 *   - Cross-platform foundation: the same API maps to
 *     `NSPasteboard` on macOS and X11 selections on Linux. The
 *     Phase 4 implementation is Windows-functional today; macOS
 *     wiring is a small follow-up that doesn't change this file.
 *
 * **Phase 4 known issue: no CF_DIB fallback.** The Rust impl
 * also writes `CF_DIB` so non-Office consumers (Paint, browsers,
 * Google Sheets) get a paste-as-image fallback. Electron's
 * `clipboard.writeBuffer` runs an internal
 * `OpenClipboard + EmptyClipboard + SetClipboardData +
 * CloseClipboard` sequence per call, so back-to-back calls
 * **don't** accumulate formats — the second call wipes the
 * first. Phase 4 ships GVML only; CF_DIB ships in a follow-up
 * that adds atomic multi-format clipboard write (either via a
 * small native addon scoped just to that, or whenever Electron
 * adds custom-format support to `clipboard.write({...})`).
 */

import { buildZipBytes } from "@ingcreators/annot-core/zip-bytes";

// ---- Types matching the Rust IPC channel ───────────────────────

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
  /** Optional PNG data URL for the `CF_DIB` clipboard fallback.
   *  Phase 4 ignores this — see file-level "Phase 4 known issue". */
  pngDataUrl?: string;
}

export interface ClipboardHandlers {
  copyAsOffice(input: CopyAsOfficeInput): Promise<void>;
}

// ---- Dependency injection seam ─────────────────────────────────

export interface ClipboardDeps {
  /** Write `data` under `format` to the system clipboard. The
   *  production wiring calls Electron's
   *  `clipboard.writeBuffer(format, buffer)`; tests pass a fake
   *  that records the calls. */
  writeBuffer(format: string, data: Uint8Array): void;
  /** Convert PNG bytes → JPEG bytes. Reuses the same `nativeImage.toJPEG(90)`
   *  callback the Phase 2 XMP handler is constructed with. The
   *  GVML envelope embeds the screenshot as JPEG (smaller than
   *  PNG) so Office's paste-fallback rendering doesn't bloat the
   *  clipboard payload. */
  pngToJpeg(png: Uint8Array): Promise<Uint8Array>;
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
            "macOS / Linux support is tracked as a Phase 4 follow-up.",
        );
      }

      // Optional source screenshot. The Rust impl converts PNG
      // → progressive JPEG before embedding. The Electron port
      // uses the host-supplied `pngToJpeg` (which under
      // `nativeImage.toJPEG` produces baseline Q90 JPEG). Other
      // formats are embedded as-is.
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

      const zipBytes = buildGvmlZip(input.drawingXml, input.mosaicMedia, imageBytes);
      deps.writeBuffer(GVML_FORMAT_NAME, zipBytes);
    },
  };
}

// ---- GVML packaging ────────────────────────────────────────────

/** Custom Windows clipboard format name registered by Microsoft
 *  Office for native shape paste. Tauri's Rust impl registers it
 *  via `RegisterClipboardFormatW`; Electron's `writeBuffer` does
 *  the same internally via Chromium's clipboard glue. */
export const GVML_FORMAT_NAME = "Art::GVML ClipFormat";

/** Pack the pre-built drawing XML + mosaic media + optional
 *  background screenshot into the GVML OPC ZIP that the Office
 *  clipboard expects. Direct port of `build_gvml_zip` in
 *  `clipboard.rs`. The ZIP is a Stored-method package (no
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
