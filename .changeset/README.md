# Changesets

This repo uses [Changesets](https://github.com/changesets/changesets)
to manage versioning + changelogs for the **three publishable npm
packages**:

- `@ingcreators/annot-core`
- `@ingcreators/annot-annotator`
- `@ingcreators/annot-playwright`

Every other workspace package (`annot-web`, `annot-extension`,
`annot-desktop`, `annot-vscode`, `annot-worker`, `annot-host-ui`,
`annot-editor`, `annot-render`, `annot-doc`, `annot-capture`,
`annot-cloud-store`, `annot-imagequant`) is either an end-user
app (hosts) or an internal library that doesn't ship to npm —
those are listed under `ignore` in `config.json` and Changesets
silently skips them.

## When you need a changeset

PRs that touch one of the three publishable packages above
need a changeset entry so the next publish picks them up. PRs
that only touch the ignored packages (host apps, internal
libraries, docs, tooling) **don't** need a changeset.

If you're not sure, run `pnpm changeset` and pick the affected
packages from the interactive list — if the list is empty, you
don't need one.

## How to add a changeset

```sh
pnpm changeset
```

Walk through the prompts:

1. **Pick affected packages.** Pre-publish (before the first npm
   release), every change to one of the three publishable
   packages is a `patch` (no risk of breaking external consumers
   because there aren't any yet). Post-publish, choose
   `patch` / `minor` / `major` per semver.
2. **Write a one-line description.** What changed, observable
   from a consumer's perspective. Internal refactors with no
   API change can be a single-line "internal refactor — no
   behaviour change".

This creates a markdown file under `.changeset/`. Commit it
along with your code change; review picks it up alongside the
diff.

## Maintainer workflow (releases)

```sh
# Roll up pending changesets into version bumps +
# per-package CHANGELOG.md entries:
pnpm changeset version

# Commit the result (version bumps + CHANGELOGs)
git add . && git commit -m "chore: release X"

# Publish the bumped packages to npm:
pnpm changeset publish
```

The CI publish workflow at `.github/workflows/publish.yml`
(lands in Stage 3 of `docs/plans/headless-annotator-publish.md`)
runs `pnpm changeset publish` on `workflow_dispatch`.

## Why `updateInternalDependencies: patch`

A patch bump to `@ingcreators/annot-core` triggers matching
patch bumps on packages that depend on it
(`@ingcreators/annot-annotator` via `workspace:*`). This keeps
the dependency graph internally consistent — a consumer
installing `annot-annotator` always gets a compatible
`annot-core` version.

## Why `access: restricted`

Defence-in-depth — even if `private: false` lands by mistake on
a package that shouldn't publish, the org-level default
prevents an accidental public publish. Each publishable package
will be explicitly flipped to `access: public` (in its own
`publishConfig`) when Stage 2 of
`docs/plans/headless-annotator-publish.md` lands.
