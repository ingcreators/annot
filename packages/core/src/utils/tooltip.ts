/**
 * Tooltip helpers.
 *
 * Annot uses a CUSTOM CSS tooltip (rendered via `::after` on hover)
 * instead of the browser's native `title` tooltip. Native tooltips
 * have three problems that make them wrong for a polished editor UI:
 *
 *   1. OS-dependent look — yellow-ish on Windows, gray on macOS, etc.
 *      Can't be themed to match the app.
 *   2. Fixed ~500 ms delay before appearance, unchangeable.
 *   3. OS positions them relative to the cursor, with no respect for
 *      accessibility-enlarged pointers — the cursor body often
 *      obscures the tooltip entirely.
 *
 * The fix industry-wide (Figma / Linear / Notion / VS Code / Miro /
 * etc.) is to skip `title` entirely and use a dedicated custom
 * tooltip. We do the same:
 *
 *   - `data-tooltip` attribute holds the text (read by the CSS
 *     `content: attr(data-tooltip)` rule in toolbar.css / editor.css).
 *   - `aria-label` mirrors the same text so screen readers still
 *     announce the control.
 *   - `title` is NOT set, so the browser shows no native bubble.
 *
 * `setTooltip(el, text)` applies both attributes in one place; use it
 * everywhere you'd previously write `el.title = "..."`.
 */

/** Configure a tooltip + accessible name on an element. Sets
 *  `data-tooltip` (styled tooltip content) and `aria-label`
 *  (screen-reader announcement), but intentionally does NOT set the
 *  `title` attribute — see the module header for why. Passing an
 *  empty string clears both attributes. */
export function setTooltip(el: Element, text: string): void {
  if (!text) {
    el.removeAttribute("data-tooltip");
    el.removeAttribute("aria-label");
    return;
  }
  el.setAttribute("data-tooltip", text);
  el.setAttribute("aria-label", text);
}

/** Read whatever tooltip text is currently set on an element. Checks
 *  `data-tooltip` first, then falls back to `aria-label`. Useful for
 *  debug / dynamic labels that need to query the current value. */
export function getTooltip(el: Element): string {
  return el.getAttribute("data-tooltip")
    || el.getAttribute("aria-label")
    || "";
}
