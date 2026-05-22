# @ingcreators/annot-extension

Chrome MV3 extension host for [Annot](../../README.md). Captures
screenshots from any page and hands them off to the PWA for
annotation.

What lives here:

- **Service worker** (`background/service-worker.ts`) — capture
  orchestrator, message router, IDB-backed storage of in-flight
  captures.
- **Content script** (`content/index.ts`) — area selection, scroll
  orchestration, sticky-element hiding for full-page captures, DOM
  metadata snapshots (interactive elements + their bboxes for the
  future Playwright locator bridge).
- **Offscreen document** (`offscreen/offscreen.ts`) — running the
  encode worker and offscreen-canvas operations (stitch, crop,
  mosaic) outside of the service worker's lifetime.
- **Popup** (`popup/popup.ts`), **options page**, and the
  in-content **capture progress toast**.
- **Manifests** under [`./manifests/`](./manifests/) — Chrome,
  Edge, etc.

The content script is wrapped in an IIFE at build time (see the
`iifeWrapContentScript` plugin in [`vite.config.ts`](./vite.config.ts))
so re-injection via `chrome.scripting.executeScript` doesn't throw
on top-level `let` / `const`. **Don't remove this wrapper.**

## Capture handoff

Captured images are saved to the extension's own IndexedDB by the
service worker, then transferred to the PWA via
`transferAllFromExtension` in [`@ingcreators/annot-web`](../web).
**Every field on `ImageRecord` must be carried through that
transfer call** — a missed field silently drops data on handoff.

## Scripts

```bash
pnpm --filter @ingcreators/annot-extension dev              # Vite watch build
pnpm --filter @ingcreators/annot-extension build            # production build (Chrome manifest)
pnpm --filter @ingcreators/annot-extension build:chrome     # explicit alias
pnpm --filter @ingcreators/annot-extension build:edge       # Edge manifest variant
pnpm --filter @ingcreators/annot-extension package:chrome   # build + zip into releases/
pnpm --filter @ingcreators/annot-extension package:edge     # same for Edge
pnpm --filter @ingcreators/annot-extension typecheck        # tsc --noEmit
pnpm --filter @ingcreators/annot-extension icons            # regenerate icons from brand SVG
```

After building, load `dist/` as an unpacked extension in
`chrome://extensions` (Developer mode → Load unpacked).

## Depends on

- [`@ingcreators/annot-core`](../core) — `ImageRecord`,
  `ElementTree`, encode helpers, capability predicates.

## See also

- [`CLAUDE.md`](../../CLAUDE.md) — capture-timing constants
  (`POST_HIDE_PAINT_MS`), visibility-detection rules, common
  pitfalls (content-script re-injection, IIFE wrapper).

## License

[Apache License, Version 2.0](../../LICENSE) © ingcreators.
