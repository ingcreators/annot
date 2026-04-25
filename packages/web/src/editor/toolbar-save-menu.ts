/**
 * Save / export dropdown for the editor toolbar. Builds an
 * `<annot-save-menu>` Lit element, anchors it to a host-supplied
 * trigger, and dispatches the chosen export format to the
 * appropriate core helper (`saveToFile`, `saveAsEditableImage`,
 * `downloadAsImage`, `exportPptx`).
 *
 * Extracted from `toolbar.ts` as Stage 3a-3 of
 * `docs/plans/pre-release-cleanup.md`. Mirrors the
 * context-object pattern established by the property-panel
 * renderer in 3a-2 — callers pass in only the canvas + filename
 * accessor the menu needs, no `Toolbar`-private state coupling.
 */

import {
  type CanvasManager,
  downloadAsImage,
  saveAsEditableImage,
  saveToFile,
} from "@ingcreators/annot-core";
import { exportPptx } from "@ingcreators/annot-core/editor/pptx-export";
import { isTauri } from "@ingcreators/annot-core/tauri-bridge";
import type { SaveMenuSelectDetail } from "./annot-save-menu.js";

/** Hooks the save menu needs from its host. */
export interface ToolbarSaveMenuContext {
  canvas: CanvasManager;
  /** Returns the current filename for the active document. May be
   *  `undefined` for ephemeral / new documents — the export helpers
   *  fall back to an auto-generated name in that case. */
  getCurrentFilename?: () => string | undefined;
}

/**
 * Open (or toggle-close) the save dropdown anchored below `anchor`.
 * Toggles: a second click on the same anchor closes the menu instead
 * of stacking another instance.
 */
export function openToolbarSaveMenu(
  anchor: HTMLElement,
  ctx: ToolbarSaveMenuContext,
): void {
  // Toggle: a second click on the arrow closes an open menu instead
  // of stacking another one underneath.
  const existing = document.querySelector(".save-dropdown-menu");
  if (existing) {
    existing.remove();
    return;
  }

  // Build the action map keyed on the menu-select detail id so the
  // Lit element can stay purely presentational while the orchestrator
  // owns the export-format dispatch.
  const actions: Record<string, () => void> = {
    svg: () => saveToFile(ctx.canvas, ctx.getCurrentFilename?.()),
    pptx: () => exportPptx(ctx.canvas),
  };
  const menu = document.createElement("annot-save-menu");
  const items: { id: string; label: string; description: string }[] = [
    { id: "svg", label: "Download SVG", description: "Editable vector format" },
  ];

  if (isTauri) {
    actions["jpg-editable"] = () =>
      saveAsEditableImage(ctx.canvas, "jpg", ctx.getCurrentFilename?.());
    actions["png-editable"] = () =>
      saveAsEditableImage(ctx.canvas, "png", ctx.getCurrentFilename?.());
    items.push(
      {
        id: "jpg-editable",
        label: "Save as JPG (re-editable)",
        description: "JPEG with embedded annotations",
      },
      {
        id: "png-editable",
        label: "Save as PNG (re-editable)",
        description: "PNG with embedded annotations",
      },
    );
  } else {
    actions["jpg-editable"] = () =>
      downloadAsImage(ctx.canvas, "jpg", ctx.getCurrentFilename?.());
    actions["png-editable"] = () =>
      downloadAsImage(ctx.canvas, "png", ctx.getCurrentFilename?.());
    items.push(
      {
        id: "jpg-editable",
        label: "Download JPG (re-editable)",
        description: "JPEG with embedded annotations",
      },
      {
        id: "png-editable",
        label: "Download PNG (re-editable)",
        description: "PNG with embedded annotations",
      },
    );
  }

  // PowerPoint export — produces a single-slide .pptx with the
  // screenshot as the slide background and each annotation as an
  // editable native Office shape. Available everywhere (browser-side
  // ZIP build, no Tauri dependency).
  items.push({
    id: "pptx",
    label: "Download PPTX (PowerPoint)",
    description: "Editable PowerPoint slide with native shapes",
  });

  menu.items = items;
  menu.addEventListener("menu-select", (e: Event) => {
    const detail = (e as CustomEvent<SaveMenuSelectDetail>).detail;
    actions[detail.id]?.();
    cleanup();
  });

  // Render into document.body with fixed positioning so the menu
  // escapes any ancestor `overflow: hidden` (the editor-header has
  // exactly that, which would otherwise clip the dropdown the moment
  // it appears below its anchor).
  menu.style.position = "fixed";
  menu.style.zIndex = "1000";
  document.body.appendChild(menu);

  // Place the menu just below the anchor's bottom edge, right-aligned
  // to its right edge — the same visual position the previous CSS-only
  // (top: 100%; right: 0) approach achieved when un-clipped.
  const reposition = () => {
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    // Show, measure, then compute the left edge so the menu doesn't
    // spill off the viewport on narrow windows.
    menu.style.top = `${Math.round(r.bottom + 4)}px`;
    const mw = menu.offsetWidth;
    let left = Math.round(r.right - mw);
    if (left < 8) left = 8;
    if (left + mw > vw - 8) left = vw - mw - 8;
    menu.style.left = `${left}px`;
  };
  reposition();
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);

  const close = (e: MouseEvent) => {
    if (menu.contains(e.target as Node)) return;
    // Ignore the same click that opened the menu — without this the
    // open click would propagate to the document and immediately
    // close the menu we just attached.
    if (anchor.contains(e.target as Node)) return;
    cleanup();
  };
  const cleanup = () => {
    menu.remove();
    document.removeEventListener("click", close);
    window.removeEventListener("resize", reposition);
    window.removeEventListener("scroll", reposition, true);
  };
  setTimeout(() => document.addEventListener("click", close), 0);
}
