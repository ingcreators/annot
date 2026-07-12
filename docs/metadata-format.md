# Annot image metadata format

Canonical reference for the metadata Annot embeds in raster images
(PNG / JPEG). The governing invariant, established by
[`docs/plans/metadata-unification.md`](./plans/metadata-unification.md):
**the file tells the whole story** — every non-derivable
`ImageRecord` field is persisted in the image file itself. Caches
(`MetadataCache`, thumbnail cache) are derived and rebuildable;
they are never the only holder of a fact.

For the annotation SVG format itself see
[`svg-format.md`](./svg-format.md); for the ElementTree wire format
see [`element-tree.md`](./element-tree.md).

## Carriers

| Format | XMP packet | Original bitmap | ElementTree |
|---|---|---|---|
| PNG | `iTXt` chunk, keyword `XML:com.adobe.xmp` | custom `svGo` chunk | `iTXt` chunk, keyword `annot:elementTree` (deflate YAML) |
| JPEG | APP1 segment (`http://ns.adobe.com/xap/1.0/`) | APP2 segments, prefix `annot:OriginalImage\0` | — |

All carriers coexist with the image's normal pixel data — viewers
that don't know the custom chunks/segments display the rendered
(annotated) pixels verbatim.

## XMP packet fields

Namespace: `annot` → `https://ingcreators.com/annot/ns/1.0/`.
Written by `buildXmp` / `createEditablePngBytes` /
`createEditableImage`; read by `readEditableImage` into
`AnnotMetadata` (`@ingcreators/annot-core/xmp`).

| Element | Type | Since | Meaning |
|---|---|---|---|
| `annot:annotations` | CDATA SVG | 1.0 | Annotations-only SVG layer. Required — readers return `null` without it. |
| `annot:width` / `annot:height` | int | 1.0 | Image dimensions in device px. Lets the editor mount the canvas without decoding the bitmap. |
| `annot:version` | string | 1.0 | Schema version of the packet (see history below). Write-only until 2.0; now read back into `AnnotMetadata.version`. |
| `annot:tags` | XML-escaped JSON object | 1.0 | Opaque user / producer key-value pairs. Open-ended by design. |
| `annot:sourceUrl` | XML-escaped string | 2.0 | URL of the captured page. Empty / omitted for non-page sources (desktop screen capture, paste, upload). |
| `annot:createdAt` | ISO 8601 | 2.0 | Capture / import moment. NOT the file mtime — copies and syncs must not rewrite it. |
| `annot:producer` | string | 2.0 | What created the file: `extension` / `desktop` / `web` / `vscode` / `annotator` / `mcp` / `playwright` / … |
| `annot:dpr` | float | 2.0 | `devicePixelRatio` (or display scale) at capture time. Maps device-px image dimensions back to CSS px for sources without an ElementTree. |

Optional elements are omitted entirely when unset; readers default
missing fields to `""` / `0` (defensive-parser guardrail, CLAUDE.md
§1).

Escaping: `annot:annotations` is CDATA-wrapped. Every other
free-text element (including the tags JSON) is XML-escaped
(`& < >`) on write and unescaped on read.

## Precedence rules

- **Packet vs `MetadataCache`**: the packet wins. Stores read
  `sourceUrl` / `createdAt` from the packet and refresh the cache
  FROM it, never the reverse.
- **Packet vs `ElementTree.source`**: `ElementTree` keeps its own
  `source.url` / `source.capturedAt` because trees also travel
  standalone (aria-snapshot YAML, `.annotations.yaml` flows).
  Inside an image file both are written from the same value at
  capture time; if they ever disagree, the packet is authoritative
  for the image record.
- **`updatedAt`**: deliberately NOT in the packet — the filesystem
  mtime is its authority.

## Deliberately not in the file

`path` / `folderPath` (location, not content), `updatedAt` (mtime),
`thumbnailDataUrl` (derived), listing arrays / backend ids / sync
cursors (store bookkeeping, rebuildable by a walk).

## Version history

| Version | Change |
|---|---|
| 1.0 | Initial: `annotations` / `width` / `height` / `version` / `tags` + `svGo` original. |
| 2.0 | Added `sourceUrl` / `createdAt` / `producer` / `dpr`. Tags JSON and all free-text fields XML-escaped. `version` read back by parsers. Supersedes the `WELL_KNOWN_TAG_KEYS` smuggling convention for `source` / `capturedAt` (those keys stop being written by built-in producers; `screen` / `commit` remain tags). |

Readers stay tolerant of packets missing newer fields — a 1.0 file
parses fine with empty provenance. No migration shims exist:
per the 2026-07-12 sign-off, pre-2.0 files are simply upgraded the
next time they are saved.
