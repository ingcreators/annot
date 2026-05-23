# `@ingcreators/annot-embed-protocol`

Tier A protocol definitions shared between docs sites (the
OSS-side host that renders `<AnnotEditButton>`) and the
annot-cloud editor (the iframe / new-tab client).

Phase 5 of
[`docs/plans/living-spec-authoring-roadmap.md`](../../docs/plans/living-spec-authoring-roadmap.md).
Sub-phase 5a ships event types + protocol version constant;
sub-phase 5b layers the URL-callback codec; sub-phase 5c
layers the postMessage dispatcher.

## What's here today (5a + 5b + 5c)

- `EmbedMode` — `"newTab" | "inline" | "disabled"`
- `EmbedEvent` — discriminated union of every event that flows
  on either transport (`EditorReady` / `EditRequested` /
  `EditCommitted` / `EditAbandoned` / `ResizeNeeded`)
- `EMBED_PROTOCOL_VERSION` — wire-format version literal (`1`)
- `EMBED_EVENT_TYPES` — runtime list of event-type literals
  (kept in sync with the union via a `satisfies` clause)
- `isEmbedEvent(value)` — type-guarded narrowing helper for
  the postMessage boundary
- `encodeEmbedRequestUrl(params)` — builds the cloud-editor URL
  for `<AnnotEditButton>`'s `newTab` mode (5b)
- `parseEmbedReturnHash(hash)` — decodes the return-URL hash
  fragment back into a typed `EmbedReturnSignal` (5b)
- `encodeEmbedReturnHash(signal)` — inverse of `parseEmbedReturnHash`;
  the annot-cloud `/embed` route uses this to build the
  redirect target (5b)
- `createEmbedHostMessenger({ frame, expectedOrigin, onEvent })`
  — docs-site side of the `inline` mode postMessage transport
  (5c)
- `createEmbedClientMessenger({ parentOrigin, onEvent })` —
  editor side of the `inline` mode postMessage transport;
  ships in this package so annot-cloud's `/embed` route just
  imports it (5c)

## What's coming next

- 5d — `<AnnotEditButton>` Astro component (newTab + disabled)
- 5e — `<AnnotEditorIframeModal>` Astro component (inline)

## Why this lives in `embed-protocol/` (not in `core/`)

The protocol bytes are the seam between OSS code (this repo)
and annot-cloud code (private `ingcreators/annot-cloud` repo).
A standalone package lets annot-cloud `import` the protocol via
npm without depending on `@ingcreators/annot-core`'s broader
surface (which carries editor / storage / XMP types that an
`/embed` route doesn't need).
