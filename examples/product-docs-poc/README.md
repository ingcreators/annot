# product-docs-poc

Phase 0 PoC for [`docs/plans/_done/living-product-docs.md`](../../docs/plans/_done/living-product-docs.md).
Disposable code exercising the end-to-end "living product docs"
pipeline against a tiny static HTML fixture, so the design can
be validated before Phase 1+ builds the real packages.

## What this PoC proves

The plan walks through Stages 1–6 of Phase 0. Stage 1 (MCP
`annot_aria_snapshot` tool) [landed in #869](https://github.com/ingcreators/annot/pull/869).
Stages 2–6 run end-to-end via this PoC:

| Stage | What it exercises |
|---|---|
| 2 | Hand-written `*.screen.mdx` with `<Screen>` / `<Overlay match>` / `<Transition>` JSX components — see [`fixture/login.screen.mdx`](./fixture/login.screen.mdx). |
| 3 | MDX AST extraction + match resolver against a live aria-snapshot. See [`src/parse-mdx.ts`](./src/parse-mdx.ts), [`src/resolve.ts`](./src/resolve.ts). |
| 4 | Annotated PNG generation via `@ingcreators/annot-annotator`. See [`src/render-png.ts`](./src/render-png.ts). |
| 5 | Two outputs from the same MDX — minimal HTML page + Excel workbook. See [`src/render-html.ts`](./src/render-html.ts), [`src/render-xlsx.ts`](./src/render-xlsx.ts). |
| 6 | Drift detection — deliberately break the MDX and observe the resolver error path. `npm run poc:drift`. |

## How to run

This is **not** a workspace package. The PoC lives outside
`pnpm-workspace.yaml` because it's intentionally disposable
and depends on the published `@ingcreators/annot-annotator`
from npm (not the workspace version).

```sh
cd examples/product-docs-poc/

# Install dependencies (PoC has its own lockfile).
npm install

# One-time: download the Chromium runtime Playwright drives.
npx playwright install chromium

# Run the happy-path PoC: takes a snapshot of the local HTML
# fixture, resolves overlays, renders three outputs into
# `output/`.
npm run poc

# Run the drift demo: mutates the MDX with a non-matching
# overlay key and shows the resolver error path. Exits with
# code 1 (simulating a CI failure).
npm run poc:drift
```

## Expected outputs

After `npm run poc`, the `output/` directory contains:

- `login.snapshot.yaml` — raw aria-snapshot from Playwright
- `login.shot.png` — raw screenshot of the fixture page
- `login.annotated.png` — screenshot with numbered callouts
  drawn by annot-annotator
- `login.html` — minimal HTML render of the MDX (proves the
  Astro adapter path is feasible)
- `login.xlsx` — minimal Excel workbook with cover sheet + per-
  screen item-spec sheet (proves the xlsx adapter path is
  feasible)

The PoC's HTML / Excel are deliberately minimal — production
versions (Phases 2 / 3) will be far more polished. The point
of the PoC is to prove **the data flow works** end-to-end, not
to ship the final visual style.

## Files

```
examples/product-docs-poc/
├── README.md
├── package.json
├── tsconfig.json
├── fixture/
│   ├── login.html               ← static target page (the "app")
│   └── login.screen.mdx         ← hand-written MDX (the docs)
├── src/
│   ├── run.ts                   ← orchestrator
│   ├── parse-mdx.ts             ← Stage 3a: MDX → AST
│   ├── resolve.ts               ← Stage 3b: match → ref → bbox
│   ├── render-png.ts            ← Stage 4: annot DSL → PNG
│   ├── render-html.ts           ← Stage 5a: MDX → HTML
│   └── render-xlsx.ts           ← Stage 5b: MDX → Excel
└── output/                      ← gitignored, generated artefacts
```

## Phase 0 exit criteria (from the plan)

After running the PoC, evaluate:

1. **MDX authoring ergonomic?** — Can you read
   `fixture/login.screen.mdx` and immediately see what's
   declared (id / title / overlays / transitions / meta) ?
2. **`<Overlay match>` keys concrete enough?** — The four
   overlays in the fixture pin to the four interactive
   elements via `role + name`. Does that feel like a
   sustainable authoring convention?
3. **Astro path visibly distinct from a hand-written
   GitBook page?** — Open `output/login.html` — the
   numbered annotated PNG + item-spec table + transition
   list is the rough shape Phase 2 (Astro adapter) will
   ship in production form. Does this read as docs?
4. **Excel path visibly distinct from manual templates?**
   — Open `output/login.xlsx` — cover + per-screen sheet
   with embedded image + item-spec table. Does this look
   like a usable screen-specifications starting point?
5. **Drift detection visible enough?** — Run
   `npm run poc:drift`. Does the resolver error path
   surface the mismatch clearly enough that a CI failure
   would be actionable?

If all five are yes, Phase 1 (`@ingcreators/annot-product-docs`)
is unblocked. If any are no, iterate on the plan before
implementation.

## Implementation notes vs production

The PoC takes shortcuts that the real packages won't:

- **Regex-based MDX parsing.** `parse-mdx.ts` doesn't use the
  full @mdx-js/mdx AST. Phase 1's `mdx.ts` will.
- **Minimal YAML.** `parse-mdx.ts` hand-rolls a 30-line YAML
  subset. Phase 1 uses a real YAML lib.
- **No template support.** Phase 3's xlsx adapter loads a
  user-supplied Excel template with named ranges; the PoC
  builds the workbook from scratch.
- **No `{var}` placeholder substitution.** Same — Phase 3.
- **Single-screen MDX only.** The PoC's fixture has one
  `<Screen>` block. Phase 1's resolver supports multi-screen
  MDXs.
- **No `<HistoryEntry>` / `<ScreenList>` components.** The
  PoC focuses on the `<Screen>` / `<Overlay>` / `<Transition>`
  trio. Phase 2 adds the rest.
- **CommonJS-incompatible.** Pure ESM. Production packages
  will support both formats per the existing annot-annotator
  precedent.
