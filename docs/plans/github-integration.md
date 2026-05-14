# GitHub Integration (v1, individual-user)

> **Status:** Phases 1–3 landed; Phase 4 polish in progress
> (file-details drawer, amend commits, reconfigure menu,
> rate-limit banner all shipped; Git Data API bulk ops still
> pending). Individual-user storage + personal-access-token
> auth is the scope. Team / PR-automation features are
> *deliberately* out of scope here — they live in the
> commercial `annot-cloud` per
> [`oss-cloud-split.md`](./oss-cloud-split.md).
>
> **Compatibility:** New storage backend in `packages/web` (+ a
> thin auth helper). Zero changes to `@ingcreators/annot-core`'s
> public types; this is purely another `StorageProvider`
> implementation.
>
> **Risk:** External API surface, rate limits on free-tier
> accounts, PAT creation friction (user has to visit GitHub's
> token page). Bounded by reusing the same plug-in shape
> `GoogleDriveStore` already proved out.

## Context

`PRODUCT_DIRECTION.md` names GitHub as the collaboration hub.
Annot already has most of the plumbing it needs to treat a
GitHub repository as another storage backend:

- `StorageProvider` is backend-neutral (see
  [`path-based-storage.md`](./path-based-storage.md)).
- Per-mode `/edit/img/<store>/<path>` routing (see
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

### 1. Auth: personal access token (paste)

The OSS side authenticates by **user-pasted personal access
token**, not OAuth. This is a reluctant-but-correct choice:

**Device Flow — tried and abandoned.** Initial implementation
attempted OAuth Device Flow because it avoids the
`redirect_uri` problem Web Flow has. Runtime testing confirmed
that GitHub's `github.com/login/device/code` and
`github.com/login/oauth/access_token` endpoints don't advertise
CORS headers for browser origins (standing issue since 2013;
see `isaacs/github#330`). A browser `fetch` to either endpoint
fails with a network TypeError — there is no way to complete
either Device Flow or Web Flow from a static SPA.

**Backend proxy — option declined for OSS.** This is how draw.io
solves the same problem: they run a server-side endpoint that
performs the code ↔ token exchange on behalf of the browser
(`GitHubClient.js` → `redirectUri = DRAWIO_SERVER_URL + 'github2'`;
see `jgraph/drawio`). Adopting that pattern would:

- Require a Cloudflare Worker script (we currently ship only
  static assets; see `wrangler.jsonc`).
- Force every self-hoster of `@ingcreators/annot-web` to stand
  up an equivalent proxy — breaking the "single PWA, no
  backend" property of the OSS build.
- Not even improve the scope story — an OAuth App's `repo`
  scope grants access to *all* the user's repos, wider than
  what fine-grained PATs give us (below).

The proper one-click OAuth experience lands on the commercial
`annot-cloud` side, where we're running a backend anyway. See
`oss-cloud-split.md` for the split.

**Fine-grained PAT — what we actually use.** GitHub's
fine-grained personal access tokens (GA since March 2025)
scope a token to specific repositories with specific
permissions. For Annot the correct grant is:

- Repository access: *Only select repositories* → the one the
  user picks.
- Repository permissions: **Contents: Read and write**.
- Implicit: Metadata: Read-only.

This is **strictly narrower than `repo` scope** — the token
can't touch any other repo, can't read org membership, can't
act on issues / PRs / workflows. Matches the spirit of the
Drive `drive.file` scope: the user hands Annot exactly what
it needs, nothing more.

Classic PATs with the `repo` scope still work as a fallback
for users on orgs that require them.

Token storage: `localStorage["annot-github-token"]` (opaque
string, no expiry tracking beyond "revoked / expired → 401 on
next call").

Auth module `packages/web/src/storage/github-auth.ts` exports:

```ts
export async function signInWithPat(pat: string): Promise<string>;
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

### 7. Large files and repo bloat

GitHub Contents API caps at ~1 MB text / ~100 MB binary.
Typical Annot captures stay <2 MB, but scroll-captures can
exceed. The immediate plan (v1):

- Single request with base64-encoded content via Contents API
  (works up to ~40 MB effective after base64 overhead on
  GitHub's accepted request body).
- If the blob exceeds the Contents API limit, fall back to the
  Git Data API: `POST git/blobs` → `POST git/trees` →
  `POST git/commits` → `PATCH git/refs/heads/{branch}`. The
  amend path (see §amend) already uses these endpoints; the
  large-file path is the same pipeline without the amend
  heuristic.

**LFS is *not* supported in OSS.** If a user commits into an
LFS-enabled repo, the file uploads as a regular blob (losing
the LFS benefit but not breaking). OSS's stance on binary bloat
is "commit directly, keep your repo small, or move to Annot
Cloud if you outgrow this" — committing binaries to git is
structurally hostile to long-term repo health regardless of
Annot's debounce / amend tricks:

- Every save is a fresh blob (git doesn't delta binaries).
- Even with amend collapsing a session to one commit, N
  sessions produce N blobs.
- Clone / fetch cost grows monotonically.

The proper answer for heavy use is the pointer-commit model in
`annot-cloud`: commit only a small JSON pointer to git, keep
the image bytes in annot.work's object store. See
[`oss-cloud-split.md#cloud-storage-model`](./oss-cloud-split.md#cloud-storage-model)
for the design. LFS compatibility in Cloud is a bundled
feature for users with existing LFS infrastructure, not the
marquee solution.

OSS users who need git-native storage for team-sized workloads
should:

- Use a **dedicated screenshot repo** (not mixed with source),
- Keep a `screenshots/` subfolder (not repo root),
- Periodically archive / prune old sessions.

The OSS connect flow will surface these recommendations in the
picker help text at Phase 1 docs polish time.

### 8. URLs

Route: `/edit/img/github/<path>?extId=…&session=…`, parallel to
the existing `/edit/img/<store>/<path>` entries. `<path>` is the
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

With fine-grained PATs (§1), GitHub's permissions model is
actually **closer to Drive `drive.file` than OAuth is**: the
user picks the exact repository the token can touch, at PAT
creation time, from GitHub's own UI. Annot receives a token
that is mechanically incapable of reading any other repo.

For users that still prefer a classic `repo`-scoped PAT (or
whose org policy requires it), the repo picker clearly shows
what the app will touch ("Annot will read and commit to:
`owner/repo` on branch `main`") and stores only that picked
repo — it never probes other repos in the user's account. The
network-level scope is broad in that case, but the app-level
behaviour stays narrow and transparent.

## Phased plan

### Phase 1 — auth + repo picker

- `packages/web/src/storage/github-auth.ts` with the exports
  listed in §1. PAT paste + validation via `GET /user`. No
  OAuth code path — Device Flow / Web Flow are ruled out by
  browser CORS on GitHub's OAuth endpoints (§1 rationale).
- `packages/web/src/storage/github-setup-ui.ts` with the
  paired UI: PAT paste dialog (with fine-grained PAT guidance
  and a link to the token creation page), repo picker with
  local filter + `/search/repositories` fallback + manual
  `owner/repo` entry, branch picker (default preselected),
  base-path prompt with live preview.
- `saveRepoRef` / `loadRepoRef` persistence via
  `localStorage["annot-github-ref"]`.
- `?github-setup=1` URL flag in `main.ts` as a temporary
  verification entry point; the code splits into its own
  chunk so the main bundle is unchanged when unused. Phase 3
  replaces this with a sidebar item.

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

## Related work

- **draw.io / diagrams.net** — the closest precedent. Uses
  OAuth Web Flow via a server-side endpoint
  (`DRAWIO_SERVER_URL + 'github2'`) that handles the code →
  token exchange for the browser. Self-hosters run the
  companion `draw-server` to get the same UX. We deliberately
  don't adopt this pattern in OSS because it breaks the "static
  PWA, no backend" property; the equivalent UX will live in
  `annot-cloud` via a GitHub App.
- **GitHub CLI (`gh`)** — uses Device Flow. Works for CLI
  because it's not in a browser (no CORS). Sets the user-
  facing precedent for "enter this code on the web" but
  doesn't translate to browser apps.
- **VS Code GitHub extension** — uses OAuth Web Flow through
  its own backend at `vscode.dev`. Same server-side-proxy
  structure as draw.io. For users without internet access to
  Microsoft's backend, falls back to PAT paste.

## Relationship to other plans

- [`path-based-storage.md`](./path-based-storage.md) — provides
  the `StorageProvider` interface this plan implements against.
  No type changes needed.
- [`google-drive-integration.md`](./google-drive-integration.md)
  — pattern source for reselect flow and store caching. Read
  before starting Phase 2 so the same shape carries over; the
  auth module's shape diverges (PAT vs OAuth token client) but
  the surface around it is the same.
- [`oss-cloud-split.md`](./oss-cloud-split.md) — establishes
  why PR automation lives in `annot-cloud`, not here. Also
  where the proper one-click OAuth UX lands (via a GitHub
  App), since `annot-cloud` runs a backend anyway. The
  individual-user `GitHubStore` shipped by this plan is a
  natural OSS citizen.

## Open questions

- [ ] Branch picking UX: just a text input, or pre-fetch the
      list of branches? Likely pre-fetch up to 100 branches and
      fall back to text input for mono-repos with thousands.
      (Phase 1 implements pre-fetch; text fallback is a Phase 4
      polish item.)
- [ ] `.gitkeep` vs empty-tree commit for `createFolder`.
      `.gitkeep` is the convention; weighs ~0 bytes; no
      objection expected.
- [ ] Should the repo picker filter to repos the user has
      write access to? Yes — fine-grained PATs typically scope
      to one repo anyway, but classic PATs and future GitHub
      App installs need the filter. Phase 1 implements
      `permissions.push: true`.

### Resolved

- ~~OAuth App vs GitHub App for even the OSS side?~~ Neither.
  OAuth Web Flow / Device Flow both require a backend to
  complete the token exchange (GitHub's
  `github.com/login/oauth/*` endpoints don't send CORS headers
  for browser origins; confirmed against the Phase 1
  implementation attempt). Running a backend would break the
  OSS "static PWA, no server" property. PAT paste is the OSS
  auth path; GitHub App lives in `annot-cloud`.
