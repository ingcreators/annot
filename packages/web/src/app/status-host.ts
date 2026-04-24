/**
 * Status host — owns the editor statusbar (#statusbar): zoom controls,
 * image dimensions, and the current-tool indicator.
 *
 * Extracted from `app.ts` as part of the Phase 2 decomposition
 * (see `docs/plans/app-decomposition.md`). Pure DOM rendering — no
 * app-state dependencies beyond the canvas passed in at build time.
 */

import type { CanvasManager } from "@ingcreators/annot-core";
import { setTooltip } from "@ingcreators/annot-core/utils";

export const ZOOM_OPTIONS: { label: string; value: number | "fit" }[] = [
  { label: "Fit to window", value: "fit" },
  { label: "25%", value: 0.25 },
  { label: "50%", value: 0.5 },
  { label: "75%", value: 0.75 },
  { label: "100%", value: 1 },
  { label: "150%", value: 1.5 },
  { label: "200%", value: 2 },
  { label: "300%", value: 3 },
];

export class StatusHost {
  /** Build the editor statusbar:
   *   [zoom] [dimensions] ───── [current tool]
   *
   * The caller supplies the canvas so the zoom controls can drive it
   * directly (no intermediate routing) and so the size label matches
   * the canvas's reported dimensions. */
  build(canvas: CanvasManager, width: number, height: number): void {
    const statusbar = document.getElementById("statusbar")!;
    statusbar.innerHTML = "";

    const zoomEl = document.createElement("div");
    zoomEl.id = "status-zoom";
    statusbar.appendChild(zoomEl);
    this.#buildZoomControls(canvas, zoomEl);

    const sizeEl = document.createElement("span");
    sizeEl.textContent = `${width} \u00d7 ${height}`;
    setTooltip(sizeEl, "Image dimensions (width × height in pixels)");
    statusbar.appendChild(sizeEl);

    // Spacer pushes the tool indicator to the far right. Tags and the
    // breadcrumb live in #editor-header, so this statusbar stays focused
    // on canvas-state info only:
    //   [zoom] [dimensions] ───── [current tool]
    const spacer = document.createElement("span");
    spacer.className = "toolbar-spacer";
    statusbar.appendChild(spacer);

    const toolEl = document.createElement("span");
    toolEl.id = "status-tool";
    setTooltip(toolEl, "Current tool — press V or Esc to return to Select");
    toolEl.textContent = "Select";
    statusbar.appendChild(toolEl);
  }

  #buildZoomControls(canvas: CanvasManager, holder: HTMLElement): void {
    const wrap = document.createElement("div");
    wrap.id = "zoom-controls";

    const outBtn = document.createElement("button");
    outBtn.className = "zoom-btn material-symbols-outlined";
    outBtn.textContent = "remove";
    setTooltip(outBtn, "Zoom out (−10%)");
    outBtn.setAttribute("aria-label", "Zoom out");
    outBtn.addEventListener("click", () => canvas.setZoom(canvas.zoom - 0.1));
    wrap.appendChild(outBtn);

    const labelWrap = document.createElement("div");
    labelWrap.className = "zoom-select-wrap";

    const label = document.createElement("button");
    label.className = "zoom-label";
    setTooltip(label, "Zoom level — click to choose a preset");
    label.setAttribute("aria-label", "Zoom level — click to choose a preset");
    // Label reflects the ACTIVE zoom state. In Fit mode we show
    // "Fit" instead of the raw percentage so the user can tell at a
    // glance that the canvas will track viewport changes.
    const refreshLabel = () => {
      label.textContent = canvas.isFitMode ? "Fit" : `${Math.round(canvas.zoom * 100)}%`;
    };
    refreshLabel();

    const menu = document.createElement("div");
    menu.className = "zoom-menu";
    menu.style.display = "none";

    const renderMenu = () => {
      menu.innerHTML = "";
      for (const opt of ZOOM_OPTIONS) {
        if (opt.value === "fit") {
          const item = document.createElement("button");
          item.className = "zoom-menu-item";
          if (canvas.isFitMode) item.classList.add("active");
          item.textContent = "Fit to window";
          item.addEventListener("click", () => {
            canvas.fitToView();
            menu.style.display = "none";
          });
          menu.appendChild(item);
          const sep = document.createElement("div");
          sep.className = "zoom-menu-sep";
          menu.appendChild(sep);
        } else {
          const item = document.createElement("button");
          item.className = "zoom-menu-item";
          // Highlight a numeric preset only when NOT in fit mode —
          // otherwise the "Fit" item is the source of truth.
          if (
            !canvas.isFitMode &&
            Math.round(canvas.zoom * 100) === Math.round((opt.value as number) * 100)
          ) {
            item.classList.add("active");
          }
          item.textContent = opt.label;
          item.addEventListener("click", () => {
            canvas.setZoom(opt.value as number);
            menu.style.display = "none";
          });
          menu.appendChild(item);
        }
      }
    };

    label.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu.style.display === "none") {
        renderMenu();
        menu.style.display = "block";
      } else {
        menu.style.display = "none";
      }
    });

    labelWrap.appendChild(label);
    labelWrap.appendChild(menu);
    wrap.appendChild(labelWrap);

    const inBtn = document.createElement("button");
    inBtn.className = "zoom-btn material-symbols-outlined";
    inBtn.textContent = "add";
    setTooltip(inBtn, "Zoom in (+10%)");
    inBtn.setAttribute("aria-label", "Zoom in");
    inBtn.addEventListener("click", () => canvas.setZoom(canvas.zoom + 0.1));
    wrap.appendChild(inBtn);

    holder.appendChild(wrap);

    canvas.onZoomChange = (_z) => {
      refreshLabel();
    };

    document.addEventListener("click", () => {
      menu.style.display = "none";
    });
  }
}
