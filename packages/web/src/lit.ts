/**
 * Re-export of the Lit runtime + decorators under the
 * `@ingcreators/annot-web/lit` subpath.
 *
 * Plugin authors import from here so they don't take their own
 * `lit` dependency — Annot controls the version centrally, and
 * host + plugin code share the same `LitElement` identity
 * (`instanceof` checks work across the boundary).
 *
 * Introduced in Phase 0 of `docs/plans/lit-migration.md`.
 * Subsequent phases migrate built-in UI surfaces to Lit; those
 * internal modules import from here too so the single-version
 * invariant holds end-to-end.
 */

export {
  LitElement,
  css,
  html,
  nothing,
  render,
  svg,
  type CSSResultGroup,
  type PropertyValues,
  type TemplateResult,
} from "lit";
export { customElement, property, query, queryAll, state } from "lit/decorators.js";
export { unsafeHTML } from "lit/directives/unsafe-html.js";
