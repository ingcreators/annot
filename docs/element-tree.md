# ElementTree — canonical screen-capture model

> Phase 1 of [`living-spec-authoring-roadmap.md`](./plans/living-spec-authoring-roadmap.md).
> Replaces the previously parallel extension flat-list and
> Playwright `ariaSnapshot` + sibling `annot:attributes` YAML paths.
> See AD-09 in the roadmap for the design rationale and OQ-10 /
> OQ-11 for the wire format + ref-stability decisions.

## Why this exists

Annot captures "what's on this page" from multiple sources — the
browser extension's MAIN-world DOM walker, Playwright's
`ariaSnapshot({ mode: "ai", boxes: true })`, and (in future) Figma
adapters, OCR-derived snapshots, etc. ElementTree is a single
canonical model every capture source produces and every downstream
consumer reads, so the editor's Elements panel, Astro Image Service,
drift detector, annotation `match` resolver, and MCP tools never
need to know which capture source produced the data they are
reading.

## Data shape

The TypeScript types live in
[`packages/core/src/element-tree/types.ts`](../packages/core/src/element-tree/types.ts).

```ts
interface ElementTree {
  version: 1;
  source: {
    kind: "extension" | "playwright" | (string & {});
    capturedAt: string;          // ISO 8601
    agent?: string;              // tool name + version
    url?: string;                // captured page URL
  };
  viewport: {
    width: number;               // CSS px
    height: number;
    scale: number;               // device pixel ratio
  };
  root: ElementNode;             // single root, always present
}

interface ElementNode {
  ref: string;                   // "e<n>" depth-first numbering
  role: string;                  // ARIA role; "generic" for decorative
  name?: string;                 // accessible name
  text?: string;                 // direct text content
  bbox?: { x; y; width; height }; // page-space CSS px
  states?: string[];             // "checked" / "level=2" / etc.
  attributes?: Record<string, string>; // whitelisted HTML attrs
  children?: ElementNode[];      // document order
}
```

Key shape decisions:

- **Tree, not flat list.** Matches the DOM mental model. Drift
  detector's subtree comparison + editor sidebar's nesting both
  benefit from the explicit hierarchy.
- **`ref` is required, `e<n>` format.** Stable within one capture
  (depth-first numbering); not stable across re-captures —
  cross-capture identity is the annotation layer's
  `match: { role, name }` job per OQ-11.
- **`states` is a string array** — cleanly diffable, easy to
  pattern-match. ARIA states like `"checked"`, `"required"`,
  `"disabled"`; scalar states as `"level=2"`, `"valuetext=10"`.
- **`attributes` lives inline on each node.** Eliminates the
  parallel `annot:attributes` YAML block. Each capture source
  applies its own whitelist (browser walker hard-codes one; the
  Playwright `attachAttributes` helper accepts one as an argument).

## On-disk encoding (PNG XMP iTXt chunk)

Per OQ-10, **YAML is the canonical wire format**. JSON is exported
by the serializer module (`serializeElementTreeToJson`) for callers
that prefer it (MCP tool payloads, AI agent prompts, in-memory
snapshotting), but PNG XMP storage uses YAML.

The payload is stored in a PNG iTXt chunk:

| Field | Value |
|---|---|
| Keyword | `annot:elementTree` (17 bytes, ASCII, null-terminated) |
| Null separator | 1 byte (`0x00`) |
| Compression flag | `0x01` (compressed) |
| Compression method | `0x00` (deflate — the only valid PNG iTXt method) |
| Language tag | empty (1 byte `0x00` null terminator) |
| Translated keyword | empty (1 byte `0x00` null terminator) |
| Text | deflate-compressed UTF-8 YAML |

The chunk identity (`annot:elementTree`) is distinct from the
editor's XMP chunk (`XML:com.adobe.xmp`) and from the embedded
original capture (custom `svGo` chunk), so all three coexist on
the same PNG without interference.

Compression is **mandatory** (flag `0x01`) for ElementTree. The
serialized YAML has high token repetition (role / name / bbox
keys); deflate compresses 50-pixel pages to ~1.5 KB and 1000-pixel
pages to ~8 KB. Uncompressed storage would frequently exceed 100 KB
per capture and bloat git history pointlessly.

## Reader behaviour

Implemented by `readElementTreePng` in
[`packages/core/src/xmp/element-tree-payload.ts`](../packages/core/src/xmp/element-tree-payload.ts):

1. PNG signature check → return `null` if not a PNG.
2. Walk chunk list; find iTXt with keyword `annot:elementTree` →
   return `null` if absent.
3. Inflate the compressed payload.
4. `parseElementTreeFromYaml` → strict structural validation.
5. Refuse unknown `version` (forward-compat error) — only
   `version: 1` is recognized today.

Callers that need a tolerant read should wrap in try / catch.

## Writer behaviour

`writeElementTreePng` (same module):

1. PNG signature check → throw if input isn't a PNG.
2. Serialize tree → `serializeElementTreeToYaml` (deterministic
   field + attribute key ordering, so re-saves produce
   byte-identical PNGs).
3. Deflate the UTF-8 bytes.
4. Build the iTXt chunk per the layout above.
5. Remove any prior `annot:elementTree` chunk (no accumulation).
6. Insert before IEND.

`hasElementTreePng` is a light-weight predicate that doesn't
deflate or parse — useful for callers that want to test for
presence without paying decompression cost.

## Producer / consumer matrix

| Producer | Module | Phase |
|---|---|---|
| Browser extension MAIN-world walker | `packages/capture/src/content/element-tree-walker.ts` | 1c |
| Playwright `ariaSnapshot` adapter | `packages/playwright/src/element-tree-adapter.ts` | 1b |
| Migration CLI (from legacy `annot:snapshot` MDX blocks) | `packages/product-docs/src/cli/migrate-to-element-tree.ts` | 1g (future) |

| Consumer | Module | Phase |
|---|---|---|
| Editor Elements panel | `packages/host-ui/src/right-panel-sections/annot-page-elements-section.ts` | 1f (future) |
| Astro Image Service overlay rendering | `packages/product-docs-astro/src/render.ts` | 1h (future) |
| Drift detector | `packages/product-docs/src/drift.ts` | 1i (future) |

## See also

- [`docs/plans/living-spec-authoring-roadmap.md`](./plans/living-spec-authoring-roadmap.md) — Phase 1 plan + AD-09 / OQ-10 / OQ-11
- [`packages/core/src/element-tree/`](../packages/core/src/element-tree/) — type definitions + YAML/JSON serializers + walk utilities
- [`packages/core/src/xmp/element-tree-payload.ts`](../packages/core/src/xmp/element-tree-payload.ts) — PNG XMP iTXt chunk read/write
