# Local setup

## Requirements

- **Node 24** — pinned via `.nvmrc`. Use [nvm](https://github.com/nvm-sh/nvm)
  or [Volta](https://volta.sh/) to match.
- **pnpm 11** — the monorepo's package manager. Enable via
  Corepack: `corepack enable && corepack prepare pnpm@11`.

## Clone + install

```bash
git clone https://github.com/ingcreators/annot.git
cd annot
pnpm install
```

The install builds native deps (`better-sqlite3`, `sharp`,
`workerd`) via the `allowBuilds` allowlist in `pnpm-workspace.yaml`.
First install takes ~1 minute.

## Run the PWA

```bash
pnpm --filter @ingcreators/annot-web dev
```

Open <http://localhost:5173>. Vite watches the editor + every
core / editor / render / host-ui package — edits hot-reload
without restarting the dev server.

## Run the headless annotator

```bash
pnpm --filter @ingcreators/annot-annotator build
node packages/annotator/dist/index.js  # example wiring
```

The package is currently `private: true` in the workspace; the
published `0.1.0` on npm is the same source.

## Run tests

```bash
pnpm test                                                  # all
pnpm --filter @ingcreators/annot-core test                 # one package
pnpm --filter @ingcreators/annot-web test                  # the PWA
```

3260 tests in ~20s on a developer laptop. CI runs the same
command on every PR.

## Run Storybook

```bash
pnpm --filter @ingcreators/annot-web storybook
```

Opens at <http://localhost:6006>. Every built-in Lit component
has a story; CI fails the PR if a story stops building.

## Lint / typecheck

```bash
pnpm lint            # Biome — formatter + linter (CI-blocking)
pnpm lint:fix        # apply auto-fixes
pnpm -r typecheck    # tsc across every package
```

## Build everything

```bash
pnpm -r build
```

Builds run in dependency order via Turborepo. Cached builds are
near-instant; clean builds take ~30s.
