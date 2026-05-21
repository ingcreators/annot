# Plugin API: Documents

> **Audience:** plugin authors who want to extend the
> `.annot.html` document format with new block types (sequence
> diagrams, video embeds, dataset previews, …) or new doc-level
> metadata fields.
>
> **Status:** **Forward-looking — v1 doesn't ship a plugin
> registration surface yet.** This doc captures the design
> direction so the v1 file format + tooling stays compatible
> with the v2 plugin surface. If you're authoring documents
> with the built-in block taxonomy (heading / paragraph / list
> / code / quote / callout / divider / image), you don't need
> this doc.

## What v1 ships

The `.annot.html` document format and the editor surface ship in
v1 with a fixed block taxonomy. See:

- [`docs/annot-html-format.md`](../annot-html-format.md) —
  canonical format spec (block types, attribute vocabulary,
  metadata sidecar, template / numbering / cross-reference
  rules).
- [`docs/plans/_done/annot-html-document.md`](../plans/_done/annot-html-document.md) —
  the multi-image-document plan series (phases 0–13).
- [`docs/plugin-api/storage.md`](./storage.md) —
  `StorageWithDocuments` (the storage half of the format).

What's already pluggable in v1:

- **Storage backends** — implement `StorageWithDocuments` and
  any `.annot.html`-aware UI lights up automatically. See
  [`storage.md`](./storage.md).
- **Templates** — drop `.annot.html` files into the active
  store's `Templates/` folder; `<annot-template-picker>`
  picks them up via `listDocuments("Templates")` + the
  template marker discriminator (`<meta name="annot-template"
  content="1">`). No registration call needed.
- **Localised numbering / labels** — set
  `meta.numbering.figureLabel` to `"Abbildung "`, `"Figur "`,
  etc. `injectDocumentStyles` + `resolveFigureRefs` use the
  override transparently. See the format spec's
  [Cross-references](../annot-html-format.md#cross-references)
  + [Numbering](../annot-html-format.md#docmeta-numbering)
  sections.

## What v2 will ship — design direction

The shipping v1 format reserves the discriminator surface a v2
plugin registry needs. Plugin authors who care about future
compatibility can ship v1 documents that include unknown block
kinds today — they round-trip cleanly through the parser /
serializer / editor as opaque `UnknownBlock` records.

### Custom block types

The v1 parser already handles unknown block kinds via the
`UnknownBlock` passthrough:

```ts
export interface UnknownBlock {
  readonly kind: "unknown";
  readonly rawHtml: string;  // verbatim HTML, byte-preserved
}
```

Any element under `<article data-annot-doc>` carrying a
`data-annot-block="…"` attribute whose value isn't in the v1
enumeration drops into `UnknownBlock`. The serializer writes
the original bytes back out untouched. **This means v1
documents authored with v2-format unknown blocks survive
round-trip through every v1 tool.**

The v2 plugin registry will provide:

```ts
// Forward-looking — NOT YET SHIPPED.
export interface BlockKindRegistration {
  /** Discriminator — matches `data-annot-block="…"` on the
   *  element. Must NOT be one of the v1 reserved kinds. */
  readonly kind: string;
  /** Editor-mode renderer. Receives the parsed AST node and
   *  the editor's mutation handle (similar to v1's per-block
   *  contentEditable plumbing). */
  readonly renderEditor?: (node: PluginBlock, ctx: EditorContext) => Element;
  /** Standalone-view renderer. Receives the parsed AST node
   *  and returns plain HTML (no editor chrome). The v1
   *  parser preserves the rawHtml field for unknown kinds; v2
   *  plugins can opt to re-emit canonical bytes from the
   *  parsed AST instead. */
  readonly renderView?: (node: PluginBlock) => Element;
  /** Optional: extra OOXML emitter for the multi-slide PPTX
   *  export. v1's `exportDocumentPptx` skips non-image
   *  blocks; v2 plugins can emit shapes / pictures / text
   *  frames per their semantics. */
  readonly toPptxShape?: (node: PluginBlock, ctx: PptxContext) => string;
}

// Plugin-side registration during boot:
host.registerDocBlock({
  kind: "mermaid",
  renderEditor: (block, ctx) => ...,
  renderView: (block) => ...,
});
```

The exact shape of `PluginBlock` / `EditorContext` /
`PptxContext` is **not yet finalised**. We're collecting use
cases first; if you have one, file an issue describing the
custom block you want and we'll fold it into the v2 surface
design.

### Custom doc-level metadata

`DocMeta` is open-ended for v2: the parser preserves unknown
keys in the JSON sidecar verbatim under a typed
`extensions?: Record<string, unknown>` map (forward-looking —
v1 reserves the field but doesn't yet pass it through). v2
plugins will register a metadata key + JSON-schema validator
so the parser routes unknown keys to the right plugin
namespace.

```ts
// Forward-looking — NOT YET SHIPPED.
host.registerDocMeta({
  key: "myorg.brand-banner",
  schema: { /* JSON Schema fragment */ },
});
```

### Custom inline elements

Cross-references (`<span data-annot-figref="img-…">`) are
hardcoded in v1's `resolveFigureRefs`. The v2 plugin surface
will let plugins register additional `data-annot-…ref`
discriminators with a callback that receives the document
context and returns the replacement label.

## Migration path

For a v1-shipping plugin that authors documents with
forward-looking custom block kinds:

1. **Use a unique `data-annot-block` discriminator.** Pick a
   namespaced value (`acme.sequence-diagram`,
   `myorg.video-embed`) so it never collides with a future
   v1 / v2 reserved kind.
2. **Author the element body as ordinary HTML.** v1 stores it
   verbatim; v2 plugins can re-parse from the canonical
   bytes if they need richer in-memory representation.
3. **Don't ship a parallel parser.** The v1 `parseDocument`
   round-trips your unknown blocks faithfully; a parallel
   parser invites byte drift between your plugin and the
   editor's save pipeline.
4. **Read the format spec's
   [Forward compatibility](../annot-html-format.md#forward-compatibility)
   section** for the rules unknown kinds + unknown attribute
   names follow. The TL;DR: data attributes round-trip
   verbatim; element-tag swaps that don't carry
   `data-annot-block` are NOT preserved.

## Reference

- [`docs/annot-html-format.md`](../annot-html-format.md) —
  the v1 format spec. Authoritative for what's reserved + how
  unknown kinds round-trip.
- [`packages/doc/src/types.ts`](../../packages/doc/src/types.ts) —
  `Block` discriminated union. The `UnknownBlock` arm is the
  forward-compat hook for plugins shipping unknown kinds in
  v1 documents.
- [`packages/doc/src/parse.ts`](../../packages/doc/src/parse.ts) +
  [`packages/doc/src/serialize.ts`](../../packages/doc/src/serialize.ts) —
  parser / serializer. Read these to understand exactly what
  gets preserved verbatim for unknown content.
- [`docs/plans/_done/annot-html-document.md`](../plans/_done/annot-html-document.md) —
  master plan series. Phase 13c (this doc) closes the v1
  shipping milestone; the plugin registration surface is
  out of scope until v2.
