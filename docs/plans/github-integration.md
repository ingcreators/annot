# GitHub Integration (v1, individual-user)

> **Status:** Draft. Ready for review; individual-user storage +
> device-flow auth is the scope. Team / PR-automation features
> are *deliberately* out of scope here — they live in the
> commercial `annot-cloud` per
> [`oss-cloud-split.md`](./oss-cloud-split.md).
>
> **Compatibility:** New storage backend in `packages/web` (+ a
> thin auth helper). Zero changes to `@ingcreators/annot-core`'s
> public types; this is purely another `StorageProvider`
> implementation.
>
> **Risk:** External API surface, rate limits on free-tier
> accounts, OAuth device flow's extra interaction step. Bounded
> by reusing the same plug-in shape `GoogleDriveStore` already
> proved out.

## Context

`PRODUCT_DIRECTION.md` names GitHub as the collaboration hub.
Annot already has most of the plumbing it needs to treat a
GitHub repository as another storage backend:

- `StorageProvider` is backend-neutral (see
  [`path-based-storage.md`](./path-based-storage.md)).
- Per-mode `/edit/<store>/<path>` routing (see
  [`url-schemes.md`](../url-schemes.md)).
- Per-operation 401 recovery and token refresh flows already
  exist for Drive and generalize cleanly.

The OSS half of the GitHub story is an **individual-user
`GitHubStore`**: pick a repo + base path, save / edit / list
annotated screenshots as commits against it. That's what this
plan covers.

The commercial half — automatic PR comments, Check Run
reporting, organization-scoped install, webhook handlers — is
explicitly deferred to `ingcreators/annot-cloud`. Keeping the
OSS side purely file-shaped means self-hosters don't need a
GitHub App, just a personal access grant.

## Design

### 1. Auth: OAuth Device Flow

Why device flow:

- Annot is a PWA with no server-side callback URL to register.
  OAuth Web flow needs a `redirect_uri`; device flow doesn't.
- GitHub CLI uses device flow — users recognize the
  "enter this code on github.com/login/device" pattern.
- Token exchange only needs `client_id`; no client secret to
  embed in the bundle. Exactly the same safety property as the
  Google Drive inline `VITE_GOOGLE_CLIENT_ID`.
- The token is a user access token scoped by the OAuth App,
  which the user can revoke from their GitHub settings page.

Scope: **`repo`** (covers both public and private repos). We
ask once; users who want to restrict can create a repo-scoped
personal access token and paste it instead (supported as a
manual fallback).

Token storage: `localStorage["annot-github-token"]` (same shape
as the Drive persistence — opaque string, no expiry tracking
beyond "revoked → 401 on next call").

Auth flow implementation lives in
`packages/web/src/storage/github-auth.ts`, exporting:

```ts
export async function signIn(): Promise<string>;          // device flow
export function getAccessToken(): string | null;
export function isSignedIn(): boolean;
export function signOut(): void;

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  branch: string;
  basePath: string;   // "" = repo root, "screenshots" = under that folder
}

export function saveRepoRef(ref: GitHubRepoRef): void;
export function loadRepoRef(): GitHubRepoRef | null;
export function clearRepoRef(): void;
```

Mirrors the Drive auth module structure intentionally.

### 2. Storage shape

The user picks a **repo + branch + base path** once (Drive's
"pick a folder" analogue). Everything Annot writes goes under
that base path on the configured branch:

```
owner/repo
  └─ <basePath>/
     ├─ annot-1776925852538.annot.png
     ├─ screenshots/
     │  └─ mobile/
     │     └─ annot-1776928881201.annot.png
     └─ team-kickoff/
        └─ slide-01.annot.svg
```

`path-based-storage.md`'s contract maps 1:1: `ImageRecord.path`
becomes the repo-relative path appended to `basePath`.

### 3. Commits

- **One commit per save.** Every `saveImage` / `updateImage` /
  `deleteImage` / `renameImage` produces a commit directly
  against the configured branch via the Contents API.
- **Commit message:** `annot: add|update|delete <filename>`
  (verb matches the operation). Short, predictable,
  `git log --oneline` stays readable.
- **Committer identity:** the authenticated user (from `/user`
  endpoint at connect time). Annot doesn't forge authorship.
- **Branch:** whatever the user picked at connect time.
  Defaults to the repo's default branch. Branch switching is a
  follow-up, not v1.
- **No batching.** A heavily-edited session produces many small
  commits; that's the user's choice when they picked GitHub as
  the backend. A future "squash on session end" option could
  live in the commercial side if demand appears.

### 4. `StorageProvider` mapping

| Method | Implementation |
|--------|----------------|
| `saveImage` | `PUT /repos/{owner}/{repo}/contents/{path}` with `branch`, `content` (base64), `message`. Returns SHA. |
| `updateImage` | Same endpoint with `sha` (from cache) for optimistic concurrency. |
| `deleteImage` | `DELETE /repos/{owner}/{repo}/contents/{path}` with `sha`, `message`. |
| `getImage` | `GET /repos/{owner}/{repo}/contents/{path}` → base64 body → decode XMP. |
| `listImages` | `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` → filter to image files under folderPath. |
| `createFolder` | Git has no real folders; commit a `.gitkeep` at `folderPath/.gitkeep` to materialize. |
| `deleteFolder` | Recursive delete via Git Data API (tree rewrite) for performance; fall back to per-file deletes if the tree is tiny. |
| `renameImage` / `moveFolder` | No rename endpoint; read-delete-create pattern in a single commit via Git Data API. |
| `getBreadcrumb` | Derived from path; no network call. |
| `generateThumbnail` | Same as other backends (client-side downscale). |
| `resync` | Clear path↔sha cache; next `listImages` repopulates. |

The SHA cache matters: GitHub's Contents API requires the
current blob SHA on update/delete for conflict detection, and
re-listing the tree for every write would burn rate limit fast.
Mirror `GoogleDriveStore`'s `#recordCache` pattern — seed on
save/get, invalidate on move/delete, rebuild on `resync`.

### 5. Conflict handling

- Concurrent edit by another client: `PUT` with stale SHA →
  409. Surface as the same "Session expired"-style banner but
  with a **Refresh** action that reloads the current file from
  the tree. v1 is last-write-wins; real merge flow is a future
  plan.
- Repo deleted / renamed: `GET` → 404 on any operation →
  existing error bar surfaces the failure. User re-picks via
  the sidebar's "Change repo" affordance.

### 6. Rate limits

Authenticated REST API: 5,000 requests/hour. A heavy editing
session under the 1,500 ms Drive-style debounce puts us well
under that ceiling for one user. No server-side proxy needed.
If rate-limit headers (`X-RateLimit-Remaining`) drop below 100
we show an info banner ("GitHub rate limit near — pause
editing for a few minutes"), not a hard block.

### 7. Large files

GitHub Contents API caps at ~1 MB text / ~100 MB binary.
Typical Annot captures stay <2 MB, but scroll-captures can
exceed. Plan for v1:

- Single request with base64-encoded content via Contents API
  (works up to ~40 MB effective after base64 overhead on
  GitHub's accepted request body).
- If the blob exceeds the Contents API limit, fall back to the
  Git Data API: `POST git/blobs` → `POST git/trees` →
  `POST git/commits` → `PATCH git/refs/heads/{branch}`.
- LFS is *not* supported in v1. If a user commits into an
  LFS-enabled repo, the file uploads as a regular blob; a
  future plan can add proper LFS handshaking.

### 8. URLs

Route: `/edit/github/<path>?extId=…&session=…`, parallel to
the existing `/edit/<store>/<path>` entries. `<path>` is the
repo-relative path relative to the picked base path — same
semantics as Drive's root-relative path.

**No Drive-UI-Integration equivalent.** GitHub doesn't have a
native "Open with" menu. Two options for entry-from-GitHub
later, both deferred:

- A browser extension / bookmarklet that rewrites a GitHub
  file URL (`github.com/owner/repo/blob/branch/path`) into
  `annot.work/edit/github/path?owner=…&repo=…`.
- A cloud-side GitHub App that posts a link on PRs.

Both are explicitly commercial-side / follow-up work.

### 9. UI changes

- `Sidebar`: add a **GitHub** storage item below Google Drive,
  symmetric shape — icon (`hub` Material symbol), label,
  connected status, "Change repo" reselect icon.
- `#currentRootName()` in `app.ts` returns `owner/repo` when
  mode is `github`.
- New mode constant: `StorageMode` grows a `"github"` value
  (same rename convention as
  [`local → browser`](https://github.com/ingcreators/annot/pull/30)).
- Sidebar FOLDERS tree renders the repo root as `owner/repo`
  with `basePath` as the subtitle when set, following the
  Device / Drive pattern.

### 10. `drive.file` analogue — permission shape

GitHub's permissions model is coarser than Drive's: the OAuth
token either has `repo` scope (all private repos) or
`public_repo` (public only). There's no per-repo consent like
Drive UI Integration gives us.

Mitigation: make the repo picker clearly show what the app
will touch ("Annot will read and commit to: `owner/repo` on
branch `main`"), and store only the picked repo — never probe
other repos in the user's account. The network-level scope is
broad but the app-level behaviour is narrow and transparent.

## Phased plan

### Phase 1 — auth + repo picker

- `packages/web/src/storage/github-auth.ts` with the exports
  listed in §1.
- Minimal device-flow UI: dialog with the user code + the
  github.com/login/device URL and a "Waiting for
  authorization..." state.
- Repo picker: search / filter over `GET /user/repos`, pick
  one, pick a branch (default branch preselected), pick a base
  path (empty = repo root).
- `saveRepoRef` / `loadRepoRef` persistence.

No storage calls yet; this phase proves out the auth shape.

### Phase 2 — `GitHubStore` implementation

- `packages/web/src/storage/github-store.ts` implementing
  `StorageProvider` per §4.
- SHA cache, error mapping, optimistic concurrency.
- Wire into `packages/web/src/storage/bridge.ts` alongside the
  existing Drive / Device / Browser stores.

### Phase 3 — UI integration

- Sidebar GitHub item + reselect icon.
- `StorageMode` gains `"github"`.
- Route registration so `/edit/github/<path>` works.
- `#currentRootName()` branch.
- Reselect flow mirrored from Drive.

### Phase 4 — UX polish (optional, size by demand)

- Show commit author + timestamp in the file-details drawer.
- "View on GitHub" link from the drawer.
- Branch switcher inside the storage panel.
- "Pull" button to refresh the tree manually after external
  commits.
- Rate-limit advisory banner.

### Phase 5+ — commercial, `annot-cloud`

Deliberately outside this plan. Tracked in
[`oss-cloud-split.md`](./oss-cloud-split.md) Phase 3+.
Examples (non-exhaustive): GitHub App install, PR-comment
automation, Check Run reporting, org-scoped config, webhook
subscribers, access-control UI.

## Migration notes

None — new storage backend, no existing data to migrate. Users
choose GitHub from the sidebar like any other storage.

## Relationship to other plans

- [`path-based-storage.md`](./path-based-storage.md) — provides
  the `StorageProvider` interface this plan implements against.
  No type changes needed.
- [`google-drive-integration.md`](./google-drive-integration.md)
  — pattern source for auth module, reselect flow, store
  caching. Read before starting Phase 2 so the same shape
  carries over.
- [`oss-cloud-split.md`](./oss-cloud-split.md) — establishes
  why PR automation lives in `annot-cloud`, not here. The
  individual-user `GitHubStore` shipped by this plan is a
  natural OSS citizen.

## Open questions

- [ ] OAuth App vs GitHub App for even the OSS side? OAuth App
      (device flow) is simpler and works without server
      infrastructure, which is why v1 picks it. GitHub App has
      higher rate limits and fine-grained installation — worth
      reconsidering if the OSS single-user story starts bumping
      rate limits in practice.
- [ ] Branch picking UX: just a text input, or pre-fetch the
      list of branches? Likely pre-fetch up to 100 branches and
      fall back to text input for mono-repos with thousands.
- [ ] `.gitkeep` vs empty-tree commit for `createFolder`.
      `.gitkeep` is the convention; weighs ~0 bytes; no
      objection expected.
- [ ] Should the repo picker filter to repos the user has
      write access to? `repo` scope token grants access to all
      their repos, but showing orgs they're read-only on is
      confusing. Filter via `permissions.push: true` on the
      repo list response.
