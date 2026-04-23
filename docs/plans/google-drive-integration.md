# Google Drive Integration (v1)

> **Status:** Draft. Ready for review; no implementation work yet.
>
> **Compatibility:** `packages/web` only —
> [`src/storage/google-auth.ts`](../../packages/web/src/storage/google-auth.ts)
> and [`src/storage/google-drive-store.ts`](../../packages/web/src/storage/google-drive-store.ts)
> plus Google Cloud Console + Workspace Marketplace configuration.
>
> **Risk:** Bounded code change (scope + one extra flow), but the
> Workspace Marketplace submission is a multi-week external review
> process and gates public launch. Existing Drive users built against
> the current `drive` scope will have to re-authorize — acceptable
> since the project is pre-GA.

## Context

The current implementation in
[`google-auth.ts`](../../packages/web/src/storage/google-auth.ts:17)
requests `https://www.googleapis.com/auth/drive` — the full read/write
scope over a user's entire Drive. This scope is classified by Google
as **restricted**, which means publishing the app requires:

1. OAuth verification (multi-week review), and
2. A third-party security assessment against the CASA (Cloud
   Application Security Assessment) framework — a paid audit that
   takes months and is impractical for a solo-maintained project.

Keeping the app in **Testing mode** sidesteps both but caps usage at
100 test users. That's fine for dogfooding but blocks public launch.

Annot's strategic position (per
[`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md)) is:

- **Individual storage** → Google Drive, among other backends.
- **Team collaboration** → GitHub (`GitHubStore`, future).

So the Drive backend only needs to handle a single user's own
annotation workspace. That use case fits entirely within Google's
**non-sensitive** `drive.file` scope — the same scope draw.io /
diagrams.net uses — provided the UX is built around:

- A user-picked **root folder** (granted to the app via the Picker
  API), and
- Drive-UI-initiated file opens (granted via Drive UI Integration).

This plan refactors the Drive backend to fit that model so Annot can
ship publicly without a restricted-scope audit.

## Design

### 1. Scope narrowing: `drive` → `drive.file`

Replace the `SCOPES` constant in
[`google-auth.ts`](../../packages/web/src/storage/google-auth.ts:17):

```ts
const SCOPES = "https://www.googleapis.com/auth/drive.file";
```

`drive.file` grants access only to:

- Files the app creates, and
- Files or folders the user explicitly grants via Google Picker or
  via Drive UI Integration handoff.

It is **not** a sensitive scope — verification is light, no CASA.

### 2. Root folder model

The existing store already operates inside a single root folder
(`google-drive-store.ts` takes `rootFolderId` in the constructor).
The piece that's missing is a first-run UX that gets that folder ID
under `drive.file`:

1. User signs in via GIS — no folders accessible yet.
2. App shows "Pick the folder Annot should use" and opens Picker
   with **folder-select mode**.
3. User picks (or creates) a folder. Because the user selected it
   via Picker, the app has `drive.file` access to that folder.
4. App stores the folder ID (+ its display name) in `localStorage`
   as the Drive backend's root.
5. All subsequent `listImages` / `saveImage` / `createFolder` /
   etc. operate within that root — exactly what the current store
   already does.

Behavioural guarantee: files **pre-existing** in the picked folder
(e.g. put there via Drive UI before Annot was connected) are **not**
visible to Annot. Only files Annot itself creates after the pick
become visible. This is by design — it's the trade-off that keeps
us out of restricted-scope territory.

If the user wants to open an existing `.svg` / `.anno.png` that
Annot didn't create, they do so via Drive UI Integration (§3), not
via the gallery.

### 3. Drive UI Integration ("Open with Annot")

Register Annot as a Drive-native handler for the annotation file
types so users can right-click a file in Drive and choose
"Open with Annot":

- `image/svg+xml` — Annot-authored SVGs (identified by `data-annot-version`)
- `image/png` / `image/jpeg` — only when accompanied by our XMP metadata
  (`.anno.png` / `.anno.jpg` naming convention)

Registration steps live in Google Cloud Console → Drive UI
Integration (a sub-page of OAuth consent screen configuration):

- **Open URL:** `https://annot.work/handoff/googledrive?state={driveState}`
- **New URL:** the same URL — Google passes `state.action = "create"`
  for the New flow, so one handler covers both.
- **Supported MIME types:** the list above
- **Default MIME types:** none (we don't want to claim image/* by
  default — that would clutter every image file's context menu)

The `state` query param that Drive passes is a JSON blob:

```json
{ "action": "open"|"create", "ids": ["..."], "folderId": "...", "userId": "..." }
```

Annot parses it, and:

- `action === "open"`: calls `files.get(ids[0])` under `drive.file`
  (permitted because Drive UI initiated the open), resolves the
  file's parents chain back to the user's Annot root, registers the
  file in the internal `pathToFileId` cache, then navigates to
  `/edit/googledrive/<resolved-path>`.
- `action === "create"`: reserved for a follow-up — Annot needs a
  base image to meaningfully "create" an annotation file, so this
  flow will plug in once the broader capture-from-Drive story is
  designed.

Routing namespace: a dedicated `/handoff/<source>` tree, kept
separate from `/edit/<store>/<path>`. Two reasons:

1. "handoff" is not a valid filename to reserve inside `/edit/...`
   — any file literally named `handoff` would otherwise collide
   with the route matcher.
2. Other future sources (OneDrive, GitHub) will land under the
   same shape — `/handoff/onedrive`, `/handoff/github` — so the
   namespace is worth a top-level slot.

Document the route in [`docs/url-schemes.md`](../url-schemes.md)
once implemented.

### 4. Workspace Marketplace listing

Drive UI Integration is only exposed to end users once the app is
listed on the Google Workspace Marketplace. Separately, Marketplace
listing also makes it trivial for Workspace admins to enable Annot
for an entire organization.

Listing requirements (summary — see Google's
[publishing guide](https://developers.google.com/workspace/marketplace/how-to-publish)):

- Verified OAuth consent screen (light verification, not CASA)
- Privacy policy URL (public, stable)
- Terms of service URL
- Branding assets (icon, banner, screenshots, short + long
  descriptions)
- Support email and deletion / data-removal contact
- Domain verification for `annot.work` in Search Console
- Testing in an unlisted state before public publish

The submission itself is free. Review typically takes 1–3 weeks;
requested changes (if any) extend the cycle.

### Impact on `StorageProvider` and the rest of the app

None. The `GoogleDriveStore` class keeps its public surface — all
behavior changes are internal to `google-auth.ts` and to a small
first-run UX in `google-drive-store.ts`'s initialization path. The
rest of the web app talks to Drive through the unchanged provider
interface.

## Phased plan

### Phase 1 — Code: scope narrowing + root folder picker flow

- `packages/web/src/storage/google-auth.ts`:
  - Change `SCOPES` to `drive.file`.
  - Keep `showFolderPicker()` but tighten its comment to reflect
    the new contract (it's the gate through which drive.file
    access is granted, not just a convenience picker).
- `packages/web/src/storage/google-drive-store.ts`:
  - No API changes. Add a first-run check in the boot path (web
    app's storage-select flow) that calls the picker if no root
    folder ID is persisted yet.
- `packages/web/src/app.ts` (or wherever the Drive backend is
  wired): orchestrate the first-run picker flow.
- Update `.env.example` comment to flag that `VITE_GOOGLE_CLIENT_ID`
  and `VITE_GOOGLE_API_KEY` are baked at build time (public).

No `StorageProvider` interface changes. This phase can land alone.

### Phase 2 — Google Cloud Console configuration

- OAuth consent screen:
  - User type: **External**
  - Scopes: only `drive.file` (+ basic profile)
  - Publish to production (after Phase 1 is deployed)
  - Submit for OAuth verification — light, since no sensitive
    scopes are requested
- Drive UI Integration sub-page:
  - Register MIME types per §3
  - "Open URL" and "New URL" per §3
- API key restrictions:
  - HTTP referrers: `https://annot.work/*`, `http://localhost:3000/*`
  - API restrictions: Drive API + Picker API

### Phase 3 — Code: Drive UI Integration handoff route

Cannot land before Phase 2 registers the handler URL. Once the
handler is registered:

- `packages/web/src/router.ts`: add `/edit/drive/handoff` route
- Fetch the file via `files.get(fileId, { alt: 'media' })`, load
  it into the editor using the same code path as a local file open
- Update [`docs/url-schemes.md`](../url-schemes.md) Current routes
  table

### Phase 4 — Workspace Marketplace listing

- Prepare branding assets from `brand/` (already includes Annot
  icon + wordmark — may need Marketplace-specific aspect ratios)
- Draft privacy policy and terms of service, host at
  `annot.work/privacy` and `annot.work/terms`
- Verify `annot.work` in Google Search Console
- Submit Marketplace listing as unlisted → internal testing →
  published (public)

### Phase 5 — Verification

- Sign in with a brand-new Google account, confirm consent screen
  shows `drive.file` only (no broad Drive access warning).
- Pick a root folder, confirm the app can only see files it
  creates — not pre-existing files in the same folder.
- Open a `.svg` that was exported from Annot into another Drive
  folder (outside the root), right-click → "Open with Annot",
  confirm the handoff route opens it in the editor.
- Open the same Annot deployment from a **Google Workspace** test
  account, confirm it works without admin intervention (and that
  a restricted-by-admin Workspace can allowlist the Marketplace
  entry if needed).

## Migration notes

- Existing users who authorized the current `drive` scope will be
  prompted to re-authorize after the scope change — Google's
  consent screen detects the reduced scope and treats it as a
  fresh consent. Their previously-saved files will still be there
  in Drive, but Annot won't see them until the user picks the
  containing folder as the new root (or opens files individually
  via Drive UI).
- Since the project is pre-GA and the only current user is the
  maintainer, this is acceptable; no data migration tooling
  needed.
- Flag in the release notes: "Annot now uses the minimum-scope
  `drive.file` permission. You'll be asked to reconnect on first
  launch after updating, and to pick a root folder."

## Relationship to other plans / direction

- Complements [`path-based-storage.md`](./path-based-storage.md):
  both assume a single coherent storage tree per backend. Once
  path-based storage lands, `GoogleDriveStore` is just "path-based
  storage rooted at the Picker-selected folder".
- Delivers the Drive half of "individual storage backend" per
  `PRODUCT_DIRECTION.md`. Team collaboration is explicitly not
  part of this plan — that belongs to the future `GitHubStore`.
- **OneDrive (future):** if Microsoft OneDrive becomes a supported
  backend, the same handoff shape applies — `/handoff/onedrive`
  alongside `/handoff/googledrive`. The `/handoff/<source>`
  namespace is sized for this from day one.

## Open questions

- [ ] Should the first-run picker also offer "create a new folder
      named `Annot/`" as a one-click option? (UX nicety.)
- [ ] Custom MIME registration for `.anno.png` / `.anno.jpg` is
      possible but more involved than relying on `image/png` +
      XMP detection after open. Decide before Phase 2.
- [ ] Privacy policy / terms templates — likely need a lawyer
      review before Marketplace submission.
