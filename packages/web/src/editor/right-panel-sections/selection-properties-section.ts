/**
 * Built-in `right-panel.selection-properties` section — surfaces
 * properties of the currently-selected element(s) via the embedded
 * `PropertyPanel` instance. Title is dynamic — set per element kind
 * via `ctx.setTitle` so it reads "Selected Rectangle" / "Selected
 * Arrow" / "3 selected — 2 rectangles + 1 arrow".
 *
 * Migrated from the previous monolithic right-panel as part of
 * Phase 3 of `docs/plans/plugin-ui-slots.md`.
 *
 * Implementation note: `PropertyPanel` is a panel-level singleton
 * owned by `EditorRightPanel`. The section attaches its host
 * element on mount + detaches on unmount, preserving the
 * PropertyPanel's internal observers / event listeners across mode
 * switches (consistent with the previous "single section, swappable
 * containers" design).
 */

import type { UISection } from "../../app/plugin-host.js";

export interface SelectionPropertiesSectionDeps {
  getSelection(): SVGElement[];
  /** Stable PropertyPanel host container — owned by
   *  EditorRightPanel so the embedded `PropertyPanel` instance
   *  survives mode switches. The section borrows the element on
   *  mount, returns it on unmount. */
  getPropPanelHost(): HTMLElement;
  /** `propPanel.show(elements)` — re-render the controls for the
   *  current selection. */
  showPropPanel(elements: SVGElement[]): void;
  hidePropPanel(): void;
  /** Friendly title computed from the selection. Plumbed from the
   *  panel host so the title-naming logic stays co-located with
   *  the rest of the right-panel state. */
  computeTitle(elements: SVGElement[]): string;
}

export function createSelectionPropertiesSection(
  deps: SelectionPropertiesSectionDeps,
): UISection {
  return {
    id: "right-panel.selection-properties",
    title: "Selection",
    priority: 20,
    visible() {
      return deps.getSelection().length > 0;
    },
    mount(container, ctx) {
      const elements = deps.getSelection();
      const host = deps.getPropPanelHost();
      container.appendChild(host);
      deps.showPropPanel(elements);
      ctx.setTitle(deps.computeTitle(elements));
      return {
        update(updateCtx) {
          const els = deps.getSelection();
          deps.showPropPanel(els);
          updateCtx.setTitle(deps.computeTitle(els));
        },
        unmount() {
          deps.hidePropPanel();
          // Detach the PropertyPanel's host element from this
          // section's container so the host can stash it for the
          // next mount. The element itself is stable (owned by
          // EditorRightPanel); only the parent link drops.
          const host = deps.getPropPanelHost();
          if (host.parentElement === container) {
            container.removeChild(host);
          }
        },
      };
    },
  };
}
