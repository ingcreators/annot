/**
 * @vitest-environment happy-dom
 *
 * Regression test for the "wrapper element collapses parent
 * flex layout" trap.
 *
 * Several Phase 4 / Phase 5 Lit elements wrap content the host
 * page lays out via flexbox:
 *
 *   - `<annot-editor-header>` inside `#editor-header`
 *     (`display: flex` row).
 *   - `<annot-editor-statusbar>` inside `#statusbar`
 *     (`display: flex` row, with a `.toolbar-spacer` that
 *     `flex: 1`s the tool name to the far right).
 *   - `<annot-editor-right-panel>` inside
 *     `#editor-right-panel` (`display: flex` column).
 *   - `<annot-file-manager-shell>` inside `#main-content`
 *     (`display: flex` column with a `flex: 1` body).
 *
 * Without `display: contents`, each Lit wrapper appears as a
 * single block-level child to the parent flex container,
 * which then sees only ONE flex item (the wrapper) and any
 * `flex: 1` rules inside become no-ops. The user-visible
 * symptom is the chrome collapsing — header items stacking
 * vertically, statusbar spacer not pushing the tool name to
 * the right, etc.
 *
 * `connectedCallback` on each affected element sets
 * `style.display = "contents"`, making the wrapper transparent
 * to layout. This test asserts that contract for every
 * element so a future refactor can't silently drop it.
 */

import { afterEach, describe, expect, it } from "vitest";
import "../gallery/file-manager-shell.js";
import "./editor-header.js";
import "./editor-statusbar.js";
import "@ingcreators/annot-editor-shell/right-panel";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Lit wrapper hosts — display: contents contract", () => {
  it.each([
    "annot-editor-header",
    "annot-editor-statusbar",
    "annot-editor-right-panel",
    "annot-file-manager-shell",
  ])("%s sets style.display='contents' on connect so parent flex sees its children", (tag) => {
    const el = document.createElement(tag);
    document.body.appendChild(el);
    expect(el.style.display).toBe("contents");
  });
});
