/**
 * Canonical HTML-attribute whitelist for `ElementNode.attributes` —
 * Phase 7 of `docs/plans/metadata-unification.md`.
 *
 * Every ElementTree producer captures the SAME attribute set:
 * the extension's MAIN-world walker, the Playwright
 * `attachAttributes` adapter, and the product-docs fixture /
 * migrator all derive from this constant (the walker's copy is
 * inlined — `executeScript({func})` cannot import — and guarded by
 * a behavioural symmetry test in `element-tree-walker.test.ts`).
 *
 * Selection principle: **`attributes` carries element shape (HTML
 * attributes), `states` carries element state (ARIA / dynamic)** —
 * aria-* never appears in `attributes`; producers encode those as
 * `states` tokens instead.
 *
 * - Identity / locator hooks: `id`, `data-testid`, `data-test-id`,
 *   `name` — `data-testid` is the i18n-stable match key the
 *   living-spec roadmap designates; locator-building consumers
 *   (MCP `resolve-locator`, future codegen) resolve against it at
 *   use time. There is deliberately NO persisted `locator` field
 *   on `ElementNode` (see the plan's Phase 7 decision log).
 * - Navigation: `href`.
 * - Form shape: `type`, `placeholder`, `value`, `required`,
 *   `disabled`, `readonly`, `checked`, `maxlength`, `minlength`,
 *   `pattern`, `min`, `max`, `step` — what a screen-specification
 *   table documents per control.
 */
export const ELEMENT_TREE_ATTR_WHITELIST: readonly string[] = [
  "id",
  "name",
  "type",
  "href",
  "placeholder",
  "value",
  "required",
  "disabled",
  "readonly",
  "checked",
  "maxlength",
  "minlength",
  "pattern",
  "min",
  "max",
  "step",
  "data-testid",
  "data-test-id",
];
