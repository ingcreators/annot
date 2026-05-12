# `@ingcreators/annot-doc`

Tier A package implementing the `.annot.html` document format —
parser, serializer, document model, and structural-clone helpers.
DOM-free at module load (parser uses `globalThis.DOMParser` lazily
so consumers can opt into a Node-side polyfill / test environment).

See [`docs/annot-html-format.md`](../../docs/annot-html-format.md)
for the canonical format reference and
[`docs/plans/_done/annot-html-document.md`](../../docs/plans/_done/annot-html-document.md)
for the multi-phase plan this package belongs to.

## Public API (Phase 1)

```ts
import {
  parseDocument,
  serializeDocument,
  createEmptyDocument,
  ANNOT_DOC_VERSION,
} from "@ingcreators/annot-doc";

const doc = parseDocument(htmlBytes);          // throws on malformed input
const html = serializeDocument(doc);            // canonical bytes
const empty = createEmptyDocument({ title: "Untitled" });
```

`parseDocument` accepts an optional `{ DOMParser }` constructor for
Node-side use (test environments via happy-dom; future Playwright
integration via linkedom). The default reads `globalThis.DOMParser`.

## Tier A guarantees

- **No DOM at module load.** Importing this package in pure Node
  doesn't reach for `document` / `window`. Enforced by
  `headless.test.ts`.
- **Round-trip byte equivalence** for canonical input. Fixtures live
  in [`docs/annot-html-format-examples/`](../../docs/annot-html-format-examples/);
  `round-trip.test.ts` asserts `serialize(parse(bytes)) === bytes`
  for all three.
