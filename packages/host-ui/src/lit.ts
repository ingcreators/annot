/**
 * Re-export of the Lit runtime + decorators under the
 * `@ingcreators/annot-host-ui/lit` subpath.
 *
 * Phase 2b of `docs/plans/_done/vscode-extension-host.md` — moved
 * here from `packages/web/src/lit.ts` so that built-in Lit
 * components live in the host-neutral shell. The PWA's
 * `@ingcreators/annot-web/lit` subpath continues to exist as a
 * thin re-export of this file so plugin authors don't have to
 * update their imports.
 *
 * Single-version invariant: every consumer (host + plugin + shell
 * internals) imports `lit` through this module, so `LitElement`
 * has one identity at runtime and `instanceof` checks work across
 * the boundary.
 */

export {
  type CSSResultGroup,
  css,
  html,
  LitElement,
  nothing,
  type PropertyValues,
  render,
  svg,
  type TemplateResult,
} from "lit";
export { customElement, property, query, queryAll, state } from "lit/decorators.js";
export { unsafeHTML } from "lit/directives/unsafe-html.js";
