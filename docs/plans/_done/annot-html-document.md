# `.annot.html` document — multi-image manual format

> **Status:** Done — v1 shipped, all 14 phases landed (0–13).
> Phases 0–13 landed via the PRs below; this archival entry retires
> the doc to `_done/` together with the follow-on
> [`card-procedure-template.md`](./card-procedure-template.md) plan.
>
> Phases 0–13 landed:
>
> | Phase | Description | PRs |
> |-------|-------------|-----|
> | 0 | Spec freeze + golden fixtures | #539 |
> | 1 | Tier A `@ingcreators/annot-doc` | #540 |
> | 2 | Self-contained styling | #541 |
> | 3 | Read-only `<annot-doc-shell>` | #542 |
> | 4 | Block editing + slash menu | #543 / #544 |
> | 5 | Image block + EditorShell modal + capture insertion | #545 / #546 |
> | 6 | PWA route + BrowserStore + gallery wiring | #547–#554 |
> | 7 | Multi-backend opt-in (Device / Desktop / Drive / GitHub) | #555–#558 |
> | 8 | Templates: mechanism (clone / save-as / picker / "From Template…") | #559–#562 |
> | 9 | Built-in starter templates | #563 / #564 |
> | 10 | VSCode custom editor + `Annot: New document` | #565 |
> | 11 | Multi-slide PPTX export | #566 |
> | 13a | Auto-numbering (headings + figures) | #567 |
> | 13b | Cross-reference resolver helper | #568 |
> | 13c | Plugin docs (`StorageWithDocuments` + forward-looking `documents.md`) | this PR |
>
> Phase 12 (Markdown export) is deferred to demand per the plan.
>
> NOTE: this plan was renumbered after the Phase 6 / 7 rounds —
> the original Phase 7 (templates) + Phase 9 (multi-backend)
> were re-ordered to match shipping order (multi-backend went
> first to validate the contract across backends before
> templates layer on top). Subdivision letters (`6a`–`6h`,
> `7a`–`7d`, `8a`–`8d`, `13a`–`13c`, …) match the commit log.
> **Compatibility:** New file format and new file extension; new
> workspace package `@ingcreators/annot-doc` (Tier A); new editor
> surface (`<annot-doc-shell>`) in `@ingcreators/annot-host-ui` (Tier C);
> new optional `StorageWithDocuments` capability — every existing
> `StorageProvider` continues to work unchanged. `.annot.svg` round-trip
> is preserved end-to-end (`.annot.html` embeds standalone `.annot.svg`
> documents byte-for-byte).
> **Risk:** Large surface, but additive throughout. The on-disk format
> commits us to backwards-compat going forward (see
> `data-annot-doc-version`), so Phase 0 / Phase 1 freeze the spec
> before any UI lands. Plan-first work; each phase is a standalone PR
> (single landing rule per `docs/plans/README.md`).

## Context

Annot today is a per-screenshot tool: every saved file is one image plus
its annotation overlay. Users producing manuals / runbooks / bug
reports stitch those single-image files together by hand outside the
product (Google Docs, Notion, Confluence, Markdown in a repo). This
loses the editable-annotation property the moment the screenshot
crosses out into the destination tool — a saved `.annot.png` carries
its editable SVG via XMP, but a screenshot pasted into a Notion page
is just pixels.

The user's framing of the gap: an annotation-bearing manual that reads
as a normal document in a browser AND remains fully editable inside
Annot — i.e. one file, two faces.

This sits on top of three things that already exist:

- **`.annot.svg`'s self-contained round-trip** (see
  [`docs/svg-format.md`](../svg-format.md), `packages/editor/src/export.ts`,
  `packages/core/src/xmp/`). A saved `.annot.svg` opens in any SVG
  viewer as a normal image AND, when re-loaded into Annot, restores
  every editable element. The `.annot.html` format is a direct
  generalisation: instead of one image-with-overlay, it carries N
  images-with-overlays plus surrounding prose.
- **`EditorShell.mountFromRecord`**
  ([`packages/host-ui/src/editor-shell.ts:210`](../../packages/host-ui/src/editor-shell.ts:210))
  already gives us a per-image lifecycle the document editor can
  delegate to wholesale — one image block of a `.annot.html` is
  effectively one `EditorShell` instantiation against the inlined
  SVG bytes.
- **`StorageProvider` capability split**
  ([`packages/core/src/storage/types.ts`](../../packages/core/src/storage/types.ts):
  `StorageWithThumbnailCache`, `StorageWithResync`, etc.).
  Documents land as a new optional capability — every existing
  backend keeps working; the ones we wire up first opt in.

This plan is also the natural staging ground for the
[`github-integration.md`](./github-integration.md) "manuals as
markdown / HTML in a repo" use-case: a `.annot.html` committed to a
docs/ folder renders in GitHub's preview AND opens in Annot for
editing — no separate "publish" step.

## Design

### Two faces, one file

The format is HTML. Specifically: **a static HTML document that any
browser can open with no JS execution required for viewing**, that
ALSO carries enough machine-readable structure for Annot to round-trip
edit. Browser-view rendering and editor-mode parsing read from the
same DOM tree; the editor-only fields ride along as `data-*`
attributes and one or two sidecar `<script type="application/json">`
blocks.

```html
<!doctype html>
<html lang="ja" data-annot-doc-version="1">
  <head>
    <meta charset="utf-8">
    <meta name="annot-document" content="1">
    <title>Onboarding manual — Annot</title>
    <style>/* injected: fonts + base layout + print + dark mode */</style>
  </head>
  <body>
    <article data-annot-doc>
      <h1 data-annot-block="heading" data-level="1">Onboarding</h1>
      <p data-annot-block="paragraph">…prose…</p>
      <figure data-annot-block="image" data-annot-image-id="img_01">
        <svg data-annot-version="1" viewBox="0 0 1280 720" …>
          <image href="data:image/png;base64,…"/>
          <g id="annotations">…</g>
        </svg>
        <figcaption>図 1: ログイン画面</figcaption>
      </figure>
      <h2 data-annot-block="heading" data-level="2">…</h2>
      <pre data-annot-block="code" data-lang="bash"><code>…</code></pre>
    </article>
    <script type="application/annot+json" data-annot-doc-meta>
      { "title": "Onboarding manual", "author": "…", "imageMeta": {…} }
    </script>
  </body>
</html>
```

Properties this commits us to:

1. **No external assets.** No `<link rel="stylesheet">`, no
   `<script src="...">`, no `<img src="https://…">`. Everything is
   inline so the file ships as a single shareable artefact.
2. **No JavaScript needed to view.** The injected `<style>` block
   is enough for browser rendering. The editor-mode logic lives in
   Annot, not in the file.
3. **Inline `<svg>` per image, not `<img>`.** Carries
   `data-annot-version` per `docs/svg-format.md`. Reuses the
   existing `.annot.svg` writer so the embedded SVG IS a valid
   `.annot.svg` document if extracted standalone.
4. **Block boundaries are explicit (`data-annot-block="..."`).**
   The parser doesn't have to infer structure from tag soup.
5. **Round-trip byte equivalence.** Read → no-op edit → write
   produces an identical file (same invariant `.annot.svg` enforces
   today).
6. **Standalone-viewable in any browser.** Opening the file with
   `file://` works; `window.print()` produces a sensible PDF.

The format intentionally rejects:

- **Custom elements visible to non-Annot viewers** (`<annot-doc>`
  in the body) — they'd render as inline-block by default and
  would need a polyfill stylesheet to look right. Standard HTML +
  `data-*` is forgiving.
- **External stylesheet links to a CDN** — would mean Annot
  becomes responsible for hosting CSS forever, and offline / repo
  embedding breaks.
- **Web fonts via `@font-face` URLs** — same hosting problem,
  plus the `multilingual-fonts-os-stack.md` plan already gave us
  OS-font stacks per logical family.

### Block taxonomy (v1)

| Block type | Storage | Editable representation |
|---|---|---|
| `heading` | `<h1..h3 data-level="1..3">` | text + level |
| `paragraph` | `<p>` | rich text via `TextRun[]` |
| `list` | `<ul>` / `<ol>` | array of rich-text items |
| `code` | `<pre><code data-lang="...">` | plain text + lang |
| `quote` | `<blockquote>` | array of paragraphs |
| `callout` | `<aside data-tone="info\|warn\|note">` | rich text + tone |
| `divider` | `<hr>` | nothing |
| `image` | `<figure>` with inline `<svg>` + `<figcaption>` | embedded `.annot.svg` + caption + alt |

Tables / embeds / footnotes / cross-references are deliberately
deferred to v2 — the v1 taxonomy is "everything you need for a
screenshot-driven manual, nothing else." This keeps the parser /
serialiser / renderer trios short.

### Document model (Tier A)

A new workspace package `packages/doc/` (npm name
`@ingcreators/annot-doc`) holds the format. Headless / jsdom-friendly:
no live browser dependency, no `<canvas>`. Mirrors the
`@ingcreators/annot-core` Tier A stance.

```ts
// @ingcreators/annot-doc
export interface AnnotDocument {
  readonly version: 1;
  readonly title: string;
  readonly lang: string;             // "ja" | "en" | …
  readonly properties: DocProperties; // theme, print options, etc.
  readonly blocks: readonly Block[];
}

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | CodeBlock
  | QuoteBlock
  | CalloutBlock
  | DividerBlock
  | ImageBlock;

export interface ImageBlock {
  readonly kind: "image";
  readonly id: string;             // stable across edits
  readonly svg: string;            // valid .annot.svg, byte-faithful
  readonly width: number;
  readonly height: number;
  readonly caption?: TextRun[];
  readonly alt?: string;
  readonly originalDataUrl?: string;  // optional cache; svg has it embedded
}

export function parseDocument(html: string): AnnotDocument;
export function serializeDocument(doc: AnnotDocument): string;
```

Internally the parser uses `DOMParser` (browser) / `linkedom` (Node) —
the same dual-runtime stance Tier A code already takes. The
serialiser emits stable attribute order + canonical whitespace so
round-trip byte equivalence holds.

`TextRun[]` is reused from `@ingcreators/annot-core/editor`'s
existing rich-text infrastructure (per-run bold / italic / underline /
font / color), so prose formatting and image-caption formatting share
a single carrier.

### Self-contained styling (Tier B)

A `injectDocumentStyles(doc)` helper similar in spirit to
`injectLogicalFontStyles` in
[`packages/editor/src/export.ts:40`](../../packages/editor/src/export.ts:40)
emits a `<style>` block covering:

- `@font-face`-free font stacks for `Annot Sans` / `Annot Serif` /
  `Annot Mono` from `cssStackFor(token)`.
- Base typography (line-height, heading scale, max content width).
- Block-type rules keyed off `data-annot-block` so the file looks
  the same regardless of JS execution.
- `@media print` rules (page breaks, image scaling, footer).
- `@media (prefers-color-scheme: dark)` rules (preserves
  annotation colors; flips background + text only).
- Hide-the-editor rules. The file's `<style>` always renders the
  read-only document. When Annot opens the file in editor mode it
  injects its own additional styles (block toolbars, insertion
  carets) that the standalone view never sees.

This block is regenerated on every save; user customisations go
through `DocProperties` which the serialiser writes into the body
of the style block via predefined CSS variables (`--annot-doc-max-width`
etc.).

### Editor surface (Tier C)

A new `<annot-doc-shell>` Lit element joins the existing
`<annot-editor-shell>` in `@ingcreators/annot-host-ui`. It is a
sibling to `EditorShell`, not a replacement — hosts decide which
shell to mount based on the file extension:

```ts
// pseudo
if (path.endsWith(".annot.html")) {
  await docShell.mountFromDocument(path, document);
} else {
  await editorShell.mountFromRecord(path, record);
}
```

Inside the doc shell:

- **Block list editor.** Vertical list of blocks, each rendered
  with the same DOM node it'll serialise to (so editor-view ≈
  reader-view structurally; only block toolbars + selection
  outlines differ).
- **Per-block toolbar.** Insert above / insert below / delete /
  move up / move down — appears on hover or on focus.
- **Slash-menu.** Typing `/` at the start of an empty paragraph
  opens an insertion menu (heading 1/2/3, list, code, callout,
  image, divider). Same UX shape as the toolbar's variant flyout
  — register stays in `@ingcreators/annot-doc` (Tier A) for the
  block type list, the menu lives in host-ui.
- **Text editing via contentEditable.** Same `rich-text-mapper`
  the existing shape-text path uses
  ([`packages/core/src/editor/rich-text-mapper.ts`](../../packages/core/src/editor/rich-text-mapper.ts)).
  Bold / italic / underline shortcuts; the existing
  floating mini-toolbar gets reused with one-line tweak to recognise
  prose contexts.
- **Image-block editing through `EditorShell`.** Click an image
  block → opens a modal dialog hosting a fresh
  `<annot-editor-shell>` against a synthesised `ImageRecord`
  (`originalDataUrl` + `annotationsSvg` parsed out of the embedded
  `<svg>`). Save → re-serialises the SVG and stamps it back into
  the block. Cancel → throws away the in-flight session.
  - Modal-first because the toolbar / drawer / right-panel of the
    image editor would fight for screen space with the document
    editor's block toolbar otherwise. Inline editing is a v2 polish
    item once we know the workflow.
  - The same `EditorShell.mountFromRecord` interface used by the
    PWA today
    ([`packages/host-ui/src/editor-shell.ts:210`](../../packages/host-ui/src/editor-shell.ts:210)) —
    the doc shell is just a different host of it.
- **Document outline drawer.** Reuses
  `<annot-file-details-drawer>`'s drawer chrome; content is a
  table-of-contents auto-generated from heading blocks with
  click-to-scroll.
- **Document properties panel.** Right-side panel surfaces title,
  author, default theme (light / dark / both), max content width
  preset.
- **Preview toggle.** Single button that hides the editor chrome
  (block toolbars, slash-menu hooks, drawer) so the user sees
  exactly what a non-Annot reader would see. Implemented as a
  body-class toggle, no re-render needed.

### Storage provider integration

A new optional capability:

```ts
// @ingcreators/annot-core/storage
export interface StorageWithDocuments {
  saveDocument(record: Omit<DocumentRecord, "path">,
               opts?: { filename?: string }): Promise<string>;
  getDocument(path: string): Promise<DocumentRecord | undefined>;
  updateDocument(path: string, updates: DocumentRecordUpdate): Promise<void>;
  listDocuments(folderPath: string): Promise<DocumentRecord[]>;
  // delete / move / rename reuse the image-side equivalents
  // (the path-keyed model already covers any leaf file).
}

export interface DocumentRecord {
  path: string;
  folderPath: string;
  bytes: string;          // the .annot.html source
  thumbnailDataUrl: string;  // first image block's annotation, scaled
  title: string;
  imageCount: number;
  blockCount: number;
  createdAt: string;
  updatedAt: string;
}

export function supportsDocuments(s: StorageProvider):
    s is StorageProvider & StorageWithDocuments { /* … */ }
```

Every existing call site that touches `ImageRecord` is unaffected;
hosts that want documents check `supportsDocuments(store)` first.
Path-keyed addressing means `delete` / `rename` / `move` already work
through the existing image-side methods (a `.annot.html` is just a
leaf file at a path).

The four backends opt in over phases:

- **BrowserStore** (Phase 6) — pure IDB, simplest first target.
- **DeviceStore / DesktopStore** (Phase 9) — direct fs write of the
  HTML bytes; no XMP-style sidecar needed (the format is already
  self-describing).
- **GoogleDriveStore** (Phase 9) — same pattern as image upload,
  MIME `text/html`.
- **GitHubStore** (Phase 9) — committed as a regular HTML file in
  the repo; renders in GitHub's preview when paired with a
  `<style>`-only file.

Plugin-registered stores can opt in by implementing the same
interface; the plugin docs at
[`docs/plugin-api/storage.md`](../plugin-api/storage.md) gain a
"Documents capability" section in Phase 13.

### Templates

Users start a new document from a chosen template. **A template IS
a `.annot.html` document** — same parser, same serialiser, same
storage backend. Two extra markers identify it:

- `<html data-annot-doc-template="1">` on the root.
- `<meta name="annot-template" content="1">` in `<head>`.
- A `template` sub-object in the `data-annot-doc-meta` JSON sidecar
  carrying `{ name, description, tags }`.

Storage location is convention: templates live under a `Templates/`
folder in the active store. The picker scans only that folder; a
file dropped there without the markers is treated as a regular
document (not silently elevated). Treating templates as
"location + marker" instead of either alone keeps the model
predictable — no folder-wide auto-elevation, no hidden registry.

#### Cloning rules

"New from template" parses the template and applies a structural
clone in `@ingcreators/annot-doc`:

- Strip `data-annot-doc-template`, `<meta name="annot-template">`,
  and the `template` sub-object from the metadata sidecar.
- Mint a fresh `id` for every block AND every ImageBlock's
  `data-annot-image-id`. Stable IDs across template + clone would
  collide on TOC anchors / cross-references when both sit in the
  same library.
- Preserve everything else verbatim: prose, image bytes, embedded
  annotations, document properties (max-width, theme), block
  order, captions, alt text.
- The cloned document opens in the editor as **un-saved** — the
  user picks the destination path on first save (Save / Save-As
  dialog) so they don't accidentally overwrite the template.

V1 does **no variable substitution / placeholder interpolation** —
the template's prose IS the starting prose; users edit it
manually. v2 candidates (`{{title}}` / `{{date}}` / etc.) noted in
Forward-looking; the v1 surface area shrinks the parser /
serialiser / picker / clone-helper trio to "structural copy"
which is testable byte-for-byte.

#### Save-as-template

Right-side document properties panel exposes a **"Save as
template"** button. Clicking opens an `<annot-dialog>` with three
fields:

- **Name** (required, unique within `Templates/`) — used as the
  filename stem (`Templates/<name>.annot.html`).
- **Description** (optional, free text shown in the picker).
- **Tags** (optional, comma-separated; future filter UI).

Confirm → the doc shell clones the current document, adds the
template markers, writes the metadata sidecar, and persists to
`Templates/<name>.annot.html` via `saveDocument`. The current
editor session is unaffected — the original document stays open
and dirty/saved status is preserved. (Save-as-template is a side
effect on `Templates/`, not a "save the current doc" action.)

#### Picker UX

Triggered from:

- File-manager toolbar **"New" split button**: default action
  "New blank document"; flyout offers "From template…" → opens
  the picker.
- Editor's File menu when no doc is currently open.
- A first-run nudge in the empty-state of the file-manager (one
  starter call-out: "Get started — pick a template or new blank").

Picker shape:

- Two sections: **"Built-in"** (starter templates shipped in the
  package — see "Built-in starter templates" below) and **"My
  templates"** (the user's `Templates/` folder).
- "My templates" lists every entry in `Templates/` whose `<head>`
  parses to a template marker. Narrowing happens client-side via
  a streaming `<head>`-only parse (lazy: a folder with hundreds of
  regular `.annot.html` files doesn't have to fully deserialise
  everything before the picker first paints).
- Each entry: thumbnail + name + description + tag chips. Click
  → clone immediately + open in editor. **No preview step** — if
  the user picked the wrong template they undo or close without
  saving. Adding a preview pane is a v2 polish item.
- Recently-used template chips at the top of the picker
  (localStorage-persisted per host).
- Empty-state for "My templates": "Save any document as a template
  to add it here." Built-in section ensures the picker is never
  fully empty — first-time users always have starter options.

#### Thumbnails

Reuses the document-thumbnail strategy: first ImageBlock's
annotation thumbnail, scaled. Templates without image blocks fall
back to a generic icon in the picker (`<annot-icon icon="article">`
or similar). The thumbnail is regenerated on save by the existing
`ThumbnailManager` flow once the storage backend opts into
`StorageWithThumbnailCache`. Built-in templates pre-bake their
thumbnail into the package so the picker can render before any
parse happens.

#### Built-in starter templates

V1 ships **3 hand-authored starter templates** focused on
manual-creation flows so the picker is useful from first run.
They live as resource files under `packages/doc/templates/`,
imported as raw HTML strings (`?raw` import in browser hosts,
`fs.readFile` in Node tests):

| ID | Name | Shape |
|---|---|---|
| `manual` | Basic manual | H1 title + intro paragraph + 3 sections (H2 + intro + image block + caption) + closing summary. The general-purpose default. |
| `feature-guide` | Feature guide | H1 + info-tone callout (overview) + "What this does" section + numbered "How to use it" with one image block per step + tips note. For per-feature documentation. |
| `procedure` | Procedure | H1 + warn-tone prerequisites callout + ordered list of steps (each step paragraph + image block + caption) + verification section + troubleshooting callout. For strict step-by-step procedures. |

Each ships with bracketed placeholder copy (`[Title]`,
`[Add an overview here]`, `[Section heading]`, …) and a generic
placeholder image — a small inline SVG with a dashed border +
centered "Drop screenshot here" text — so users see the editing
affordance immediately when they open the cloned document.

**Loading model: virtual built-ins, no first-run copy.** The
picker reads built-in sources directly from the package at render
time; nothing is copied to the user's `Templates/` folder. This
sidesteps three classes of bug:

- "User deleted starter template — does it come back?" — N/A,
  it's not in their library.
- "Starter template updated in a new release — user's copy is
  stale." — N/A, the source IS the package.
- "Race conditions on first-run copy across multiple hosts
  sharing the same backend." — N/A, no copy.

Built-in entries in the picker carry a "Built-in" pill so users
can distinguish them from their own templates. **"Save as my
template"** action (right-click menu on a built-in entry) clones
the built-in source + opens the save-as dialog → persists to
`Templates/<name>.annot.html`. From then on the user has their
own editable variant; the built-in stays unchanged.

V1 templates ship in **English only**. Rationale: English is the
lingua franca for the OSS audience the product targets; CLAUDE.md
records that "user-facing UI strings are mostly English with some
Japanese" so English-leaning user content is consistent with the
chrome users already see. Japanese variants (matching the primary
developer locale) follow in v2 alongside other locale support —
see Forward-looking.

#### Out of scope for v1

- **No plugin-registered templates.** Plugin authors can ship
  `.annot.html` files via their own distribution channels and
  those files appear in the picker if dropped into the user's
  `Templates/` folder, but the plugin host doesn't get a
  registration API for it. v2 follow-up — see Forward-looking.
- **No variable substitution.** Structural clone only; v2.
- **No template versioning / migration.** Editing a template
  doesn't propagate to documents previously cloned from it. By
  design — clones are independent.
- **No locale variants of built-in starters.** v1 ships
  English-only; Japanese (and other-locale) variants follow
  in v2 — see Forward-looking.
- **Built-in templates are not user-editable in place.** The
  source IS the package — editing requires "Save as my template"
  + edit the resulting copy.

### Detection rules

Two checks, both must pass for editor-mode entry:

1. File extension is `.annot.html` (or `.annot.htm`).
2. The parsed root has `data-annot-doc-version` AND
   `<meta name="annot-document" content="1">`.

A file with only the extension but missing the markers is treated
as a stranger HTML file: Annot offers a one-shot "import as document"
that runs a best-effort heuristic parse. A file with the markers but
a wrong / missing version triggers the same migrate-on-save behaviour
the SVG path uses today (parse what we can; stamp the current version
on the next save).

### Round-trip byte equivalence

Identical guarantee to `.annot.svg`: `serialize(parse(bytes)) === bytes`
when no edits happened. The serialiser pins:

- Attribute order per element (alphabetical except for
  `data-annot-block` first, `data-annot-image-id` second).
- Indentation (2-space, deterministic).
- Self-closing vs. open form (HTML5 rules + a project canonical
  form for `<br>` / `<hr>` / void elements).
- Quote style (always double).

CI test sits next to the parser and walks a corpus of golden
`.annot.html` fixtures.

### Tier alignment

Same three-tier model the rest of the codebase follows
([`CLAUDE.md`](../../CLAUDE.md) section 2):

| Tier | Code | Package |
|---|---|---|
| A | format spec types, parser, serialiser, doc model | `@ingcreators/annot-doc` |
| B | block→DOM helpers, style-injection, sanitisers | `@ingcreators/annot-doc/editor` subpath |
| C | `<annot-doc-shell>`, block toolbar, slash-menu | `@ingcreators/annot-host-ui` |
| C-render | (future) doc-to-PPTX, doc-to-PDF | `@ingcreators/annot-render` |

CI enforcement for Tier A purity: an `annot-doc/src/headless.test.ts`
mirroring `packages/core/src/headless.test.ts` — imports every
documented `annot-doc` subpath in pure Node and asserts no `host-ui` /
`editor` / `render` package crept into `require.cache`.

## Phased plan

Each phase is a standalone PR per the
[`docs/plans/README.md`](./README.md) "one PR per phase" convention.
Phases are revertable in isolation: a later revert of phase N must
not force a revert of phase N+1.

### Phase 0 — Spec freeze + golden fixture

- Write `docs/annot-html-format.md` (canonical reference, mirroring
  `docs/svg-format.md` for documents).
- Hand-author 2–3 golden `.annot.html` fixtures: empty doc with one
  paragraph; doc with one image block; doc with mixed blocks.
- No code yet — this PR is pure documentation + binary fixtures.
- Lock in: root markers, block taxonomy v1, `data-*` vocabulary,
  attribute-order / whitespace canonicalisation rules, allowable
  HTML elements (allow-list, not deny-list).

### Phase 1 — Tier A `@ingcreators/annot-doc` package

- New workspace package scaffold (`packages/doc/`).
- `AnnotDocument`, `Block` discriminated union, `DocProperties`.
- `parseDocument(html: string): AnnotDocument` —
  `DOMParser` in browser, `linkedom` in Node (already a transitive
  dep via Storybook).
- `serializeDocument(doc: AnnotDocument): string` — deterministic
  output.
- Round-trip byte-equivalence test against the Phase 0 fixtures.
- Headless boundary test (no DOM-living globals leak into Tier A).
- Public API: `parseDocument`, `serializeDocument`,
  `createEmptyDocument`.

### Phase 2 — Self-contained styling

- `injectDocumentStyles(doc)` (Tier B) emitting a `<style>` block
  covering fonts / typography / blocks / print / dark-mode.
- Visual goldens (Storybook) for: light / dark / print / each
  block kind.
- Property-based test: any document round-trips through
  `serializeDocument` ∘ `injectDocumentStyles` and remains valid
  HTML5 (validated via `linkedom`).
- Doc properties (max-width, theme defaults) wired into the style
  block via CSS custom properties.

### Phase 3 — `<annot-doc-shell>` skeleton (read-only)

- New Lit element in `packages/host-ui/src/`.
- Renders blocks; no editing yet.
- TOC drawer wired up (clicks a heading → scroll-into-view).
- Storybook stories per block type (Default / Empty / Long).
- Co-located `*.test.ts` covering mount / re-mount / theme toggle
  / light / dark.

### Phase 4 — Block editing + slash menu

- contentEditable on text-bearing blocks; bold / italic / underline
  via existing `rich-text-mapper`.
- Block toolbar (insert above / below, delete, move up / down).
- Slash-menu component (`<annot-block-insertion-menu>`) reusing the
  existing `<annot-tool-flyout>` chrome.
- History integration: every block edit produces an undo entry
  via the same `History` primitives the editor uses.

### Phase 5 — Image block + EditorShell modal

- `<annot-image-block>` element + click-to-edit.
- Modal dialog (reuses `<annot-dialog>`) hosting a fresh
  `<annot-editor-shell>` against a synthesised `ImageRecord`.
- Save in modal → re-serialise SVG, replace block's embedded svg.
- Cancel → discard session, no doc mutation.
- Capture insertion: paste from clipboard / drop image file /
  pick from gallery (when running inside a host with a
  `StorageProvider` listing).

### Phase 6 — PWA route + BrowserStore integration

- New `StorageWithDocuments` capability + `supportsDocuments`
  predicate in `@ingcreators/annot-core/storage`.
- BrowserStore opts in.
- PWA URL scheme: `?doc=<path>` (mirroring the existing `?p=<path>`
  for images per `docs/url-schemes.md`). The router-host swaps in
  the doc shell when `?doc=` is present.
- File-manager recognises `.annot.html` (icon + thumbnail strategy).
- Save / Save-As / dirty-tracking wired through the existing
  `SavePipeline` orchestrator.

### Phase 7 — Multi-backend opt-in

Originally slated as Phase 9, brought forward to validate the
multi-backend story before templates layer on top. Each row
shipped as its own PR (`phase 7a` … `phase 7d` in the commit
log) — Browser already opted in via Phase 6a, so this phase
covers the remaining four.

- DeviceStore (Phase 7a): direct file write at the chosen path.
- DesktopStore (Phase 7b): direct file write at the chosen path
  via the Electron-side filesystem library.
- GoogleDriveStore (Phase 7c): upload as `text/html`; per-doc
  metadata cached in `appProperties`.
- GitHubStore (Phase 7d): commit-as-save; per-doc metadata
  cached in an in-memory map keyed by basePath-relative path
  (no GitHub `appProperties` equivalent).
- Contract test (`runStorageContract`) extension to a docs
  section that runs against every opted-in backend — deferred;
  per-backend `*.documents.test.ts` files cover the
  `supportsDocuments` narrowing in the meantime.
- Templates inherit everything for free once Phase 8 / 9 land —
  `Templates/` is a regular folder on every backend;
  `<annot-template-picker>` will work against any store that
  opts into `StorageWithDocuments`.

### Phase 8 — Templates: mechanism (markers + clone + picker + save-as)

This phase ships the user-authored half of the template feature.
Phase 9 follows with the bundled starters so the picker is never
empty on a fresh install. Subdivided like Phase 6 / Phase 7 —
each row lands as its own PR.

- **Phase 8a — Template marker support + `cloneTemplate` Tier A
  foundation**. Parser / serialiser already round-trip the three
  template markers (`data-annot-doc-template` on `<html>`,
  `<meta name="annot-template">`, `template` sub-object in the
  JSON sidecar) — landed alongside Phase 1. This phase adds the
  inverse: `cloneTemplate(template: AnnotDocument,
  options?: { makeId?: () => string }): AnnotDocument` —
  strips markers, mints fresh image-block IDs, remaps
  `imageMeta` keys, returns a fresh document. Pure (no DOM,
  no host); covered by a structural-clone unit test that
  asserts (a) markers absent, (b) every image-block ID
  changed, (c) every other byte preserved end-to-end through
  `serialize → parse → serialize`.
- **Phase 8b — "Save as template" dialog**. Reuses
  `<annot-dialog>` for name + description + tags input;
  writes to `Templates/<name>.annot.html` via the active
  store's `saveDocument`. Original editor session unaffected.
- **Phase 8c — `<annot-template-picker>` component**.
  User-templates section lists `Templates/` folder contents,
  lazy-narrowed by a streaming `<head>`-only parse so non-
  template files don't block first paint. Recently-used chips
  (localStorage), one-click clone-and-open. Built-in section
  stubbed (Phase 9 fills it).
- **Phase 8d — File-manager "New" split button**. Default
  action "New blank document"; flyout offers "From template…".
  Editor's File menu (when no doc open) reuses the same picker.
- BrowserStore inherits everything for free (Phase 6a already
  shipped the `StorageWithDocuments` capability + path-keyed
  saving; templates are just `.annot.html` files at a
  convention path).
- Storybook coverage for: empty picker, populated user-templates
  section, recently-used chips, save-as-template dialog states.

### Phase 9 — Templates: built-in starter templates for manuals

- Hand-author 3 starter `.annot.html` files under
  `packages/doc/templates/`: `manual.annot.html`,
  `feature-guide.annot.html`, `procedure.annot.html`. Authoring
  done in Annot itself against the Phase 6 BrowserStore (i.e.
  the v1 doc shell is the canonical authoring surface — the
  resulting bytes get committed verbatim).
- Each template carries the template markers, English
  bracketed-placeholder copy (`[Title]` / `[Add an overview
  here]` / `[Section heading]` / etc.), and a generic
  placeholder image block (small dashed-border SVG with
  centered "Drop screenshot here" text — same SVG reused
  across all three).
- New Tier A export from `@ingcreators/annot-doc`:
  `BUILTIN_TEMPLATES: readonly { id, source: string }[]` — sources
  loaded via Vite `?raw` imports for browser hosts, plain
  `fs.readFile` for Node tests. Pre-baked thumbnail per starter
  shipped alongside as a tiny PNG to render in the picker without
  parsing the source first.
- `<annot-template-picker>`'s built-in section populates from
  `BUILTIN_TEMPLATES`. Each entry carries a "Built-in" pill;
  click → clone + open (same code path as user templates,
  source is the in-memory string).
- "Save as my template" right-click action on built-in entries:
  clone the built-in source + open the save-as dialog →
  persists to user's `Templates/` folder. Verifies the same
  serialiser round-trip the user-authored path uses.
- Storybook + visual goldens for the 3 starters: light / dark /
  print views. The starter sources are themselves the test
  fixtures.
- No locale variants in this phase (English only); locale
  infrastructure deferred to v2 — see Forward-looking.

### Phase 10 — VSCode custom editor

- `*.annot.html` registers as a VSCode custom editor in
  `packages/vscode/`.
- Webview hosts `<annot-doc-shell>` against a `VSCodeStore`-backed
  document loader (already covers binary file IO via
  `vscode.workspace.fs`).
- Keyboard binding: `Ctrl+Shift+P` → "Annot: New document"
  → opens the template picker (built-in starters available
  immediately since they're package-resident).

### Phase 11 — Multi-slide PPTX export

- New `exportDocumentPptx(doc): Blob` in `@ingcreators/annot-render`.
- Each `ImageBlock` → one slide via existing
  `pptx-export` + `buildShapeXml`.
- Heading blocks → title slide for the section they introduce
  (configurable; default off).
- Reuses the shared OOXML builders from
  `_done/office-paste-shared-drawing-builder.md` / 
  `_done/pptx-export-shared-builder-finish.md`. No new XML emit.
- Wired into the `<annot-save-menu>`'s export-as flyout when the
  active document is `.annot.html`.

### Phase 12 — Markdown export (deferred to demand)

- Optional fast-follow if user demand is real. CommonMark output;
  ImageBlocks rendered as `![](data:image/svg+xml;base64,…)` for
  self-contained single-file output, OR as references to standalone
  `.annot.svg` files in a sibling directory for repo-friendly output
  (user-selectable at export time).

### Phase 13 — Polish + plugin documentation

- Auto-numbering of headings / figures (opt-in via
  `DocProperties.numbering`).
- Cross-reference syntax `@image-block-id` → "図 N" rendered both
  in editor + standalone view.
- `docs/plugin-api/documents.md` — how plugins register custom
  block types in v2 (forward-looking; v1 doesn't ship this yet).
- `docs/plugin-api/storage.md` extended with the
  `StorageWithDocuments` capability.

### Out of scope for v1 (deferred)

- **PDF export.** Browser print → PDF works today; native PDF is a
  separate plan if demand is real.
- **Tables.** Common in manuals but require substantial editor UI;
  v2.
- **Footnotes / endnotes.** v2.
- **Embedded video / interactive elements.** Conflicts with the
  "no JS to view" property; never planned.
- **Real-time multi-user collaboration.** Belongs in `annot-cloud`
  per [`oss-cloud-split.md`](./oss-cloud-split.md), not in the
  on-disk format.
- **Inline image editing (no modal).** Prove the modal flow first;
  promote to inline if the workflow demands it.

## Verification

- **Round-trip byte equivalence** — golden corpus in
  `packages/doc/test/fixtures/`; CI test asserts
  `serialize(parse(bytes)) === bytes` for every fixture.
- **Self-contained viewing** — Storybook story for each fixture
  rendered with its inline `<style>` only (no Annot CSS); visual
  match against a hand-checked screenshot.
- **Editor mount + edit + save round-trip** — Vitest test that
  parses a fixture, mounts `<annot-doc-shell>` against it,
  programmatically edits one paragraph + one image block, saves,
  re-parses, asserts the edit landed without disturbing other
  blocks.
- **Cross-host parity** — same fixture loaded in PWA / VSCode /
  Desktop produces identical edit behaviour. Manual smoke for
  Phase 6 / 10 PRs.
- **Headless purity** — `packages/doc/src/headless.test.ts`
  walks `require.cache` after importing every documented Tier A
  subpath; fails if `host-ui` / `editor` / `render` showed up.
- **Standalone SVG extraction** — for any image block in a
  fixture, the embedded SVG passes the existing
  `validateAnnotationSvg` check from
  `@ingcreators/annot-core` and parses as a standalone
  `.annot.svg` without modification.
- **Template clone integrity** — clone a fixture template, save
  the result, parse the saved document, assert: template markers
  absent (`data-annot-doc-template`, `<meta name="annot-template">`,
  `template` sub-object in metadata sidecar); every block ID +
  image ID changed; every other byte preserved (caption text,
  embedded image bytes, prose, document properties, block order).
- **Picker performance** — fixture with 100 non-template
  `.annot.html` files in `Templates/` folder; assert
  `<annot-template-picker>` first paint completes within 200ms
  via the streaming `<head>`-only parse path (no full
  deserialise of non-templates).
- **Built-in starter validity** — each of the 3 starters
  (`manual` / `feature-guide` / `procedure`) parses cleanly,
  carries the template markers, clones to a marker-stripped
  document, and round-trips through `serialize ∘ parse`
  byte-for-byte. Ran as part of the `@ingcreators/annot-doc`
  test suite, so a future edit to a starter file fails CI if
  it accidentally introduces non-canonical bytes.
- **Built-in starter visual goldens** — Storybook captures of
  each starter rendered in light / dark / print, refreshed
  whenever the source files change. Reviewer signs off on the
  visual change in the PR.
- **"Save as my template" round-trip** — clone a built-in
  starter via the "Save as my template" action, persist to
  `Templates/`, list `Templates/`, assert the saved file
  appears in the picker's user-templates section (not the
  built-in section) with a fresh ID + correct name.

## Migration notes

- **No data migration needed for existing users.** Pre-Phase-6
  state has no `.annot.html` files; Phase 6 introduces the format
  and every save creates `data-annot-doc-version="1"` from day
  one.
- **Forward compatibility.** Future schema bumps follow the same
  pattern as `data-annot-version` for SVG: parser is defensive
  against unknown versions, save stamps the latest. The
  `headers/blocks` allow-list grows in v2; v1 readers presented
  with a v2 file with unknown blocks render the unknown block
  as an opaque `<aside>` placeholder ("This block requires a
  newer version of Annot").
- **`.annot.html` files committed to a repo render in GitHub's
  HTML preview today** without any GitHub-side changes —
  `<style>`-only inline CSS is supported. This is by design:
  the `github-integration.md` plan can layer on top of
  `.annot.html` without negotiating with GitHub.

## Forward-looking notes

- **Headless authoring from Playwright / CI.** Phase 1's Tier A
  parser/serialiser is callable from Node, so a CI step can
  programmatically assemble a `.annot.html` from
  `.annot.svg` files plus markdown prose. This unblocks the
  "auto-publish run results" workflow in the
  [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md) Playwright
  integration thread.
- **Plugin block types (v2).** The block discriminated union is
  closed at v1 deliberately — opening it to plugins requires
  freezing the editor-side render contract (custom toolbars,
  serialisation hooks). Once v1 ships and we have one or two
  candidate plugins (e.g. annot-cloud's "approval signature"
  block), v2 lifts the closed-union assumption.
- **Template variables / placeholders (v2).** v1 is structural
  copy only. v2 candidate: `{{title}}`, `{{date}}`,
  `{{author}}`, `{{custom-prompt}}` interpolation when cloning.
  Requires a small Mustache-style templating engine in Tier A
  (`renderTemplate(doc, vars): AnnotDocument`) plus a "Fill
  template" dialog before opening the cloned doc, prompting the
  user for each declared variable. Variable declarations live
  in the `template` sub-object of the metadata sidecar so they
  round-trip through the existing parser without schema bumps.
- **Locale variants of built-in starters (v2).** v1 ships the 3
  starters (`manual` / `feature-guide` / `procedure`) in English
  only. v2 adds Japanese first (matches the primary developer
  locale) and other-locale variants on demand under
  `packages/doc/templates/<id>.<locale>.annot.html`, with the
  picker resolving locale via a per-host setting that defaults
  to `navigator.language` and falls back to English. The first
  locale addition also stands up the locale-resolution helper
  as a reusable Tier A utility — no other part of the app has
  locale infrastructure today, so this is genuinely new ground;
  scoping it to templates first contains the blast radius.
- **More built-in starters (v2+).** The v1 trio is intentionally
  small. Adding a starter is one hand-authored file + one entry
  in `BUILTIN_TEMPLATES` — promote a user-favourite from the
  community once usage data + feedback indicate which manual
  shapes are actually missing.
- **Plugin-registered templates (v2).** Plugin-host extension —
  plugins call `host.registerTemplate({ id, name, source: () =>
  Promise<string> })`. Plugin-supplied templates appear in the
  picker alongside built-ins with a small "from plugin" badge.
  Useful for `annot-cloud`'s "team template library" feature:
  plugin-registered templates aren't duplicated into the user's
  `Templates/` folder, so updates pushed by the plugin reach
  every consumer of "New from template" without a sync step.
- **`oss-cloud-split.md` boundary.** The on-disk format, the v1
  editor, the user-authored template flow, AND the bundled
  starter templates all live in OSS. Commercial-only behaviour
  candidates living above the format: hosted team template
  libraries, template approval workflows, scheduled exports,
  Confluence / Notion sync. None of those touch the file format
  itself.
