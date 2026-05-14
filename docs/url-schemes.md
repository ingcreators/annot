# Annot URL schemes and deep links

> **Status:** Stub. Reserves the `annot://` scheme and documents the
> in-app routing shape. Populate as features land.

Annot uses URLs in four contexts, each with its own rules:

1. **Web app routes** — path-based routing inside the PWA, served
   from the site root at `annot.work/...`.
2. **External handoff routes** — `/handoff/<source>?state=...`
   entrypoints that translate an external trigger (Google Drive UI,
   future OneDrive / GitHub) into a regular internal route.
3. **`annot://` custom scheme** — reserved for deep links from
   outside the browser (Issues, Slack, desktop apps) into the editor.
4. **Extension message URLs** — opaque; not a user-facing contract.

Keeping these separated and documented lets us extend any one of
them without colliding with the others.

## 1. Web app routes

Owned by [`packages/web/src/router.ts`](../packages/web/src/router.ts).
The router derives its base prefix from `import.meta.env.BASE_URL`, so
changing Vite's `base` setting re-homes every route in lockstep. The
production deploy on Cloudflare Pages uses `base: "/"`, so the routes
below are served from the site root.

Current routes (what the router actually accepts today):

| Route                            | Purpose                                                                     |
|----------------------------------|-----------------------------------------------------------------------------|
| `/`                              | Gallery root                                                                |
| `/folder/<path>`                 | Gallery deep-linked into a folder (path segments after `/folder/`)          |
| `/edit/img/<store>/<path>`       | Editor for an image. `<store>` is one of `browser` / `device` / `extension` / `googledrive` |
| `/edit/doc/<store>/<path>`       | Editor for an `.annot.html` document. Same `<store>` set                    |
| `/capture`                       | Capture workspace (Phase 2 of `web-capture-redesign.md`)                    |

Resource type lives between `edit` and `<store>` as a short
identifier (`img` / `doc`), matching annot's "short identifier in
URLs / package names / element prefixes" convention. Legacy
`/edit/<store>/<path>` (without a resource segment) and
`/doc/<store>/<path>` (top-level, pre-regrouping) URLs fall through
to the gallery — see the revision log for the rationale.

Recognized query parameters:

| Query key | Used on                  | Purpose                                                |
|-----------|--------------------------|--------------------------------------------------------|
| `extId`   | `/edit/img/extension/...` | Identifies the extension relay that captured the image |
| `session` | `/edit/img/<store>/...`   | Opens the Bulk Editor / Split Editor filtered by the capture session |

Target routes after the path-based storage refactor (**tentative**,
see [`docs/plans/path-based-storage.md`](./plans/path-based-storage.md)
— the plan proposes moving `<path>` into a `?p=...` query parameter
to avoid `%2F` encoding in path segments):

| Route                                  | Purpose                                    |
|----------------------------------------|--------------------------------------------|
| `/`                                    | Gallery root                               |
| `/?p=Folder/Sub`                       | Gallery scoped to a folder path            |
| `/edit/img/browser?p=Folder/image.png` | Editor, Browser (IDB) store                |
| `/edit/img/device?p=…`                 | Editor, Device (FileSystem) store          |
| `/edit/img/extension?extId=…&p=…`      | Editor, via extension relay                |
| `/edit/img/googledrive?p=…`            | Editor, Google Drive store                 |
| `/edit/doc/browser?p=Manuals/foo.html` | Document editor, Browser store             |

**Query parameter `p`** carries the path (which may contain `/`).
Using a query param instead of a path segment avoids the `%2F`
encoding pitfall that trips up some servers / browsers.

### Adding a new route

- Update `parseRoute` + `stringifyRoute` in `router.ts`.
- Add a URL builder function (e.g. `editUrl(store, path)`) next to
  the existing ones.
- If the route addresses a new resource type, describe it here
  before wiring navigation into the UI.

## 2. External handoff routes

**Namespace:** `/handoff/<source>?state=<json-blob>`

| Route                                | Source                          | Spec |
|--------------------------------------|----------------------------------|------|
| `/handoff/googledrive?state=…`       | Google Drive UI Integration      | see below |
| `/handoff/onedrive?state=…`          | OneDrive (future)                | reserved |
| `/handoff/github?state=…`            | GitHub integration (future)      | reserved |

The handoff namespace is deliberately separate from
`/edit/<kind>/<store>/<path>` so external-trigger entrypoints don't
collide with filenames that happen to match a reserved word (e.g. a
file literally called `handoff` inside any storage backend).

### `/handoff/googledrive?state={driveState}`

Entrypoint registered with Google as the **Open URL** and **New URL**
in Drive UI Integration (see
[`docs/plans/google-drive-integration.md`](./plans/google-drive-integration.md)
§3). Google substitutes `{driveState}` with a URL-encoded JSON blob:

```jsonc
{
  "action": "open" | "create",
  "ids": ["<fileId>"],        // action=open
  "folderId": "<folderId>",   // action=create
  "userId": "<driveUserId>"
}
```

Handler:

- `action=open`: walk `ids[0]`'s parents back to the user's Annot root,
  build the in-workspace path, then `replaceState` to
  `/edit/img/googledrive/<path>`. If the file is outside the root, show
  a guidance error and return to the gallery.
- `action=create`: currently unsupported (shows an info banner); the
  capture-from-Drive flow will land in a follow-up.

The handoff URL never appears in browser history — `replaceState`
substitutes the canonical edit URL on success so Back lands on
gallery, not on an opaque JSON state.

## 3. `annot://` custom scheme

**Reserved**. No production use yet.

The `annot://` URL scheme is reserved by this project for deep
linking into the Annot editor / gallery from external contexts —
Issue bodies, Slack messages, terminal output from the future CLI.

Planned shape:

| URL                                | Opens                             |
|------------------------------------|-----------------------------------|
| `annot://open?store=…&p=…`         | Editor for a specific image       |
| `annot://gallery?store=…&p=…`      | Gallery folder                    |
| `annot://share?url=…`              | Import a screenshot from a URL    |
| `annot://new?src=<clipboard\|paste\|…>` | Start a capture via external trigger |

### Registration

The PWA cannot register `annot://` itself — that requires a native
handler. The planned wiring:

- **Browser extension** registers itself as the `annot://` protocol
  handler via `chrome.runtime` APIs; route parsing happens in the
  service worker, which then relays to the PWA or pops open an
  editor tab.
- **Desktop (Tauri)** can register the scheme OS-wide; the Tauri
  host translates to an internal router event.

Until registration lands, the scheme stays reserved but unused.
**Do not repurpose it** for anything else — e.g. storage IDs or
content-script messages.

## 4. Extension internal message URLs

Not a contract. The `chrome.runtime.sendMessage` / `sendMessageExternal`
payloads and any internal URLs carried within the extension are
subject to change without notice. External consumers should never
rely on them; they should use the public `annot://` scheme instead.

## Revision log

| Date       | Change                                         |
|------------|------------------------------------------------|
| 2026-04-23 | Initial stub. Reserved `annot://`, documented current + target web routes. |
| 2026-04-23 | Switched web app base to `/` for Cloudflare Pages deploy at `annot.work`; updated route tables to drop the legacy `/annotation` prefix and match the current router. |
| 2026-04-23 | Added the external-handoff namespace `/handoff/<source>` (Drive UI Integration today, OneDrive / GitHub reserved for future). Kept separate from `/edit/<store>/<path>` so reserved words don't collide with filenames. |
| 2026-04-23 | Renamed URL-visible store identifiers so they track the sidebar labels: `local` → `browser`, `filesystem` → `device`. The internal class names (`LocalStore`, `FileSystemStore`) stay; only the routing segment and `StorageMode` value change. Legacy bookmarks (`/edit/local/...`, `/edit/filesystem/...`) are deliberately left to 404. |
| 2026-05-14 | Regrouped resource types under a single `/edit/` namespace: `/edit/<store>/<path>` → `/edit/img/<store>/<path>`, `/doc/<store>/<path>` → `/edit/doc/<store>/<path>`. Rationale: the old layout mixed verb-prefix (`/edit/`) with noun-prefix (`/doc/`) at the same hierarchy level — the new shape uses `<kind>` between `edit` and `<store>` as a short identifier (`img` / `doc`), matching annot's package-name / custom-element-prefix convention. Legacy `/edit/<store>/<path>` and `/doc/<store>/<path>` URLs fall through to the gallery (same 404 policy as the `local→browser` rename). Split Editor stays an implicit overlay on `/edit/img/<store>?session=<id>` — explicit routing is left for a future PR. |
