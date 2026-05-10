# Annot HTML document format

> **Status:** Version **1**, frozen by Phase 0 of
> [`docs/plans/annot-html-document.md`](./plans/annot-html-document.md).
> The block vocabulary, root markers, `data-*` attribute set,
> canonicalisation rules, and allow-listed HTML elements documented
> below are the contract for v1 readers and writers. Phases 1+ may
> add tests, helpers, or UI; they MUST NOT change the on-disk shape
> of v1 files. Future format changes go through a `data-annot-doc-version`
> bump (see [Version history](#version-history)).

This document describes the HTML representation Annot uses for
multi-image manual documents — the `.annot.html` file format.
Companion to [`docs/svg-format.md`](./svg-format.md): an
`.annot.html` document carries one or more `.annot.svg` images
inline, plus surrounding prose. See
[`PRODUCT_DIRECTION.md`](../PRODUCT_DIRECTION.md) for the strategic
context.

## Overview

An Annot HTML document is a **single self-contained HTML file**
that satisfies two contracts simultaneously:

1. **Browser-view contract.** Opening the file in any modern
   browser shows a correctly-formatted manual / runbook / report
   without executing JavaScript and without fetching any external
   resource. CSS, fonts, and images are all inline.

2. **Editor contract.** Loading the file into Annot's document
   shell yields a fully editable block document. Every image
   block reveals a complete `.annot.svg` document the existing
   editor can mount; every text block round-trips through the
   editor's rich-text infrastructure.

The two contracts share one DOM tree. Editor-mode metadata rides
on `data-*` attributes and one JSON sidecar — invisible to the
browser-view contract because browsers ignore unknown data-*.

Round-tripping goal (mirror of the SVG format): read → no-op
edit → write produces a byte-identical file. The
canonicalisation rules below are the contract that makes this
guarantee testable byte-for-byte.

## Top-level structure

```html
<!doctype html>
<html data-annot-doc-version="1" lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="annot-document" content="1">
    <title>Document title</title>
    <!-- optional: <meta name="viewport"…>, generated <style>, etc. -->
  </head>
  <body>
    <article data-annot-doc>
      <!-- one or more blocks -->
    </article>
    <script type="application/annot+json" data-annot-doc-meta>{…}</script>
  </body>
</html>
```

The minimum viable v1 document has:

- `<!doctype html>` (lowercase, no XML-style attributes).
- `<html data-annot-doc-version="1" lang="…">` root.
- `<head>` containing at least `<meta charset="utf-8">`,
  `<meta name="annot-document" content="1">`, and `<title>`.
- `<body>` containing exactly one `<article data-annot-doc>` and
  exactly one `<script type="application/annot+json"
  data-annot-doc-meta>{…}</script>` sibling.
- The `<article>` has at least one block child (an empty
  document still has a single placeholder paragraph).

Any deviation from these requirements is an error; readers SHOULD
attempt best-effort parsing for forward compatibility but MUST flag
the file as not-canonical so a save can re-stamp it.

## Root attributes and detection markers

```html
<html data-annot-doc-version="1" lang="en">
```

| Attribute | Required | Purpose |
|---|---|---|
| `data-annot-doc-version` | **Yes** | Integer. Current `1`. Readers validate and migrate; missing → treat as v0 (pre-versioning). |
| `lang` | Yes | Document content locale (BCP-47, e.g. `"en"`, `"ja"`). The editor copies this to body for screen readers; browser-view CSS branches on `:root[lang]` for line-spacing tweaks. |
| `data-annot-doc-template` | No | Present (`"1"`) only on template documents. See [Template markers](#template-markers). |

Detection rules — both must pass for editor-mode entry:

1. File extension is `.annot.html` (or the legacy `.annot.htm`).
2. Parsed root has `data-annot-doc-version` AND
   `<meta name="annot-document" content="1">` is present in
   `<head>`.

A file with only the extension is treated as a stranger HTML file:
Annot offers a one-shot "import as document" that runs a best-effort
heuristic parse. A file with the markers but a wrong / missing
version triggers migrate-on-save: parse what we can, stamp the
current version on the next save.

## Block vocabulary

Every block is a direct child of `<article data-annot-doc>`. Each
block carries `data-annot-block="<kind>"` to disambiguate; readers
MUST NOT infer block kind from tag alone (a future v2 may overload
tags for different block kinds).

| Block kind | Tag | Role |
|---|---|---|
| `heading` | `<h1>` / `<h2>` / `<h3>` | Section heading (3 levels). |
| `paragraph` | `<p>` | Prose paragraph. |
| `list` | `<ul>` or `<ol>` | Bulleted or numbered list. |
| `code` | `<pre>` containing `<code>` | Preformatted code block. |
| `quote` | `<blockquote>` | Quoted passage (one or more inner paragraphs). |
| `callout` | `<aside>` | Tone-coloured callout (info / warn / note). |
| `divider` | `<hr>` | Horizontal rule. |
| `image` | `<figure>` containing `<svg>` + optional `<figcaption>` | Annotated screenshot. |

### `heading`

```html
<h1 data-annot-block="heading" data-level="1">Section title</h1>
<h2 data-annot-block="heading" data-level="2">Subsection</h2>
<h3 data-annot-block="heading" data-level="3">Sub-subsection</h3>
```

- Tag (`<h1>` / `<h2>` / `<h3>`) and `data-level` (`"1"` / `"2"` /
  `"3"`) MUST agree. Parser tolerates a mismatch and uses
  `data-level` as truth; serializer always re-emits both in sync.
- Inline content uses [Rich text](#rich-text) inline elements.
- Heading text is rendered AND extracted into the document's
  table-of-contents (per the doc shell's TOC drawer, Phase 3+).
- v1 caps levels at 3. Markdown's H4–H6 are deliberately omitted —
  manuals rarely need them and the cap simplifies the TOC layout.

### `paragraph`

```html
<p data-annot-block="paragraph">Plain prose with <strong>emphasis</strong>.</p>
```

- Inline content uses [Rich text](#rich-text) inline elements.
- An empty paragraph (`<p data-annot-block="paragraph"></p>`) is
  a valid placeholder; the editor renders it with a "type to start"
  affordance.

### `list`

Unordered (bulleted):

```html
<ul data-annot-block="list" data-list-style="disc">
  <li>First item</li>
  <li>Second item</li>
</ul>
```

Ordered (numbered):

```html
<ol data-annot-block="list" data-list-style="decimal">
  <li>First item</li>
  <li>Second item</li>
</ol>
```

- Tag (`<ul>` / `<ol>`) and `data-list-style` MUST agree on
  ordered-vs-unordered. Allowed values:
  - `<ul>` → `disc` (default), `circle`, `square`.
  - `<ol>` → `decimal` (default), `lower-alpha`, `upper-alpha`,
    `lower-roman`, `upper-roman`.
- `<ol>` MAY carry `data-start="<n>"` to start numbering at a
  non-1 value. Omitted = start at 1.
- `<li>` content uses [Rich text](#rich-text) inline elements.
  v1 does NOT support nested lists — the `<li>` body is a single
  rich-text run, not a sub-block tree. Nested lists land in v2 if
  demand justifies the editor complexity.

### `code`

```html
<pre data-annot-block="code" data-lang="bash"><code>npm install
npm run dev</code></pre>
```

- Always `<pre>` containing exactly one `<code>` child. No other
  children of `<pre>`.
- `data-lang` is OPTIONAL. When present, picks a syntax-highlighting
  hint for the browser-view CSS. Unknown values render as plain text.
- Newlines inside `<code>` are preserved verbatim (whitespace inside
  `<pre>` is significant per the HTML spec).
- `<code>` content is plain text only — no nested rich-text
  inline elements. Special characters (`<`, `>`, `&`) MUST be HTML-
  entity-escaped: `&lt;`, `&gt;`, `&amp;`.

### `quote`

```html
<blockquote data-annot-block="quote">
  <p>First paragraph of the quotation.</p>
  <p>Second paragraph.</p>
</blockquote>
```

- `<blockquote>` containing one or more `<p>` children.
- Inner `<p>` MUST NOT carry `data-annot-block` — only the outer
  `<blockquote>` is a block in the editor's eyes.
- Each inner `<p>` content uses [Rich text](#rich-text) inline
  elements.
- v1 does NOT support nested blocks inside a quote (no headings,
  lists, or images inside `<blockquote>`). v2 may relax this if the
  use case appears.

### `callout`

```html
<aside data-annot-block="callout" data-tone="info">
  <p>Informational note.</p>
</aside>
```

- `<aside>` with `data-tone` ∈ `info` (blue) | `warn` (orange) |
  `note` (neutral).
- One or more `<p>` children, same as quote.
- Reserved for short asides — the inner content shape mirrors quote
  intentionally so editor code paths are shared.

### `divider`

```html
<hr data-annot-block="divider">
```

- Void element. No content, no children.
- Renders as a horizontal rule in browser view.

### `image`

```html
<figure data-annot-block="image" data-annot-image-id="img-abc123">
  <svg data-annot-version="1" viewBox="0 0 800 600" width="800" height="600" xmlns="http://www.w3.org/2000/svg">
    <image href="data:image/png;base64,…" width="800" height="600"/>
    <g id="annotations">
      <!-- annotation elements per docs/svg-format.md -->
    </g>
  </svg>
  <figcaption>Caption text.</figcaption>
</figure>
```

- `<figure>` with `data-annot-image-id` (stable across edits;
  required for cross-references and per-image metadata in the
  JSON sidecar).
- Exactly one inline `<svg>` child carrying its own
  `data-annot-version`. The embedded `<svg>` is **a complete
  `.annot.svg` document** — a reader extracting just that subtree
  gets a valid standalone annotation file. See
  [`docs/svg-format.md`](./svg-format.md).
- Optional `<figcaption>` with [Rich text](#rich-text) inline
  content.
- `<figcaption>` placement: ALWAYS after the `<svg>` (HTML allows
  before or after; the canonical form fixes "after" for
  consistency).
- `data-annot-image-id` format: `img-` prefix + 8 to 32 chars from
  `[a-zA-Z0-9_-]`. Generated via `newIdB58` in
  `@ingcreators/annot-core/utils`. IDs MUST be unique within the
  document.

### Forward-compatibility for unknown blocks

A v1 reader presented with a v2 file containing an unknown
`data-annot-block` value:

- The parser preserves the entire subtree verbatim (raw outerHTML).
- The serializer re-emits the preserved subtree byte-for-byte.
- The editor renders an opaque placeholder block ("This block
  requires a newer version of Annot") in editor mode; browser view
  ignores the placeholder and renders the underlying HTML as-is.

This contract makes round-trip preservation mandatory: a v1 reader
MUST NOT silently drop or rewrite blocks it doesn't understand.

## Rich text

Inline rich text is allowed inside text-bearing blocks (heading,
paragraph, list `<li>`, callout / quote inner `<p>`, figcaption).

| Style | Tag |
|---|---|
| Bold | `<strong>` |
| Italic | `<em>` |
| Underline | `<u>` |
| Inline code | `<code>` (NOT to be confused with the `code` block kind) |
| Color override | `<span style="color: #abcdef;">` |
| Font family override | `<span style="font-family: 'Annot Sans';">` (one of the three logical tokens — see [`docs/multilingual-fonts-os-stack.md`](./plans/_done/multilingual-fonts-os-stack.md)) |
| Font size override | `<span style="font-size: 1.25em;">` |
| Hyperlink | `<a href="…" data-annot-link="external">…</a>` |

Rules:

- Nesting order is canonical: `<a>` outermost, then `<strong>`,
  `<em>`, `<u>`, `<code>`, `<span>` innermost. The serializer
  re-orders nested tags into this canonical sequence. Adjacent
  same-style runs merge.
- Empty inline elements (`<strong></strong>`) MUST NOT be emitted
  by the serializer; the parser tolerates and drops them.
- `<a href>` values are preserved verbatim; the serializer never
  rewrites URLs. `data-annot-link="external"` is the v1 only
  flavour; v2 may add `internal` for cross-references.
- `<span style="…">` uses the standard CSS property syntax. v1
  recognises `color`, `font-family`, `font-size` only — other
  declarations inside `style` get preserved verbatim by the
  serializer but the editor doesn't surface them in the UI.
- Characters `<`, `>`, `&` MUST be HTML-entity-escaped in text
  content. Quotation marks are NOT escaped in text (only inside
  attribute values).
- White-space normalisation: the parser collapses runs of inline
  whitespace to a single space (matching browser CSS behaviour).
  Leading/trailing whitespace inside an inline tag is dropped.
  The serializer emits exactly one space between adjacent words
  unless an explicit `&nbsp;` is present.

Newlines inside text-bearing blocks are NOT supported in v1 — to
break content into lines, use multiple paragraphs / list items.
The exception is `<code>` blocks where `<pre>` semantics make
newlines significant.

## Document metadata sidecar

```html
<script type="application/annot+json" data-annot-doc-meta>{"title":"…","author":"…","theme":"auto","maxWidth":"medium"}</script>
```

Located as the **last child of `<body>`**, immediately after the
`<article>`. Carries:

```ts
interface DocMeta {
  title: string;            // mirrors <title>; serializer enforces equality
  author?: string;
  theme?: "light" | "dark" | "auto";   // browser-view default theme
  maxWidth?: "narrow" | "medium" | "wide" | "full";  // content column
  template?: TemplateMeta;  // present iff this file is a template
  imageMeta?: Record<string, ImageMeta>;  // keyed by data-annot-image-id
  numbering?: NumberingMeta; // Phase 13 — opt-in heading / figure auto-numbering
}

interface TemplateMeta {
  name: string;             // shown in template picker
  description?: string;     // shown in template picker tooltip
  tags?: readonly string[]; // future filter UI
}

interface ImageMeta {
  alt?: string;             // for accessibility
  sourceUrl?: string;       // page URL the screenshot was captured from
  capturedAt?: string;      // ISO timestamp
  // forward-compat: PageMetadata-style additivity per docs/svg-format.md
}

interface NumberingMeta {
  headings?: boolean;       // h1/h2/h3 get hierarchical numbering (1., 1.1, 1.1.1)
  figures?: boolean;        // image-block figcaptions get "Figure N: " prefix
  figureLabel?: string;     // override "Figure " (e.g. "図 ", "Abbildung ")
}
```

Canonical JSON form rules:

- Compact (no whitespace between tokens). Byte stability matters
  more than diff readability for this metadata; documents are
  diffed via the editor anyway.
- Keys in alphabetical order at every nesting level.
- Strings use the standard JSON escape set; non-ASCII characters
  are emitted as raw UTF-8 (the file's encoding is UTF-8 already
  per `<meta charset="utf-8">`).
- Always present. An empty document still emits
  `<script type="application/annot+json" data-annot-doc-meta>{"title":""}</script>`
  (with whatever the actual title is — `title` is required).
- `<script>` content is treated as **opaque** by the HTML
  serializer: the JSON content is canonicalised separately by the
  JSON serializer, and the result is dropped between the
  `<script>` tags verbatim. No HTML-level whitespace or escaping.

The `<title>` element in `<head>` and the `title` field in the
JSON sidecar MUST match. The serializer enforces this on save; the
parser flags a mismatch as a warning and uses the JSON value as
the source of truth.

## Template markers

A document is a **template** when ALL THREE of these are true:

1. `<html data-annot-doc-template="1">` on the root.
2. `<meta name="annot-template" content="1">` in `<head>`.
3. The JSON sidecar contains a `template` sub-object with at least
   a `name` field.

Why three:

- `data-annot-doc-template` lives on root for fast detection
  inside the doc shell after a full parse
  (`document.documentElement.dataset.annotDocTemplate`).
- The `<meta>` tag lives in `<head>` for **streaming
  detection** — the template picker scans candidate files with a
  `<head>`-only parse to keep the first paint fast (target: <200ms
  for 100-file folders, locked in by Phase 7's verification).
- The JSON sub-object carries the actual template metadata
  (`name`, `description`, `tags`).

Phase 7 lands these markers in the parser / serializer; Phase 8
ships 3 bundled starter templates (`manual` / `feature-guide` /
`procedure`) that use them. See
[`docs/plans/annot-html-document.md`](./plans/annot-html-document.md)
for the lifecycle.

## Cross-references

A document can carry inline cross-references to image blocks via
`<span data-annot-figref="img-X">…</span>` elements inside any
inline-HTML field (heading, paragraph, list item, quote /
callout paragraph, image caption). The visible text inside the
span IS the rendered label — the standalone browser view shows
exactly what's between the tags, no JS required.

```html
<p data-annot-block="paragraph">
  See <span data-annot-figref="img-login">Figure 1</span> for the
  login screen.
</p>
```

The label is computed by walking the document's image blocks in
order and assigning 1-based numbers (same map the figure-
caption auto-numbering uses; see
[Numbering](#docmeta-numbering) above). The Tier B helper
`resolveFigureRefs(doc)` re-writes every span's text content to
match the current order — editor / save pipelines call it
before serialise so the saved bytes never carry stale labels.

Stale references — `<span data-annot-figref="img-X">` whose
`img-X` no longer exists in the document — render as
`Figure ?` (or whatever `numbering.figureLabel` is set to,
followed by the resolver's `staleLabel` option which defaults
to `?`). The placeholder makes the dangling reference visible
without breaking the export.

The label format mirrors the figure-caption prefix:

- Default: `"Figure 1"`, `"Figure 2"`, …
- With `meta.numbering.figureLabel = "図 "`: `"図 1"`,
  `"図 2"`, …
- Stale: `"Figure ?"` (or `"図 ?"`).

Phase 13b lands the resolver helper; the editor's `@<id>`
autocomplete that turns user-typed `@img-foo` into the
canonical `<span>` form is queued as a follow-up. Today the
spans need to be authored explicitly (via plugin / scripted
edit / direct HTML).

## Self-contained styling

A canonical save MAY (and Phase 2's `injectDocumentStyles` SHALL)
include a `<style>` block in `<head>` carrying:

- Logical font-family rules per `Annot Sans` / `Annot Serif` /
  `Annot Mono` (mirrors `injectLogicalFontStyles` in the SVG
  export path; per
  [`docs/plans/_done/multilingual-fonts-os-stack.md`](./plans/_done/multilingual-fonts-os-stack.md)).
- Base typography (line-height, heading scale, max content width
  scoped via the `maxWidth` doc property).
- Block-type rules keyed off `data-annot-block`.
- `@media print` page-break tweaks.
- `@media (prefers-color-scheme: dark)` colour swaps.

The `<style>` element's content is treated as **opaque** by the
serializer (same rule as the JSON sidecar): canonicalised
separately, dropped between the `<style>` tags verbatim. This
means a no-op edit preserves the style block byte-for-byte even
when the format spec evolves.

External `<link rel="stylesheet">` is **NEVER** emitted. The file
must remain self-contained; loss of network access (e.g.
double-click on a downloaded file with no DNS) MUST NOT degrade
the browser-view experience.

External fonts via `@font-face url(…)` are also forbidden. The
logical-family stacks resolve to OS fonts only.

## Allow-listed elements

This is the complete v1 element allow-list. Anything outside this
set is preserved verbatim by the parser/serializer (forward
compat) but not produced by the v1 writer.

In `<head>`:

- `<meta>` (charset, viewport, the `annot-document` /
  `annot-template` markers, plus any other plain meta tag)
- `<title>` (required, exactly one)
- `<link>` — only `rel="icon"` allowed; **no** stylesheets
- `<style>` (one, optional)

In `<body>`:

- `<article data-annot-doc>` (exactly one, required)
- `<script type="application/annot+json" data-annot-doc-meta>`
  (exactly one, required)

Inside `<article data-annot-doc>` (block level):

- `<h1>` / `<h2>` / `<h3>` with `data-annot-block="heading"`
- `<p>` with `data-annot-block="paragraph"`
- `<ul>` / `<ol>` with `data-annot-block="list"` (each containing
  one or more `<li>`)
- `<pre>` with `data-annot-block="code"` containing one `<code>`
- `<blockquote>` with `data-annot-block="quote"` containing one
  or more `<p>`
- `<aside>` with `data-annot-block="callout"` containing one or
  more `<p>`
- `<hr>` with `data-annot-block="divider"`
- `<figure>` with `data-annot-block="image"` containing one
  inline `<svg>` and an optional `<figcaption>`

Inside text-bearing nodes (inline level):

- `<strong>`, `<em>`, `<u>`, `<code>` (inline code, distinct from
  the `code` block kind)
- `<a href data-annot-link>`
- `<span style>` (CSS allow-list per [Rich text](#rich-text))
- `<br>` — disallowed in v1; use multiple paragraphs

Inside `<svg>`:

- The full `.annot.svg` element vocabulary per
  [`docs/svg-format.md`](./svg-format.md) is allowed. The HTML
  parser treats inline SVG as opaque — the SVG canonicalisation
  is independent (see [Embedded SVG](#embedded-svg)).

Inside `<style>` / `<script>`:

- Content is opaque; no further validation.

## Embedded SVG

Each image block contains a complete `.annot.svg` document. The
two formats are **independently versioned**:

- The HTML container's `data-annot-doc-version` describes the
  outer structure (block taxonomy, sidecar shape, canonicalisation
  rules).
- Each embedded `<svg>`'s `data-annot-version` describes the
  annotation language (per
  [`docs/svg-format.md`](./svg-format.md)).

A v1 `.annot.html` file with v1 SVGs is the v1 canonical state.
Future format evolution may bump either side independently; e.g.
a v1 doc with v2 SVGs is valid if the doc reader hands SVG content
opaquely to the SVG parser (the v1 doc parser treats `<svg>` as
opaque content already).

The HTML serializer preserves the bytes of every embedded `<svg>`
verbatim — it never re-formats SVG content. SVG canonicalisation
is the SVG serializer's responsibility.

## Canonicalisation rules

These rules make `serialize(parse(bytes)) === bytes` testable
byte-for-byte:

### Whitespace

- Indent: **2 spaces**, never tabs.
- Line ending: **LF** (`\n`), never CRLF.
- File ends with a single trailing LF.
- One blank line between sibling blocks at the article level.
- Inside multi-line block tags (e.g. `<figure>` containing
  `<svg>` + `<figcaption>`), nested children are indented one
  level relative to the opening tag.

### Attribute order

Within an element, attributes are emitted in this order:

1. `data-annot-block` (if present, always first).
2. `data-annot-image-id` (if present, second).
3. `data-annot-doc-version` / `data-annot-doc-template` (root
   only, after the above).
4. `data-annot-doc-meta` (sidecar marker).
5. Other `data-annot-*` attributes (alphabetical).
6. Other `data-*` attributes (alphabetical).
7. Standard HTML attributes (alphabetical).
8. `class` (always before `style`).
9. `style` (always last).

The parser ignores input attribute order and re-canonicalises on
save.

**Exception — `<meta>` elements.** The HTML idiom for `<meta>`
puts the type-determining attribute (`charset` / `name` /
`property` / `http-equiv`) before `content`. The canonical form
honours that idiom:

- `<meta charset="utf-8">`
- `<meta name="annot-document" content="1">`
- `<meta name="annot-template" content="1">`

For any other attribute on `<meta>` outside this list, fall back
to the alphabetical rule.

### Quote style

- HTML attribute values: always `"` (double quote). Single quotes
  inside attribute values get HTML-entity-escaped as `&apos;`
  (or `&#39;`), never quoted with `'`.
- Inline CSS values inside `style="…"`: CSS string literals
  use single quotes, e.g.
  `style="font-family: 'Annot Sans';"`.

### Void elements

HTML5 syntax: `<meta>`, `<hr>`, `<br>`, `<img>` etc. emit
**without** the trailing `/`. The XML-style `<hr />` form is
disallowed. The parser tolerates both forms; the serializer
always emits without.

### Casing

- Tag names: lowercase.
- Attribute names: lowercase (HTML-spec canonical).
- Doctype: `<!doctype html>` lowercase.
- Encoding declarations: `<meta charset="utf-8">` lowercase
  charset name.

### Entity escaping

- Inside text content: `<`, `>`, `&` use named entities (`&lt;`,
  `&gt;`, `&amp;`). All other characters emit as raw UTF-8.
- Inside attribute values: `"`, `<`, `>`, `&` use named entities
  (`&quot;`, `&lt;`, `&gt;`, `&amp;`). All other characters emit
  as raw UTF-8.
- Numeric character references (`&#x...;`) only emit when the
  named-entity form doesn't exist; this should be rare in
  practice (the named set covers everything we generate).

### Element-content treatment

- `<style>` content: opaque; preserved verbatim.
- `<script type="application/annot+json">` content: canonicalised
  by the JSON serializer, then dropped verbatim between the
  script tags.
- `<svg>` content: canonicalised by the SVG serializer, then
  dropped verbatim between the svg tags.
- `<pre><code>` content: text only; whitespace preserved
  verbatim.
- All other element content: parsed as HTML, re-serialised by the
  HTML serializer.

## Round-trip guarantee

The format contract is:

```
serializeDocument(parseDocument(bytes)) === bytes
```

…for every byte sequence `bytes` that satisfies the canonical
form. A no-op load + save MUST be byte-identical.

Phase 1's test suite enforces this via the golden corpus in
[`docs/annot-html-format-examples/`](./annot-html-format-examples/).
A future schema change that breaks an existing golden requires:

1. A `data-annot-doc-version` bump.
2. Migration logic in the parser (read v1, emit v2).
3. New goldens for v2.
4. The v1 goldens stay untouched (legacy verification).

The serializer is intentionally conservative: it does not "improve"
input it didn't generate (e.g. doesn't re-order attributes when
they're outside the canonical order — it canonicalises on every
save, and the test corpus is the source of truth for what
canonical means). Inputs that aren't canonical fail the
round-trip test by design — readers should normalise on first
save when encountering non-canonical input.

## Version history

### Version 1 (2026-05, current)

Initial versioned format. This document is the canonical reference
for v1 readers and writers. Block taxonomy, root markers, `data-*`
vocabulary, and canonicalisation rules described above.

Frozen by Phase 0 of
[`docs/plans/annot-html-document.md`](./plans/annot-html-document.md).
Phases 1+ may add tests, helpers, or UI; they MUST NOT change the
on-disk shape of v1 files.

### Version 0 (pre-versioning)

Reserved for HTML files written by Annot before
`data-annot-doc-version` existed. **There were none** — Annot
introduces `.annot.html` at v1. v0 exists only as a forward-compat
reader hint: a file with `<meta name="annot-document"
content="1">` but no `data-annot-doc-version` MUST be parsed
best-effort and stamped as v1 on first save.

## Examples

Three canonical examples ship in
[`docs/annot-html-format-examples/`](./annot-html-format-examples/):

| File | Coverage |
|---|---|
| `empty.annot.html` | Minimum viable document — required head metadata, one paragraph block, sidecar. |
| `with-image.annot.html` | Heading + paragraph + image block. Embedded SVG carries a 1×1 transparent PNG so the file stays small. |
| `mixed.annot.html` | One block of every v1 kind. Locks in the canonical order, attribute set, and whitespace rules byte-for-byte. |

These files ARE the v1 spec — Phase 1's parser / serializer test
runs `serialize(parse(bytes)) === bytes` against each. A future
PR that intentionally changes the canonical bytes touches the
goldens AND the format spec in the same change.

## Open questions

These didn't block the v1 spec freeze but are tracked here for
v2 consideration:

- [ ] **Per-image `PageMetadata`** — `docs/svg-format.md` mentions
  embedding `PageMetadata` (DOM elements captured alongside a
  screenshot) inside the SVG itself. v1 of the doc format puts it
  in the sidecar's `imageMeta[<id>]` map. Are there cases where
  per-image-block locality matters more than central JSON locality?
  Unclear before the Playwright integration ships.
- [ ] **Cross-references** — `@image-block-id` syntax for "see
  Figure N" pulls render. Mentioned in the plan's Phase 13
  (Polish). Open: does the source text store the raw `@id` or a
  resolved label? v1 format isn't committed either way.
- [ ] **Nested lists** — v1 disallows `<ul>` inside `<li>`. Manuals
  occasionally need nested numbering (e.g. legal-style 1.1 / 1.2);
  v2 candidate. Adds editor complexity around list-item rich-text
  vs. block content.
- [ ] **Tables** — fully out-of-scope for v1; queued as a v2
  follow-up plan if user demand surfaces.
- [ ] **Link target attribute** — v1 emits `<a href>` without
  `target` / `rel`. External links opening in a new tab require
  `target="_blank" rel="noopener"`; should this be canonical? The
  current default delegates to the user's browser preferences.

## See also

- [`PRODUCT_DIRECTION.md`](../PRODUCT_DIRECTION.md) — strategic
  reason for keeping the on-disk format portable.
- [`docs/svg-format.md`](./svg-format.md) — companion spec for
  the embedded `.annot.svg` images.
- [`docs/plans/annot-html-document.md`](./plans/annot-html-document.md) —
  multi-phase implementation plan.
- [`docs/annot-html-format-examples/`](./annot-html-format-examples/) —
  canonical golden fixtures.
- [`CLAUDE.md`](../CLAUDE.md) — operational checklist enforcing
  schema-break discipline.
