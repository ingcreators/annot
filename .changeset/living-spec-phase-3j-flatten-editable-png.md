---
"@ingcreators/annot-annotator": minor
"@ingcreators/annot-core": minor
---

**Add `flattenEditablePng(pngBytes) → pngBytes`** — Phase 3j of
`docs/plans/living-spec-authoring-roadmap.md` (Phase 3
follow-up #2). The editor's editable-PNG format embeds the
original un-annotated capture + the annotations SVG in PNG
ancillary chunks for re-edit; "flatten" drops those chunks and
keeps just the visible (already-annotated) bytes.

### `@ingcreators/annot-annotator` — new public surface

```ts
import { flattenEditablePng } from "@ingcreators/annot-annotator";

const flat = flattenEditablePng(editablePngBytes);
// → flat PNG: same visible pixels, no Adobe XMP iTXt chunk,
//   no custom svGo chunk. `readEditablePngBytes(flat)` returns
//   null. File size drops significantly (the editable layer
//   roughly doubled the bytes).
```

### `@ingcreators/annot-core/xmp-bytes` — new public surface

The implementation lives in `@ingcreators/annot-core` as
`stripPngEditableLayer` — the same chunk-walking helper that
`writePngWithMetadata` / `writePngWithTagsOnly` already used
internally to clean stale metadata before re-injecting. Now
exported so other Tier A consumers (not just annotator) can
use it directly.

annotator's `flattenEditablePng` is a one-line wrapper that
calls `stripPngEditableLayer` under a more user-facing name.

### Why this is metadata removal, not re-rasterization

`toEditablePng` rasterizes the SVG fragment onto the base image
FIRST and embeds the editable layer as ancillary PNG chunks
(`iTXt` carrying Adobe XMP + custom `svGo` chunk). The visible
bytes are already the annotated bitmap. Flattening strips the
ancillary chunks; the IDAT pixel data stays byte-identical.
No decode, no re-encode, no `@napi-rs/canvas` round-trip.

### Use cases

- **Publish-flat** — editor session → distribution-ready PNG;
  the editable layer is dead weight for downstream consumers
  (Slack drop, third-party viewers).
- **File size** — editable PNG roughly doubles in bytes
  (original + SVG embedded); flattening drops the overhead.
- **Privacy hardening** — `burnRedactions` is the strong
  version for *redact* regions; flattening drops the
  recoverable original entirely for *all* annotations,
  including non-redact ones whose annotated visual the
  publisher wants to keep but whose original capture they
  don't want shippable.

### Internal rename in annot-core

The private `removePngMetadata` helper in
`@ingcreators/annot-core/xmp-bytes` is renamed to
`stripPngEditableLayer` (clearer name describing what it does
rather than how it's used). Internal callers in the same
module updated. No external API change for the rename itself;
`writePngWithMetadata` + `writePngWithTagsOnly` keep their
existing signatures + behaviour.

### Compatibility

Additive on annotator + core. No behaviour change for existing
callers (the only internal rename is a private helper).
