# OSS + Commercial Cloud Split

> **Status:** Draft. Strategic plan — no code change required
> today. Triggers embedded below (first paid feature, company
> incorporation, etc.) will drive individual sub-phases.
>
> **Compatibility:** Affects repo structure and packaging; the
> existing `packages/*` layout is a superset of what the OSS repo
> will ship.
>
> **Risk:** Low while the project stays in the OSS repo. The real
> risk is *drift* — if commercial-only concerns leak into `core`
> or `web` before the split, the split later becomes painful.
> The architectural guardrails below are the guardrails against
> that drift.

## Context

`PRODUCT_DIRECTION.md` commits to two growth vectors:

1. Playwright / headless automation.
2. GitHub as the collaboration hub.

Vector 1 is inherently OSS-shaped (a library anyone can call from
their CI). Vector 2 sits on top of it and is the obvious revenue
surface: team features, hosted annot.work, GitHub Enterprise
integration, SSO, admin controls, billing.

Pure GitHub Sponsors income for a niche end-user tool like Annot
is realistically minimal. Revenue needs a dedicated commercial
surface. We want that surface to:

- Not bleed into the OSS code path, so self-hosters get a clean
  MIT tool and Annot stays adoptable.
- Not require a parallel web / editor / storage reimplementation —
  duplicating `packages/web` would double maintenance for no
  product gain.
- Keep the existing monorepo ergonomics while commercial work
  lives in a separate private repo.

The OSS + "cloud is an extension, not a replacement" model
(Sentry, Strapi, Plausible) fits these constraints.

## Target shape

```
github.com/ingcreators/annot            public, OSS, MIT
└─ packages/
   ├─ core              — SVG core + headless subset
   ├─ web               — PWA host, plugin-extensible
   ├─ extension         — Chrome MV3
   ├─ desktop           — Tauri
   ├─ annotator         — headless / Playwright entry
   └─ storage-github    — OSS GitHub Store (individual use)

github.com/ingcreators/annot-cloud      private, proprietary
└─ packages/
   ├─ cloud-web         — thin extender over annot's packages/web
   ├─ server            — SaaS backend (annot.work team features)
   ├─ billing           — Stripe / subscription state
   ├─ admin             — org / user admin UI
   └─ github-enterprise — paid PR annotation, Check Run, SSO plugs
```

`annot-cloud` pulls `annot` in as an external dependency — either
via the public npm registry (once core packages are published) or
via a pinned git ref during earlier iterations. No OSS code path
imports anything from `annot-cloud`.

## Cloud storage model

Binary-heavy workloads like Annot (annotated screenshot PNGs,
200 KB–2 MB each, multiple edits per image) hit a specific pain
with git-native backends: every save is a fresh blob, tree
compression does nothing for binary deltas, and even the
amend-based single-commit-per-session strategy (see
`github-integration.md#amend`) still accumulates in repo size
over weeks of heavy use. The OSS `GitHubStore` accepts this
trade-off because the cost buys "no server required"; Cloud's
job is to offer a differentiated path for users who outgrow it.

### Architecture: pointer commits, images on annot.work

Cloud's storage model splits the artifact:

- **Image bytes** — authoritative storage on annot.work's object
  store (S3 / R2 via Cloudflare Workers). Access via short-lived
  signed URLs tied to the user's workspace session.
- **Git trace** — only a thin JSON pointer file
  (e.g. `annot-XXX.annot.pointer.json`, a few KB) hits the user's
  GitHub repo. Carries: remote object id, dimensions, rendered
  thumbnail URL, annotation metadata, last-edit timestamp, and
  a sha256 of the rendered bytes for integrity.

The editor loads the pointer → fetches bytes from annot.work →
edits → saves bytes back to annot.work and commits the updated
pointer JSON to GitHub. Git history stays lean (text-diff
friendly JSON); image artifacts live where they belong, in an
object store built for them.

This is *not* Git LFS:

| | LFS | Annot pointer |
|---|---|---|
| Storage billed by | GitHub (1 GB free, then $5 / 50 GB pack) | Annot subscription (bundled) |
| Git diff | Opaque oid change | Readable JSON change |
| Offline browsing | Fetches blob on checkout | Pointer readable; bytes on-demand |
| User setup | `.gitattributes`, LFS enable, quota mgmt | None — transparent |
| Works with other clients | Standard LFS | Annot-proprietary |

### LFS as compatibility bundle, not the marquee

A minority of users (typically orgs with existing LFS
infrastructure and strong "everything in git" policies) will
prefer LFS over the pointer model. Cloud can ship LFS protocol
support as a bundled compatibility feature:

- Detect an LFS-enabled repo (`.gitattributes` + `lfs` filter) at
  connect time.
- Upload blobs via the LFS batch API instead of Contents API.
- Commit LFS pointer files (`version https://git-lfs.github.com/spec/v1` +
  `oid sha256:…`) instead of the blob inline.

Positioning: *"We also work with your existing LFS setup,"* not
"LFS is the Cloud value prop." The marquee is the pointer-commit-
and-hosted-storage model that keeps git clean **without** users
paying GitHub's LFS bill.

### OSS stays git-native

The OSS `GitHubStore` keeps committing directly. It's fine for:

- Small dedicated asset repos (README images, docs illustrations)
- ~tens of screenshots per repo
- Individual devs who want everything in one place and don't mind
  modest repo size creep

The OSS README / connect dialog points heavy users to annot-cloud
when they outgrow it — similar to how Sentry's OSS "hobby"
deployment recommends the SaaS for larger footprints.

### Pricing alignment

Tentative Cloud Pro bundle:

- Hosted annot.work storage ← **marquee**
- Team workspaces (shared captures, ACL)
- PR automation / Check Run reporting
- LFS compatibility ← **bundled**, not standalone
- Activity feed / revision browser

Single-line marketing claim: *"Edit annotated screenshots
anywhere, without bloating your git repo."* The LFS users are
a small subset who get it as a bonus.

### Compatibility between tiers

Users should be able to move between OSS and Cloud without
losing data:

- **OSS → Cloud**: migration tool converts direct commits into
  pointer + object-store uploads. OSS history is preserved;
  new edits switch to pointer mode.
- **Cloud → OSS**: export tool materializes each pointer back
  into a direct commit. Users lose access to annot.work storage
  but keep every byte in their repo.

Both migrations land in `annot-cloud` (not OSS) because they
depend on the pointer-format spec that's a Cloud-side contract.

## Architectural guardrails (apply from today)

These are the rules that keep the future split cheap. They don't
require immediate restructuring; they're a "don't make this
worse" list.

### G1. Plugin seams in `packages/web`

The editor / gallery UI needs extension points the cloud side can
register against without patching OSS code. The minimum set:

- **Routes** — additional top-level routes (e.g. `/billing`,
  `/admin`, `/team/<id>`).
- **Sidebar sections** — extra items beyond STORAGE / FOLDERS.
- **Toolbar buttons** — commercial-only actions in the editor.
- **Storage providers** — currently already pluggable via
  `StorageProvider`; keep this interface stable.
- **Auth providers** — commercial SSO plugs in here.

Draft `AnnotPlugin` interface (not implemented today; sketch for
when the first paid feature lands):

```ts
export interface AnnotPlugin {
  name: string;
  routes?: RouteDefinition[];
  toolbarButtons?: ToolbarButtonDef[];
  sidebarSections?: SidebarSectionDef[];
  storageProviders?: StorageProviderFactory[];
  authProviders?: AuthProviderFactory[];
  init?(app: AnnotApp): void | Promise<void>;
}

export function registerPlugin(plugin: AnnotPlugin): void;
```

`packages/web/src/main.ts` (OSS build) registers no plugins.
`packages/cloud-web/src/main.ts` registers the commercial plugins
and re-uses `packages/web`'s `bootApp()`.

### G2. No conditional compilation in OSS for commercial features

No `if (process.env.ANNOT_EDITION === "ee")` branches. No
`if (hasLicense)` gates. Commercial behaviour lives in
`annot-cloud`, never in `annot`. This is the rule that keeps
MIT licensing of the OSS repo honest.

### G3. `StorageProvider` stays backend-neutral

Already the case today (see `path-based-storage.md`). Continue
making new storage features additive optional methods on the
interface so commercial storage backends can sit alongside OSS
ones without special casing.

### G4. Auth is a boundary

Today Drive OAuth lives in `packages/web/src/storage/google-auth.ts`
because it's the only auth flow. When commercial SSO arrives,
extract an `AuthProvider` abstraction in `packages/web` so Drive
auth and SSO are peers, not base-class and plugin. Deferred
until we have the second auth provider.

### G5. No commercial-concept leakage into `core` types

`PageMetadata`, `ImageRecord`, `StorageProvider` stay domain-
focused (what's on the canvas, what's on disk). Team ACLs,
workspace IDs, quota information, billing tier — none of those
belong in `core`. If they're needed at the editor level they go
through optional fields on a commercial-only sub-type in
`annot-cloud`.

### G6. URL schemes stay documented in the OSS repo

`docs/url-schemes.md` is the single source of truth for the URL
contract. Commercial routes live in that document too (marked
"cloud only") so OSS users can't accidentally re-use the
namespace. Prevents URL collisions across editions.

## Phases

### Phase 0 — today

- Keep shipping features to OSS packages in `annot`.
- Follow the guardrails above in every PR.
- **No plugin API yet** — premature abstraction. Document the
  intent here so it's not lost.

### Phase 1 — prepare for OSS publish

Trigger: deciding to make `ingcreators/annot` public.

- Add root `LICENSE` file (MIT).
- Switch each `package.json` `license` field from (implicit) to
  `MIT`.
- Flip the GitHub repo visibility from private to public.
- Update `README.md` to welcome contributions (drop the
  "Unpublished" notice).
- Consider npm publication of `@ingcreators/annot-core` once the
  API has stabilized enough for external consumers.

### Phase 2 — plugin API

Trigger: the first commercial feature concretely requires
extending the web shell (new route, new sidebar entry, etc.).

- Add `packages/web/src/plugins/{types,registry}.ts` with the
  draft interface from §G1.
- Refactor one existing feature (suggested: the built-in storage
  switcher) to go through the plugin registry so the seam is
  proven against real code, not hypothetical commercial code.
- Export `registerPlugin` / `bootApp` from
  `@ingcreators/annot-web` so a downstream package can extend.

### Phase 3 — `annot-cloud` repo creation

Trigger: company incorporation (pre-requisite for Workspace
Marketplace listing per `google-drive-integration.md` Phase 4).

- Create `github.com/ingcreators/annot-cloud` under the
  `ingcreators` org (Team plan already accommodates this).
- Seed with `packages/cloud-web`, `packages/server`,
  `packages/billing`, `packages/admin`, scaffolded to build but
  empty.
- `annot-cloud/package.json` depends on `@ingcreators/annot-*`
  via a pinned version.
- Mirror the same CI / branch protection / workflow conventions
  from `ingcreators/annot` — consistency cuts cognitive load.

### Phase 4 — annot.work served from `cloud-web`

Trigger: first commercial feature needs to ship to users.

- Point the Cloudflare `annot` Worker deploy at `annot-cloud` as
  the source of truth instead of `annot`.
- Self-hosters keep building from `annot/packages/web` unchanged.
- Document the build equivalence in `annot-cloud`'s README so
  ops confusion doesn't strand users.

### Phase 5 — `annot-ee` (far future, optional)

Trigger: genuine enterprise customers need SSO, audit logs,
compliance, regional data residency.

- Separate private repo from `annot-cloud` so compliance-scoped
  code has its own reviewer / release cadence.
- Loaded into annot.work deploy for customers on the
  enterprise plan; regular SaaS users unaffected.

## License direction

| Repo | License | Why |
|------|---------|-----|
| `ingcreators/annot` | **Apache-2.0** (at Phase 1) | Adoption-friendly + corporate-ready. Same permissive shape as MIT for OSS contributors / Playwright users / integrators, **plus an explicit patent-grant clause** the legal review at adopting companies looks for. Apache-2.0 lands on every enterprise approved-license list; MIT sits on the case-by-case tier at many shops. The `NOTICE` file requirement is trivial (one line of copyright). Choice locked in via `docs/plans/source-audit-cleanup.md` (Decision #1). |
| `ingcreators/annot-cloud` | Proprietary, not distributed | Runs only on annot.work; users interact with the hosted service, not the code. |
| `ingcreators/annot-ee` | Proprietary, distributed to paying customers | Separate commercial license agreement. |

Alternative licensing if hosted-competitor risk becomes
meaningful: switch OSS repo to **AGPL-3.0**. Forces hosted
competitors to open-source their fork. Adoption cost is real
(many companies disallow AGPL). Keep Apache-2.0 until there's
evidence the risk is live — for an "open-core + hosted cloud"
model where ~80% of the actual product value lives in the
private `annot-cloud` repo, the architecture itself is the
moat and hosted-clone risk is structurally low.

## Relationship to other plans

- **`path-based-storage.md`** — already shaped around a neutral
  `StorageProvider`; commercial storage backends (team-shared,
  org-scoped) plug in here.
- **`google-drive-integration.md`** — the `drive.file` model
  stays OSS. A potential "GitHub Drive UI-style integration" for
  team workspaces is cloud territory.
- **Future headless annotator** — unambiguously OSS; it's a dev
  library and locking it up would kill the adoption vector.
- **Future GitHub integration** — individual / read-only GitHub
  Store goes in OSS; paid team features (auto-post to PRs,
  Check Run reporting, org-scoped configuration) sit in
  `annot-cloud`. The Cloud storage model (see above) replaces
  "commit binary screenshots directly to git" with
  "commit pointers, keep bytes on annot.work" — this is what
  makes heavy-use commit history sustainable.

## What to avoid doing in the meantime

- Don't wire billing or team-account concerns into
  `packages/core` or `packages/web` before the plugin API
  exists — those features live in cloud-side packages.
- Don't introduce environment-variable flags that turn on
  commercial behaviour inside the OSS web build. Commercial
  behaviour arrives through a plugin, not a flag.
- Don't publish `@ingcreators/annot-*` to npm until the
  packages are actually ready for external consumers — an
  unstable public API is worse than no public API.
- Don't rename `packages/web` to imply a specific edition
  (`packages/web-community`, etc.). It's the PWA; the edition
  is a build-time combination, not a package name.

## Open questions

- [ ] When does the OSS repo go public? Tentative: after the
      handoff route is running end-to-end on annot.work and
      PR #18's Drive UI Integration is live in Testing mode.
- [ ] npm publication vs git-ref dependency for `annot-cloud`?
      Git ref is lighter to start; npm is cleaner once the API
      stabilises.
- [ ] Should the OSS repo carry a `SECURITY.md` / `CODE_OF_CONDUCT.md`
      before going public? Standard practice for OSS; add in
      Phase 1.
