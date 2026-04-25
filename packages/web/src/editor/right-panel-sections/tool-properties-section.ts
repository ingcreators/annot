/**
 * Built-in `right-panel.tool-properties` section — renders the
 * controls (color / width / variant / etc.) for the currently-active
 * drawing tool. Title is dynamic — set per active tool via
 * `ctx.setTitle` so it reads "Rectangle" / "Arrow" / "Sticky note"
 * matching the toolbar's display title.
 *
 * Migrated from the previous monolithic right-panel as part of
 * Phase 3 of `docs/plans/plugin-ui-slots.md`. The reactive
 * lifecycle's `update(ctx)` re-renders the controls when the active
 * tool changes (host calls `notifyUpdate` after `showToolProperties`).
 *
 * `visible(ctx)` returns false in Select mode (no active tool) and
 * for tools that have no adjustable properties (`crop`).
 */

import type { Toolbar } from "@ingcreators/annot-core";
import type { UISection } from "../../app/plugin-host.js";

export interface ToolPropertiesSectionDeps {
  getActiveToolId(): string | null;
  getToolbar(): Toolbar;
}

export function createToolPropertiesSection(deps: ToolPropertiesSectionDeps): UISection {
  let bodyRef: HTMLElement | null = null;

  const render = (container: HTMLElement, ctx: { setTitle(t: string): void }) => {
    container.innerHTML = "";
    const toolId = deps.getActiveToolId();
    if (!toolId) return; // visible() guard usually prevents this; defensive no-op
    deps.getToolbar().renderToolProperties(toolId, container);
    ctx.setTitle(deps.getToolbar().getToolDisplayTitle(toolId));
  };

  return {
    id: "right-panel.tool-properties",
    // Static fallback — the host overrides via `ctx.setTitle` from
    // inside mount with the active tool's display name. Sections
    // can declare a sensible-but-generic title that's used until
    // the dynamic override fires.
    title: "Tool",
    priority: 10,
    visible() {
      const id = deps.getActiveToolId();
      return id !== null && id !== "crop";
    },
    mount(container, ctx) {
      bodyRef = container;
      render(container, ctx);
      return {
        update(updateCtx) {
          if (bodyRef) render(bodyRef, updateCtx);
        },
        unmount() {
          bodyRef = null;
        },
      };
    },
  };
}
