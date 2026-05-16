/**
 * `createSettingsButton` — toolbar / header button that opens the
 * app-level Settings dialog. Replaces the four direct theme-toggle
 * buttons (gallery header, image-editor toolbar, image-editor
 * header, HTML-doc header) so theme switching lives behind a
 * single icon alongside future settings rows.
 *
 * Call sites pass their own className so the button visually
 * matches the surrounding chrome — the previous theme-toggle did
 * the same and we preserve the convention (`"toolbar-btn"` for
 * the editor toolbar, `"header-info-btn"` for header strips,
 * `"annot-doc-header-action"` for the doc-mode header).
 */

import { builtinIcon, renderIconHtml } from "@ingcreators/annot-core";
import { setTooltip } from "@ingcreators/annot-editor";

import { showSettingsDialog } from "./settings-dialog.js";

export function createSettingsButton(className = "toolbar-btn"): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  setTooltip(btn, "Settings");
  // The renderer returns a sanitised SVG string for builtin ids;
  // assigning to `innerHTML` is safe — the markup originates from
  // our own registry, not user input.
  btn.innerHTML = renderIconHtml(builtinIcon("tune"));
  btn.addEventListener("click", () => {
    void showSettingsDialog();
  });
  return btn;
}
