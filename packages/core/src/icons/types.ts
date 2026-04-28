/**
 * Tier A icon types for `@ingcreators/annot-core`.
 *
 * Phase 1 of `docs/plans/svg-icons-and-plugin-icon-spec.md`.
 *
 * `IconSpec` is the public, plugin-facing handle for "render this
 * icon here". Hosts (the toolbar, the sidebar, every panel header)
 * and plugins (storage backend chips, sidebar tabs, drawer
 * external-link rows) all describe their icons via the same
 * discriminated-union shape so the renderer routes builtins,
 * plugin-supplied SVG, and bundled image assets uniformly.
 *
 * This file is **pure types + value-level constructor helpers** —
 * no DOM access, no Element imports, no module-level side
 * effects. Importable in pure Node, jsdom, or the browser
 * unchanged. The Tier B registry in
 * `@ingcreators/annot-core/editor/icons/registry` (Phase 2) is
 * what binds `BuiltinIconId` to concrete SVG strings; this Tier A
 * file declares only the broad shape so downstream consumers
 * that don't want the registry as a value-level dependency
 * (rare; primarily plugin authors who only ever produce
 * `kind: "svg"` icons) can still type-check against `IconSpec`.
 *
 * The narrow union `BuiltinIconId = keyof typeof BUILTIN_ICONS` is
 * exported FROM the registry module, and re-exported by the icons
 * subpath barrel (`@ingcreators/annot-core/icons`) so plugin
 * authors who DO want compile-time autocomplete on builtin ids
 * can import it without dragging the registry's data graph in
 * unnecessarily — the registry's value side is tree-shakeable.
 */

/**
 * Identity of a host-shipped icon. The narrow string-literal union
 * is exported from `@ingcreators/annot-core/editor/icons/registry`
 * via `keyof typeof BUILTIN_ICONS`; this Tier A alias keeps the
 * structural shape (a string) so non-registry consumers can name
 * the type without importing the registry's data.
 *
 * Plugin authors should prefer the narrow union exported from the
 * `@ingcreators/annot-core/icons` subpath (which re-exports the
 * registry's `BuiltinIconId`) for compile-time autocomplete — at
 * runtime the two are identical (both are `string`).
 */
export type BuiltinIconId = string;

/**
 * Plugin-friendly icon descriptor. Discriminated on `kind`:
 *
 * - `"builtin"` — refers to a host-provided registry icon by id.
 *   Cheapest at runtime (no parsing, no sanitisation); recommended
 *   whenever a suitable host icon exists. Plugins cross-check the
 *   available ids by importing `BUILTIN_ICON_IDS` from the
 *   registry; passing an id that isn't in the registry is treated
 *   as "no icon" by the renderer (returns the empty string / null).
 *
 * - `"svg"` — raw inline SVG markup. Use for plugin-owned
 *   logomarks not present in the host registry. Sanitised at
 *   render time (Phase 3 allow-list walker — see
 *   `docs/plans/svg-icons-and-plugin-icon-spec.md`). Plugin
 *   authors MUST author stand-alone `<svg>` elements (no
 *   surrounding HTML); the renderer refuses anything that doesn't
 *   parse as a single SVG root.
 *
 * - `"url"` — same-origin or `data:` URL pointing at an SVG asset.
 *   Used by plugins that ship their logomark as a static asset
 *   bundled with the plugin's JS. The host renders this via
 *   `<img src=…>` so the SVG is sandboxed (no CSS / script access
 *   to the host page). External-origin URLs are rejected at
 *   render time.
 */
export type IconSpec =
  | { readonly kind: "builtin"; readonly id: BuiltinIconId }
  | { readonly kind: "svg"; readonly svg: string }
  | { readonly kind: "url"; readonly url: string };

/** `IconSpec` constructor for a host registry id. Equivalent to
 *  writing `{ kind: "builtin", id }` inline; the helper makes
 *  call sites less noisy when an `IconSpec` is built dynamically
 *  (e.g. mapping a list of names to specs). */
export function builtinIcon(id: BuiltinIconId): IconSpec {
  return { kind: "builtin", id };
}

/** `IconSpec` constructor for raw plugin-supplied SVG markup. The
 *  string is NOT validated here — sanitisation happens at render
 *  time (Phase 3). */
export function svgIcon(svg: string): IconSpec {
  return { kind: "svg", svg };
}

/** `IconSpec` constructor for a same-origin or `data:` URL. The
 *  URL is NOT validated here — the renderer enforces same-origin
 *  / `data:`-only at render time. */
export function urlIcon(url: string): IconSpec {
  return { kind: "url", url };
}

/** Type guard for the `"builtin"` arm. Useful in renderer / plugin
 *  code that needs to pick a different rendering strategy per
 *  kind. */
export function isBuiltinIcon(
  spec: IconSpec,
): spec is { readonly kind: "builtin"; readonly id: BuiltinIconId } {
  return spec.kind === "builtin";
}

/** Type guard for the `"svg"` arm. */
export function isSvgIcon(
  spec: IconSpec,
): spec is { readonly kind: "svg"; readonly svg: string } {
  return spec.kind === "svg";
}

/** Type guard for the `"url"` arm. */
export function isUrlIcon(
  spec: IconSpec,
): spec is { readonly kind: "url"; readonly url: string } {
  return spec.kind === "url";
}
