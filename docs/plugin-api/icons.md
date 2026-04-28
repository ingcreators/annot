# Plugin API: Icons

> **Audience:** plugin authors targeting the
> `@ingcreators/annot-web` plugin host. If you're building host
> code (built-in panels / sections), the same `IconSpec` type
> applies — this doc focuses on the plugin-side authoring story.

Every plugin-facing icon hand-off in Annot uses a single
discriminated-union descriptor — `IconSpec` — exported from
`@ingcreators/annot-core` (and the `@ingcreators/annot-core/icons`
subpath for plugin authors who want autocomplete on builtin id
literals). One shape covers three cases:

```ts
import type { IconSpec } from "@ingcreators/annot-core";

type IconSpec =
  | { readonly kind: "builtin"; readonly id: BuiltinIconId }   // host registry icon
  | { readonly kind: "svg"; readonly svg: string }             // raw plugin-supplied SVG
  | { readonly kind: "url"; readonly url: string };            // bundled-asset URL
```

The host renders the descriptor through `<annot-icon>` (Lit) or
`renderIconHtml(spec)` (string). Whichever way you compose, the
plugin-supplied content goes through the
`@ingcreators/annot-core` sanitiser before it reaches the DOM —
`<script>`, `on*` attributes, `style=`, external `<image>` /
`<use href>`, and `<foreignObject>` are all stripped.

## Where icons surface

Three plugin-API fields take an `IconSpec`:

| Surface | Field | Where | Sample |
|--|--|--|--|
| Sidebar storage chip (plugin backend) | `StorageRegistration.icon` | `ctx.registerStorage(...)` | `{ kind: "builtin", id: "cloud" }` |
| Sidebar tab (Views section) | `SidebarTab.icon` | `ctx.addSidebarTab(...)` | `{ kind: "builtin", id: "history" }` |
| Drawer external-link row | `ExternalLink.icon` | return value of an `addExternalLinkSource` callback | `{ kind: "builtin", id: "open_in_new" }` |

All three fields are optional; the host falls back gracefully
when a descriptor is omitted (e.g. tabs use the `view_module`
glyph as a generic stand-in).

## Quick start

### Builtin host icon

```ts
import { builtinIcon } from "@ingcreators/annot-core";

ctx.addSidebarTab({
  id: "team-library",
  label: "Team library",
  icon: builtinIcon("groups"),
  priority: 20,
  onClick: () => { /* route to your view */ },
});
```

`builtinIcon(id)` is an inline shorthand for
`{ kind: "builtin", id }`. The full list of built-in ids ships in
the registry (`packages/core/src/editor/icons/registry.ts`); typo
protection comes from the narrow `BuiltinIconId` literal union
exported from `@ingcreators/annot-core/icons`.

**Reserved id namespaces.** Plugin authors should not assume the
following dotted prefixes will keep their current shape; they are
host-internal and may grow / change without an API-version bump:

| Prefix | Owner | What lives here |
|--|--|--|
| `arrow.*`, `counter.*`, `shape.*` | host toolbar | Tool-variant glyphs that mirror toolbar button states. |
| `brand.*` | host storage chips | Third-party trademarks (currently the GitHub Mark) bundled verbatim from the vendor's published asset, used to identify the corresponding storage backend per the vendor's brand guidelines. **Plugin-supplied storage backends MUST NOT reuse `brand.github` for non-GitHub backends** — the mark belongs to GitHub, Inc. and reusing it would mislead users. Bring your own logomark via `kind: "svg"` or `kind: "url"` instead. |

### Plugin-owned SVG (logomark)

```ts
import { svgIcon } from "@ingcreators/annot-core";

ctx.registerStorage({
  mode: "annot-cloud",
  label: "Annot Cloud",
  icon: svgIcon(/* stand-alone <svg> string */ `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 12 a8 8 0 1 1 16 0 a8 8 0 0 1 -16 0Z"/>
      <path d="M9 12 l2 2 4-4"/>
    </svg>
  `),
  priority: 25,
  connect: async (...) => { /* ... */ },
  restore: () => null,
  status: () => ({ connected: true, label: "My team" }),
});
```

Authoring rules for `kind: "svg"` icons:

- Wrap your glyph in a stand-alone `<svg>` root (no surrounding
  HTML). The sanitiser refuses anything that isn't a single
  `<svg>` root.
- Use `viewBox="0 0 24 24"` (or the Material `viewBox="0 -960 960 960"`
  if you're matching the host palette) so size flows through
  `<annot-icon>`'s `1em` defaults consistently.
- Prefer `currentColor` for fill / stroke so the icon picks up
  the surrounding text colour and theme switching works
  automatically. Hard-coded colour values are passed through the
  sanitiser unchanged but make your icon ignore the host theme.
- Set `aria-hidden="true"` on the root (the host adds it if you
  forget). Never include `<title>` / `<desc>` for screen-reader
  text — wrap the parent button in `aria-label` instead.

### Bundled SVG asset

```ts
import { urlIcon } from "@ingcreators/annot-core";

ctx.registerStorage({
  // ...
  icon: urlIcon("/plugins/annot-cloud/logo.svg"),
});
```

`kind: "url"` icons render through `<img>` (sandboxed away from
host CSS / JS). Two URL shapes are accepted:

- **Same-origin** paths (relative `./logo.svg`, absolute
  `/plugins/.../logo.svg`).
- **`data:image/svg+xml`** URLs.

Anything else — `https://`, `javascript:`, `data:text/html` — is
rejected at render time and the icon slot renders empty.

Trade-off: because URL-kind icons are sandboxed `<img>` content,
they don't pick up theme colour through `currentColor`. If you
need theme-aware icons, ship them as `kind: "svg"` instead.

## Sanitiser allow-list

For plugin-supplied SVG, the renderer copies elements + attributes
from this allow-list and drops everything else:

| Allowed elements | Allowed attributes (global) |
|--|--|
| `svg`, `g`, `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon`, `defs`, `linearGradient`, `radialGradient`, `stop`, `symbol`, `use`, `title`, `desc`, `text`, `tspan` | `id`, `class`, `viewBox`, `preserveAspectRatio`, `fill`, `fill-rule`, `fill-opacity`, `stroke`, `stroke-width`, `stroke-linecap`, `stroke-linejoin`, `stroke-dasharray`, `stroke-dashoffset`, `stroke-opacity`, `stroke-miterlimit`, `transform`, `opacity`, `color`, `aria-hidden`, `aria-label`, `role`, `width`, `height`, `x`, `y`, `x1`, `y1`, `x2`, `y2`, `cx`, `cy`, `r`, `rx`, `ry`, `d`, `points`, `offset`, `stop-color`, `stop-opacity`, `gradientUnits`, `gradientTransform`, `spreadMethod`, `fr`, `fx`, `fy`, `text-anchor`, `dominant-baseline`, `font-size`, `font-family`, `font-weight`, `letter-spacing`, `dx`, `dy` |

Element-specific carve-outs:

- `<use href>` / `<use xlink:href>` accept ONLY internal `#id`
  fragments. External URLs and `javascript:` / `data:` schemes
  are rejected.

Always rejected (regardless of element / attribute):

- `<script>`, `<style>`, `<a>`, `<image>`, `<foreignObject>`
- All `on*` event-handler attributes (`onclick`, `onload`, …)
- All `style=` attributes (CSS injection vector)
- `javascript:`, `vbscript:`, `data:text/html` URL schemes

Input over 64 KB is rejected outright.

If your SVG ends up rendering empty, the sanitiser dropped the
markup. Common gotchas:

- Wrapping `<svg>` inside a `<div>` / `<span>` (drop the wrapper —
  the renderer expects an `<svg>` root).
- Authoring with a default-namespace-less `<svg>` (the parser
  treats it as HTML; add `xmlns="http://www.w3.org/2000/svg"`).
- Using uppercase tags (`<Svg>`, `<G>`) — the parser is case-
  sensitive in the SVG namespace.

## Composing into UI yourself

If your plugin renders its own UI (right-panel section,
drawer section, custom flyout), you can use `<annot-icon>`
directly — it's defined as a global custom element so any
plugin-side Lit template can use it without local registration:

```ts
import { html } from "@ingcreators/annot-web/lit";
import { builtinIcon } from "@ingcreators/annot-core";

const tmpl = html`
  <button>
    <annot-icon .spec=${builtinIcon("share")}></annot-icon>
    Share
  </button>
`;
```

For non-Lit DOM construction, use the imperative helper:

```ts
import { createBuiltinIcon } from "@ingcreators/annot-web/ui/annot-icon-imperative";

const btn = document.createElement("button");
btn.appendChild(createBuiltinIcon("share"));
btn.append(" Share");
```

## Testing icons

The renderer + sanitiser are pure (modulo `DOMParser`); your
plugin can import `renderIconHtml(spec)` from
`@ingcreators/annot-core` directly in a Vitest test (with the
`happy-dom` environment) and assert the produced markup.

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderIconHtml, svgIcon } from "@ingcreators/annot-core";

it("my plugin's logomark survives sanitisation", () => {
  const out = renderIconHtml(svgIcon(MY_LOGO));
  expect(out).toContain("<svg");
  expect(out).toContain("M0 0h24v24H0z"); // your specific path data
});
```

## Migrating from a pre-Phase-5 plugin

If your plugin was written against the pre-Phase-5 API where
icon fields were plain `string` Material-symbols ligature names,
the migration is one find/replace per descriptor:

```diff
  ctx.addSidebarTab({
    id: "...",
    label: "...",
-   icon: "history",
+   icon: { kind: "builtin", id: "history" },
    ...
  });
```

The narrow `BuiltinIconId` union catches typos (it's the literal
union of every key in the host registry — see
`@ingcreators/annot-core/icons` for the full list). Anything you
were passing that isn't in the union is either a typo or a glyph
name that no longer exists in upstream Material Symbols
(see the alias table in
`scripts/extract-material-symbols.mjs`); for the latter, the
host registry already maps the legacy name to the upstream
replacement under the hood.

## Forward-looking

- **Storybook icon gallery.** Adding one auto-generates the full
  list from `BUILTIN_ICON_IDS` — flagged as an optional
  follow-up in the Phase 7 plan archive.
- **Custom SVG namespaces.** The sanitiser today strips anything
  not in the SVG namespace. If a plugin needs MathML / HTML
  inside the icon, file a request — the allow-list is small and
  centrally defined so per-element opt-ins are cheap.
- **Per-icon CSS hooks.** `<annot-icon>` exposes its inner
  `<svg>` / `<img>` for parent-scoped styling
  (`annot-icon > svg`). If you need a stable class on the inner
  element for plugin-supplied CSS, the icon ships a
  `.annot-icon-img` class on the URL-kind `<img>`; we can add
  the SVG side equivalent on request.
