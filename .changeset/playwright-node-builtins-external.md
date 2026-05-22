---
"@ingcreators/annot-playwright": patch
---

**Fix `writeFile is not a function` crash on `page.screenshot({ annot:
{ path } })`** — adds `/^node:/` to the Vite library build's
`rollupOptions.external` so Node builtins (`node:fs/promises`, …)
stay as native ESM imports in `dist/index.js` instead of being
inlined under Vite's browser-compat externalisation.

### Root cause

`screenshot-patch.ts` imports `writeFile` from `node:fs/promises`
and calls it when `path` is set on the screenshot opts. Vite's
default behaviour for Node builtins in a library build is to
externalise them with a browser-compat shim that destructures
incorrectly at the consumer side — the destructured name resolves
to `undefined` and the runtime call throws:

```
TypeError: (0 , d.writeFile) is not a function
  at _Page.N (.../node_modules/@ingcreators/annot-playwright/dist/index.js:156:36)
```

The local build emitted a `Module 'node:fs/promises' has been
externalized for browser compatibility` warning — same root cause.

### Fix

`packages/playwright/vite.config.ts` now mirrors the pattern used
by `@ingcreators/annot-product-docs`, `-product-docs-astro`,
`-product-docs-xlsx`, and `-mcp`: `/^node:/` in `external` keeps
Node builtins as `import { writeFile } from "node:fs/promises"`
in the output bundle, which Node resolves natively at runtime.

### Affected consumers

Every consumer of `@ingcreators/annot-playwright@0.4.0` that passes
`path` on `page.screenshot({ annot: { … } })` /
`locator.screenshot({ annot: { … } })`. The workflow-app docs-tour
CI workflow (`.github/workflows/docs-tour.yml` in the `annot` repo,
plus the dogfooded `examples/workflow-app/` tour) is the first
known case in the wild.

### Verification

- `pnpm --filter @ingcreators/annot-playwright build` succeeds
  without the `externalized for browser compatibility` warning.
- `dist/index.js` line 4 reads
  `import { writeFile as d } from "node:fs/promises";` (literal
  native import — no compat shim).
- `pnpm --filter @ingcreators/annot-playwright typecheck` passes.
