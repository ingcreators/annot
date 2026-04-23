# Annot URL schemes and deep links

> **Status:** Stub. Reserves the `annot://` scheme and documents the
> in-app routing shape. Populate as features land.

Annot uses URLs in three contexts, each with its own rules:

1. **Web app routes** — path-based routing inside the PWA
   (`annot.dev/annotation/...`).
2. **`annot://` custom scheme** — reserved for deep links from
   outside the browser (Issues, Slack, desktop apps) into the editor.
3. **Extension message URLs** — opaque; not a user-facing contract.

Keeping these separated and documented lets us extend any one of
them without colliding with the others.

## 1. Web app routes

Owned by `packages/web-annotation/src/router.ts`.

Current routes (subject to the path-based storage refactor — see
[`docs/plans/path-based-storage.md`](./plans/path-based-storage.md)):

| Route                         | Purpose                        |
|-------------------------------|--------------------------------|
| `/annotation`                 | Gallery root                   |
| `/annotation/edit/:store/:id` | Editor for image by numeric id |
| `/annotation/edit/:store/file?path=…` | Editor for a FileSystem file |

Target routes after the refactor (**tentative**, documented here so
the refactor ships without inventing a new shape):

| Route                            | Purpose                         |
|----------------------------------|---------------------------------|
| `/annotation`                    | Gallery root                    |
| `/annotation?p=Folder/Sub`       | Gallery scoped to a folder path |
| `/annotation/edit/local?p=Folder/image.png`  | Editor, local store |
| `/annotation/edit/fs?p=…`        | Editor, FileSystem store        |
| `/annotation/edit/ext?extId=…&p=…` | Editor, via extension relay   |
| `/annotation/edit/gdrive?p=…`    | Editor, Google Drive store      |

**Query parameter `p`** carries the path (which may contain `/`).
Using a query param instead of a path segment avoids the `%2F`
encoding pitfall that trips up some servers / browsers.

### Adding a new route

- Update `parseRoute` + `stringifyRoute` in `router.ts`.
- Add a URL builder function (e.g. `editUrl(store, path)`) next to
  the existing ones.
- If the route addresses a new resource type, describe it here
  before wiring navigation into the UI.

## 2. `annot://` custom scheme

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

## 3. Extension internal message URLs

Not a contract. The `chrome.runtime.sendMessage` / `sendMessageExternal`
payloads and any internal URLs carried within the extension are
subject to change without notice. External consumers should never
rely on them; they should use the public `annot://` scheme instead.

## Revision log

| Date       | Change                                         |
|------------|------------------------------------------------|
| 2026-04-23 | Initial stub. Reserved `annot://`, documented current + target web routes. |
