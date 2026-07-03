---
"@ingcreators/annot-core": patch
---

**Publish the `./element-tree` subpath** — the published tarball now
serves `@ingcreators/annot-core/element-tree` (Tier A screen-capture
model + YAML / JSON serializers + walk/find utilities).

### Root cause

`@ingcreators/annot-playwright`'s built `dist/index.js` externalises
its `@ingcreators/annot-core/element-tree` import, but core's
`publishConfig.exports` only mapped `.`, `./xmp-bytes`, and
`./styles/*` — the subpath resolved in the workspace (dev `exports`
map to `src/`) and failed for every registry consumer:

```
Error: Package subpath './element-tree' is not defined by "exports"
in .../node_modules/@ingcreators/annot-core/package.json imported
from .../@ingcreators/annot-playwright/dist/index.js
```

First observed in the workflow-app docs tour after the 0.4.1
publish repaired the `writeFile` dist crash — `playwright test`
now dies at config load before any test runs.

### Fix

- `vite.config.ts` gains an `element-tree` library entry
  (`src/element-tree/index.ts` → `dist/element-tree.js`).
- `publishConfig.exports` maps `./element-tree` to the built JS +
  the emitted `dist/element-tree/index.d.ts`.

### Verification

- `pnpm --filter @ingcreators/annot-core build` emits
  `dist/element-tree.js` + `dist/element-tree/index.d.ts`.
- Packed tarball installed into a scratch project resolves
  `import("@ingcreators/annot-core/element-tree")` and exposes the
  full serializer / walk surface.
