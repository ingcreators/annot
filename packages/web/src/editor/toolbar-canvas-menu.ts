/**
 * Right-click context menus for the editor canvas. Two flavours:
 *
 * - **Insert-here** entry point: routes a canvas right-click into
 *   either the toolbox menu (empty space) or the selection action
 *   menu (annotation hit).
 * - **Toolbox menu**: mirrors the toolbar 1:1, with per-tool variant
 *   submenus + badges so the right-click affordance is at parity
 *   with the toolbar buttons.
 * - **Selection menu**: clipboard, z-order, align, distribute, group,
 *   ungroup, flip — all the operations users expect when right-clicking
 *   one or more selected annotations.
 *
 * Extracted from `toolbar.ts` as Stage 3a-4 of
 * `docs/plans/pre-release-cleanup.md`. Same context-object pattern as
 * 3a-2 / 3a-3: callers pass in only the canvas / selection / history /
 * tool catalogue + variant-activation hook the menus need, no Toolbar
 * private-state coupling.
 */

import type {
  CanvasManager,
  History,
  SelectionManager,
  ToolOptions,
} from "@ingcreators/annot-core/editor";
import {
  type CanvasMenuItem,
  openCanvasContextMenu,
} from "@ingcreators/annot-core/editor/canvas-context-menu";
import { toggleFlip } from "@ingcreators/annot-core/editor/transform-utils";
import { TOOL_VARIANTS, type ToolDef } from "./toolbar-variants.js";

/** Hooks the canvas menus need from the host toolbar. */
export interface ToolbarCanvasMenuContext {
  canvas: CanvasManager;
  selection: SelectionManager;
  history: History;
  tools: Map<string, ToolDef>;
  /** Read the current preset (variant-keyed) for a tool. Used by the
   *  toolbox-menu badge resolver to mirror the toolbar's per-tool
   *  variant glyphs. */
  getCurrentPreset: (toolId: string) => ToolOptions;
  /** Activate a tool (optionally switching its variant) — behaviorally
   *  identical to clicking the tool's button (and, when `variant` is
   *  given, its flyout chip) in the toolbar. */
  activateToolWithVariant: (toolId: string, variant: string | undefined) => void;
}

/**
 * Canvas right-click entry point. Routes to the selection action menu
 * if the click landed on an annotation; otherwise to the toolbox menu.
 */
export function openCanvasRightClickMenu(
  e: MouseEvent,
  pt: DOMPoint,
  ctx: ToolbarCanvasMenuContext,
): void {
  const clicked = findAnnotationAt(e.target, ctx.canvas);
  if (clicked) {
    // If the right-clicked element isn't already selected, select
    // it so the action menu operates on what the user was pointing
    // at. Preserves a pre-existing multi-selection when the click
    // was ON one of the already-selected items — matches native OS
    // behavior (Finder / Explorer: right-clicking inside a multi-
    // selection keeps it intact).
    const selected = ctx.selection.selectedElements;
    if (!selected.includes(clicked)) {
      ctx.selection.select(clicked);
    }
    openSelectionMenu(e, pt, ctx);
  } else {
    openToolboxMenu(e, ctx);
  }
}

/** Walk up from a right-click event target to find the top-level
 *  annotation element — i.e. the direct child of `canvas.annotations`
 *  that contains the click. Returns null if the click was on the
 *  background image or UI overlay rather than an annotation. */
function findAnnotationAt(target: EventTarget | null, canvas: CanvasManager): SVGElement | null {
  const annotations = canvas.annotations;
  let node: Node | null = target as Node | null;
  while (node && node !== annotations) {
    if (node.parentNode === annotations) {
      return node as SVGElement;
    }
    node = node.parentNode;
  }
  return null;
}

/** Build the toolbox menu (tool activators, exactly mirroring the
 *  toolbar button ordering + flyout variants). */
function openToolboxMenu(e: MouseEvent, ctx: ToolbarCanvasMenuContext): void {
  const items: CanvasMenuItem[] = [];
  for (const [toolId, def] of ctx.tools) {
    items.push(toolMenuEntry(toolId, def, ctx));
  }
  openCanvasContextMenu({ x: e.clientX, y: e.clientY, items });
}

/** Build the selection action menu. Items vary by selection size:
 *    1   → clipboard + z-order + flip
 *    2+  → add align / group
 *    3+  → add distribute
 *  Groups (`data-type="group"`) also get an Ungroup row regardless
 *  of selection size. */
function openSelectionMenu(e: MouseEvent, pt: DOMPoint, ctx: ToolbarCanvasMenuContext): void {
  void pt;
  const sel = ctx.selection.selectedElements;
  const count = sel.length;
  if (count === 0) {
    // Safety — shouldn't happen since openCanvasRightClickMenu pre-selects
    // the clicked element, but fall through to the toolbox menu so
    // the user isn't left with no menu at all.
    openToolboxMenu(e, ctx);
    return;
  }

  const containsGroup = sel.some(
    (el) => el.tagName === "g" && el.getAttribute("data-type") === "group",
  );

  const items: CanvasMenuItem[] = [];

  // --- Clipboard / lifecycle -----------------------------------------
  items.push({
    icon: "content_copy",
    label: "Copy",
    hint: "Ctrl+C",
    action: () => ctx.selection.copySelected(),
  });
  items.push({
    icon: "content_paste",
    label: "Paste",
    hint: "Ctrl+V",
    action: () => ctx.selection.paste(),
  });
  items.push({
    icon: "file_copy",
    label: "Duplicate",
    hint: "Ctrl+D",
    action: () => ctx.selection.duplicate(),
  });
  items.push({
    icon: "delete",
    label: "Delete",
    hint: "Del",
    action: () => ctx.selection.deleteSelected(),
  });

  // --- Z-order --------------------------------------------------------
  items.push({
    separatorAbove: true,
    icon: "flip_to_front",
    label: "Bring to front",
    hint: "Ctrl+Shift+]",
    action: () => ctx.selection.bringToFront(),
  });
  items.push({
    icon: "keyboard_arrow_up",
    label: "Bring forward",
    hint: "Ctrl+]",
    action: () => ctx.selection.bringForward(),
  });
  items.push({
    icon: "keyboard_arrow_down",
    label: "Send backward",
    hint: "Ctrl+[",
    action: () => ctx.selection.sendBackward(),
  });
  items.push({
    icon: "flip_to_back",
    label: "Send to back",
    hint: "Ctrl+Shift+[",
    action: () => ctx.selection.sendToBack(),
  });

  // --- Align / Distribute (multi) ------------------------------------
  if (count >= 2) {
    items.push({
      separatorAbove: true,
      icon: "align_horizontal_left",
      label: "Align",
      submenu: [
        {
          icon: "align_horizontal_left",
          label: "Align left",
          action: () => ctx.selection.alignSelected("left"),
        },
        {
          icon: "align_horizontal_center",
          label: "Align center",
          action: () => ctx.selection.alignSelected("center-h"),
        },
        {
          icon: "align_horizontal_right",
          label: "Align right",
          action: () => ctx.selection.alignSelected("right"),
        },
        {
          separatorAbove: true,
          icon: "align_vertical_top",
          label: "Align top",
          action: () => ctx.selection.alignSelected("top"),
        },
        {
          icon: "align_vertical_center",
          label: "Align middle",
          action: () => ctx.selection.alignSelected("middle-v"),
        },
        {
          icon: "align_vertical_bottom",
          label: "Align bottom",
          action: () => ctx.selection.alignSelected("bottom"),
        },
      ],
    });
    if (count >= 3) {
      items.push({
        icon: "horizontal_distribute",
        label: "Distribute",
        submenu: [
          {
            icon: "horizontal_distribute",
            label: "Distribute horizontally",
            action: () => ctx.selection.distributeSelected("horizontal"),
          },
          {
            icon: "vertical_distribute",
            label: "Distribute vertically",
            action: () => ctx.selection.distributeSelected("vertical"),
          },
        ],
      });
    }
  }

  // --- Group / Ungroup -----------------------------------------------
  if (count >= 2) {
    items.push({
      separatorAbove: true,
      icon: "group_work",
      label: "Group",
      hint: "Ctrl+G",
      action: () => ctx.selection.groupSelected(),
    });
  }
  if (containsGroup) {
    items.push({
      separatorAbove: count < 2, // only if Group row above didn't already
      icon: "group_remove",
      label: "Ungroup",
      hint: "Ctrl+Shift+G",
      action: () => ctx.selection.ungroupSelected(),
    });
  }

  // --- Flip -----------------------------------------------------------
  items.push({
    separatorAbove: true,
    icon: "flip",
    label: "Flip",
    submenu: [
      {
        icon: "swap_horiz",
        label: "Flip horizontal",
        hint: "Shift+H",
        action: () => flipSelection("h", ctx),
      },
      {
        icon: "swap_vert",
        label: "Flip vertical",
        hint: "Shift+V",
        action: () => flipSelection("v", ctx),
      },
    ],
  });

  openCanvasContextMenu({ x: e.clientX, y: e.clientY, items });
}

/** Apply flip to all selected elements and refresh selection handles
 *  — mirrors the Shift+H / Shift+V keyboard path in SelectionManager.
 *  Kept here (not on SelectionManager) because the keyboard handler
 *  inlines this logic too; exposing a single `flipSelected` method
 *  on SelectionManager is a future refactor. */
function flipSelection(axis: "h" | "v", ctx: ToolbarCanvasMenuContext): void {
  const els = ctx.selection.selectedElements;
  if (els.length === 0) return;
  for (const el of els) toggleFlip(el, axis);
  ctx.selection.clearHandles();
  ctx.selection.refreshHandles();
  ctx.history.save();
}

/** Build one top-level menu entry for a tool. When the tool has a
 *  variant group, the row gets:
 *    - a VARIANT BADGE matching the toolbar button's badge (so the
 *      user sees which specific variant a left-click will produce),
 *    - a left-click ACTION that activates the tool with its current
 *      variant (identical to clicking the toolbar button), AND
 *    - a SUBMENU (opens on hover or ArrowRight) for picking a
 *      different variant.
 *  Tools without a variant group (Crop) render as a plain leaf
 *  row that activates directly. */
function toolMenuEntry(
  toolId: string,
  def: ToolDef,
  ctx: ToolbarCanvasMenuContext,
): CanvasMenuItem {
  const group = TOOL_VARIANTS[toolId];
  if (!group) {
    return {
      icon: def.icon,
      label: def.label,
      action: () => ctx.activateToolWithVariant(toolId, undefined),
    };
  }

  // Resolve the currently-active variant — same lookup path as
  // `#syncToolButtonIcon`, so the menu badge and the toolbar button
  // badge are always in lockstep.
  const preset = ctx.getCurrentPreset(toolId);
  const currentValue = (preset[group.field] as string) || group.fallback;
  const currentVariant = group.variants.find((v) => v.value === currentValue);

  let badge: CanvasMenuItem["badge"];
  if (currentVariant) {
    if (toolId === "highlight") {
      // Highlight's "variant" is its color — a filled swatch, not a
      // glyph, matching the toolbar's color-dot badge treatment.
      badge = { swatch: currentVariant.value };
    } else if (currentVariant.svg) {
      badge = { svg: currentVariant.svg };
    } else {
      badge = { icon: currentVariant.icon };
    }
  }

  return {
    icon: def.icon,
    label: def.label,
    badge,
    // Left-click → activate with whatever variant is currently
    // stored as last-used. Passing `undefined` means "don't change
    // the variant"; the existing preset lookup will pick it up.
    action: () => ctx.activateToolWithVariant(toolId, undefined),
    submenu: group.variants.map((v) => {
      if (toolId === "highlight") {
        return {
          swatch: v.value,
          label: v.label,
          action: () => ctx.activateToolWithVariant(toolId, v.value),
        };
      }
      return {
        svg: v.svg,
        icon: v.icon,
        label: v.label,
        action: () => ctx.activateToolWithVariant(toolId, v.value),
      };
    }),
  };
}
