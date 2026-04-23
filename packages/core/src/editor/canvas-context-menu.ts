/**
 * Canvas context menu — the floating popup that opens on right-click
 * over the editor canvas.
 *
 * Kept intentionally self-contained (no external CSS dependency) so
 * host apps can import `Toolbar` without having to also pull in a
 * stylesheet for this overlay. Styling is injected once on first open
 * via a `<style>` tag in `<head>` (see `#ensureStyle`), themed with the
 * editor's existing CSS custom properties (`--bg-panel`,
 * `--text-primary`, `--hover-bg`, `--border-color`, `--border-subtle`)
 * so it matches light/dark themes automatically.
 *
 * ## Submenus (flyouts)
 *
 * A menu item with a non-empty `submenu` array renders a chevron hint
 * and, when hovered / clicked / activated via keyboard, opens a
 * child menu docked to the row's right edge (flipped to the left when
 * that would overflow the viewport). Submenus can nest arbitrarily —
 * each level is its own floating `<div>`, stacked in the internal
 * `menuStack`. All levels share dismissal: clicking a leaf action or
 * outside the menu, or pressing Escape, closes the whole stack.
 *
 * Mirrors the standard OS-native cascading-menu semantics (Windows
 * Shell / macOS AppKit) — hovering a sibling row collapses any
 * submenu from an earlier sibling before opening its own.
 */

export interface CanvasMenuItem {
  /** Material Symbols ligature name. Optional — when absent, no icon
   *  column is rendered for that row. Used for section separators and
   *  informational header rows. */
  icon?: string;
  /** Inline SVG markup — takes precedence over `icon` when provided.
   *  Used for shape variants (rect / rounded / ellipse) whose Material
   *  Symbols glyphs don't render a clearly distinct silhouette at 20px. */
  svg?: string;
  /** CSS color. When present, a filled swatch square is rendered in
   *  place of an icon — used for Highlight color variants so the menu
   *  shows the actual color, not a generic highlighter glyph. */
  swatch?: string;
  /** Optional badge overlay on the leading icon — mirrors the toolbar's
   *  variant badge so a row like "Shape" can show which specific
   *  variant ("Rounded rectangle") a click will activate. Only one of
   *  `icon` / `svg` / `swatch` is used per badge (same precedence as
   *  the main icon). */
  badge?: {
    icon?: string;
    svg?: string;
    swatch?: string;
  };
  label: string;
  /** Optional secondary label shown right-aligned, muted (e.g.
   *  shortcut hints like "R" / "C"). Not rendered when the row has a
   *  submenu — the chevron takes that slot instead. */
  hint?: string;
  /** Row action. When `submenu` is ALSO set, the row behaves like a
   *  toolbar split-button: left-click runs `action`, hover / chevron /
   *  ArrowRight opens the submenu. This mirrors the toolbar's "click
   *  the body to activate the current variant; click the badge to
   *  pick a different variant" split. */
  action?: () => void | Promise<void>;
  /** Child items. When non-empty, this row renders a chevron and
   *  opens a nested menu on hover / ArrowRight. If `action` is also
   *  set, left-clicking the row runs `action` instead of opening the
   *  submenu (split-button behavior). */
  submenu?: CanvasMenuItem[];
  /** When true, render as a non-interactive header row (for section
   *  titles like "INSERT HERE"). */
  header?: boolean;
  /** Insert a separator BEFORE this item. */
  separatorAbove?: boolean;
  /** Disable (still rendered, but not clickable / greyed). */
  disabled?: boolean;
}

interface OpenOptions {
  /** Viewport X (clientX) — menu opens with its top-left at or near this. */
  x: number;
  /** Viewport Y (clientY). */
  y: number;
  items: CanvasMenuItem[];
}

/** A single rendered menu level plus its bookkeeping — lets higher
 *  levels forcibly close descendants without leaking listeners. */
interface MenuLevel {
  el: HTMLElement;
  focusables: HTMLElement[];
  /** Index of the row that owns the currently-open child submenu, or
   *  -1 when no child is open. Used so hovering a sibling row can
   *  know to close the previously-open submenu. */
  openChildFromIdx: number;
  /** Cleanup callbacks — listener removal registered at open time.
   *  Invoked when this level is closed. */
  cleanup: Array<() => void>;
}

/** Stack of currently-visible menu levels (index 0 = root). Kept so
 *  every open / close operation can propagate to descendants in a
 *  single place. */
const menuStack: MenuLevel[] = [];
/** Global key / mouse listeners — attached once on root-open, detached
 *  when the stack empties. */
let globalCleanup: Array<() => void> = [];

function closeLevelsFrom(startIdx: number): void {
  while (menuStack.length > startIdx) {
    const lvl = menuStack.pop()!;
    lvl.cleanup.forEach((fn) => fn());
    lvl.el.remove();
  }
  if (menuStack.length === 0) {
    globalCleanup.forEach((fn) => fn());
    globalCleanup = [];
  }
}

function closeAll(): void {
  closeLevelsFrom(0);
}

function ensureStyle(): void {
  if (document.getElementById("anno-canvas-ctx-style")) return;
  const style = document.createElement("style");
  style.id = "anno-canvas-ctx-style";
  style.textContent = `
.anno-canvas-ctx {
  position: fixed;
  z-index: 9999;
  background: var(--bg-panel, #fff);
  color: var(--text-primary, #0b1020);
  border: 1px solid var(--border-color, rgba(0,0,0,0.15));
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.28);
  padding: 4px;
  font-size: 13px;
  user-select: none;
  -webkit-user-select: none;
}
.anno-canvas-ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  background: none;
  border: 0;
  text-align: left;
  color: var(--text-primary, #0b1020);
  font: inherit;
  cursor: pointer;
  border-radius: 4px;
  min-height: 28px;
  box-sizing: border-box;
}
.anno-canvas-ctx-item:hover:not([disabled]),
.anno-canvas-ctx-item:focus-visible:not([disabled]),
.anno-canvas-ctx-item.is-parent-open {
  background: var(--hover-bg, rgba(0,0,0,0.06));
  outline: none;
}
.anno-canvas-ctx-item[disabled] {
  opacity: 0.6;
  cursor: default;
}
.anno-canvas-ctx-item.is-header {
  cursor: default;
  color: var(--text-secondary, #666);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.85;
  padding: 6px 10px 4px;
  min-height: 0;
}
.anno-canvas-ctx-item.is-header:hover { background: none; }
.anno-canvas-ctx-icon {
  position: relative;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: var(--text-secondary, #555);
}
.anno-canvas-ctx-badge {
  position: absolute;
  right: -5px;
  bottom: -5px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--bg-panel, #fff);
  border: 1.5px solid var(--bg-panel, #fff);
  box-shadow: 0 0 0 1px var(--border-color, rgba(0,0,0,0.25));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: var(--text-primary, #0b1020);
  box-sizing: border-box;
}
.anno-canvas-ctx-badge.material-symbols-outlined {
  font-size: 9px;
  line-height: 1;
}
.anno-canvas-ctx-badge svg {
  width: 9px;
  height: 9px;
  display: block;
}
.anno-canvas-ctx-badge-swatch {
  border-radius: 50%;
}
.anno-canvas-ctx-item:hover:not([disabled]) .anno-canvas-ctx-icon,
.anno-canvas-ctx-item.is-parent-open .anno-canvas-ctx-icon {
  color: var(--text-primary, #0b1020);
}
.anno-canvas-ctx-icon.material-symbols-outlined {
  font-size: 20px;
  line-height: 1;
}
.anno-canvas-ctx-icon svg {
  width: 20px;
  height: 20px;
  display: block;
}
.anno-canvas-ctx-swatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid var(--border-color, rgba(0,0,0,0.25));
  display: inline-block;
  flex: 0 0 auto;
}
.anno-canvas-ctx-label { flex: 1 1 auto; white-space: nowrap; }
.anno-canvas-ctx-hint {
  flex: 0 0 auto;
  color: var(--text-secondary, #666);
  font-size: 11px;
  margin-left: 8px;
}
.anno-canvas-ctx-chevron {
  flex: 0 0 auto;
  color: var(--text-secondary, #666);
  font-size: 18px;
  line-height: 1;
  margin-left: 8px;
}
.anno-canvas-ctx-item:hover:not([disabled]) .anno-canvas-ctx-chevron,
.anno-canvas-ctx-item.is-parent-open .anno-canvas-ctx-chevron {
  color: var(--text-primary, #0b1020);
}
.anno-canvas-ctx-sep {
  height: 1px;
  background: var(--border-subtle, rgba(0,0,0,0.1));
  margin: 4px 2px;
}
`;
  document.head.appendChild(style);
}

/**
 * Render one menu level. `anchorRect` is supplied for submenus
 * (viewport rect of the parent row) — root menus position by `x`/`y`
 * from OpenOptions. `parentLevel` is the invoking level; it receives
 * hover / close wiring so a sibling-row hover can collapse this
 * submenu.
 */
function renderMenu(
  items: CanvasMenuItem[],
  pos: { x: number; y: number } | { anchorRect: DOMRect },
  parentLevel: MenuLevel | null,
  parentRow: HTMLElement | null,
  parentRowIdx: number,
): MenuLevel {
  const menu = document.createElement("div");
  menu.className = "anno-canvas-ctx";
  menu.setAttribute("role", "menu");

  const level: MenuLevel = {
    el: menu,
    focusables: [],
    openChildFromIdx: -1,
    cleanup: [],
  };

  items.forEach((item, rowIdx) => {
    if (item.separatorAbove) {
      const sep = document.createElement("div");
      sep.className = "anno-canvas-ctx-sep";
      menu.appendChild(sep);
    }

    const row = document.createElement("button");
    row.type = "button";
    row.setAttribute("role", item.header ? "presentation" : "menuitem");
    row.className = "anno-canvas-ctx-item" + (item.header ? " is-header" : "");
    const hasSubmenu = !!(item.submenu && item.submenu.length > 0);
    if (item.disabled || item.header) row.setAttribute("disabled", "");
    if (hasSubmenu) row.setAttribute("aria-haspopup", "menu");

    // --- Leading visual: swatch > svg > icon -----------------------------
    // The container is kept on `.anno-canvas-ctx-icon` so the optional
    // variant badge (appended below) can position itself in that
    // element's bottom-right corner just like the toolbar button badge.
    let iconSpan: HTMLElement | null = null;
    if (item.swatch) {
      iconSpan = document.createElement("span");
      iconSpan.className = "anno-canvas-ctx-icon";
      const inner = document.createElement("span");
      inner.className = "anno-canvas-ctx-swatch";
      inner.style.background = item.swatch;
      iconSpan.appendChild(inner);
      row.appendChild(iconSpan);
    } else if (item.svg) {
      iconSpan = document.createElement("span");
      iconSpan.className = "anno-canvas-ctx-icon";
      iconSpan.setAttribute("aria-hidden", "true");
      iconSpan.innerHTML = item.svg;
      row.appendChild(iconSpan);
    } else if (item.icon) {
      iconSpan = document.createElement("span");
      iconSpan.className = "anno-canvas-ctx-icon material-symbols-outlined";
      iconSpan.setAttribute("aria-hidden", "true");
      iconSpan.textContent = item.icon;
      row.appendChild(iconSpan);
    }

    // Variant badge overlay (bottom-right of the icon). Mirrors the
    // toolbar's variant badge so the row telegraphs "left-clicking me
    // activates THIS specific variant of the tool". Swatch wins over
    // svg which wins over icon — same precedence as the main icon.
    if (iconSpan && item.badge) {
      const badge = document.createElement("span");
      badge.setAttribute("aria-hidden", "true");
      if (item.badge.swatch) {
        badge.className = "anno-canvas-ctx-badge anno-canvas-ctx-badge-swatch";
        badge.style.background = item.badge.swatch;
      } else if (item.badge.svg) {
        badge.className = "anno-canvas-ctx-badge";
        badge.innerHTML = item.badge.svg;
      } else if (item.badge.icon) {
        badge.className = "anno-canvas-ctx-badge material-symbols-outlined";
        badge.textContent = item.badge.icon;
      } else {
        badge.className = "anno-canvas-ctx-badge";
      }
      iconSpan.appendChild(badge);
    }

    const labelSpan = document.createElement("span");
    labelSpan.className = "anno-canvas-ctx-label";
    labelSpan.textContent = item.label;
    row.appendChild(labelSpan);

    if (hasSubmenu) {
      // Trailing chevron — visual cue "more on the right". The
      // Material Symbols "chevron_right" glyph keeps us consistent
      // with the rest of the editor's iconography.
      const chev = document.createElement("span");
      chev.className = "anno-canvas-ctx-chevron material-symbols-outlined";
      chev.setAttribute("aria-hidden", "true");
      chev.textContent = "chevron_right";
      row.appendChild(chev);
    } else if (item.hint) {
      const hintSpan = document.createElement("span");
      hintSpan.className = "anno-canvas-ctx-hint";
      hintSpan.textContent = item.hint;
      row.appendChild(hintSpan);
    }

    // --- Interaction wiring ---------------------------------------------
    const isActive = !item.header && !item.disabled;

    if (isActive) {
      level.focusables.push(row);

      // A row can have (a) action only, (b) submenu only, or (c) BOTH
      // — the split-button case where the row body activates the
      // current variant and hover reveals the alternatives.
      const runAction = item.action
        ? async () => {
            const action = item.action!;
            closeAll();
            try { await action(); } catch (err) {
              console.error("[canvas-ctx]", err);
            }
          }
        : null;

      // Shared helper — opens the submenu (if any) without stealing
      // focus from the parent menu. Used by hover AND by keyboard
      // ArrowRight / submenu-only click.
      let openTimer: number | null = null;
      const openSubmenu = (focusFirst: boolean): void => {
        if (!hasSubmenu) return;
        if (openTimer !== null) { clearTimeout(openTimer); openTimer = null; }
        const myLevelIdx = menuStack.indexOf(level);
        if (myLevelIdx >= 0) {
          // Close any descendant levels before opening a new submenu
          // so two submenus don't stack at the same depth.
          closeLevelsFrom(myLevelIdx + 1);
        }
        row.classList.add("is-parent-open");
        const rect = row.getBoundingClientRect();
        const child = renderMenu(
          item.submenu!,
          { anchorRect: rect },
          level,
          row,
          rowIdx,
        );
        menuStack.push(child);
        level.openChildFromIdx = rowIdx;
        if (focusFirst) child.focusables[0]?.focus();
      };

      if (hasSubmenu) {
        // Hover opens the submenu after a short delay (hover-intent —
        // matches the ~100ms feel Windows / macOS use). Focus stays on
        // the parent row so keyboard users can keep arrow-navigating.
        row.addEventListener("mouseenter", () => {
          if (openTimer !== null) clearTimeout(openTimer);
          openTimer = window.setTimeout(() => openSubmenu(false), 80);
        });
        row.addEventListener("mouseleave", () => {
          if (openTimer !== null) {
            clearTimeout(openTimer);
            openTimer = null;
          }
        });
      } else if (runAction) {
        // Leaf row with no submenu — hovering should collapse any
        // submenu a sibling currently has open (native cascading
        // behavior).
        row.addEventListener("mouseenter", () => {
          const myLevelIdx = menuStack.indexOf(level);
          if (myLevelIdx >= 0 && level.openChildFromIdx !== -1) {
            closeLevelsFrom(myLevelIdx + 1);
            level.openChildFromIdx = -1;
            menu.querySelectorAll(".is-parent-open").forEach((el) =>
              el.classList.remove("is-parent-open"),
            );
          }
        });
      }

      // Click priority: if there's an action, click runs it (EVEN when
      // a submenu is also available — that's the "left-click activates
      // current variant" contract matching the toolbar button). A row
      // with ONLY a submenu and no action falls back to opening the
      // submenu on click.
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        if (runAction) {
          void runAction();
        } else if (hasSubmenu) {
          openSubmenu(true);
        }
      });

      // Expose the openSubmenu hook on the element so the outer
      // keyboard handler (ArrowRight) can trigger it without having
      // to reach back into this closure through DOM attributes.
      (row as any).__annoOpenSubmenu = () => openSubmenu(true);
    }

    menu.appendChild(row);
  });

  // --- Position ---------------------------------------------------------
  menu.style.left = "-9999px";
  menu.style.top = "-9999px";
  document.body.appendChild(menu);
  const { width, height } = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left: number;
  let top: number;
  if ("anchorRect" in pos) {
    // Submenu — dock to the right of the anchor row. Flip to the
    // anchor's left when that would overflow; clamp vertically.
    const a = pos.anchorRect;
    left = a.right - 2; // -2 overlap hides the parent menu's border
    if (left + width > vw - 8) left = a.left - width + 2;
    top = a.top - 4; // slight offset so the first child aligns with the parent row
    if (top + height > vh - 8) top = vh - height - 8;
    if (top < 8) top = 8;
  } else {
    left = Math.min(pos.x, vw - width - 8);
    top = Math.min(pos.y, vh - height - 8);
  }
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;

  // --- Keyboard nav on this level --------------------------------------
  const onKey = (e: KeyboardEvent) => {
    if (menuStack[menuStack.length - 1] !== level) return; // only topmost handles keys

    if (e.key === "Escape") {
      e.preventDefault();
      if (menuStack.length > 1) {
        // Nested — close only this level and return focus to parent.
        closeLevelsFrom(menuStack.length - 1);
        parentRow?.focus();
      } else {
        closeAll();
      }
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (level.focusables.length === 0) return;
      e.preventDefault();
      const idx = level.focusables.findIndex((el) => el === document.activeElement);
      const next = e.key === "ArrowDown"
        ? (idx + 1) % level.focusables.length
        : (idx - 1 + level.focusables.length) % level.focusables.length;
      level.focusables[next]?.focus();
      return;
    }

    if (e.key === "ArrowRight") {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return;
      if (active.getAttribute("aria-haspopup") === "menu") {
        // ArrowRight on a split-button row should open the submenu
        // and focus its first item — NOT run the row's primary
        // action. Using the hook bypasses the default click handler
        // (which would trigger the action on action-bearing rows).
        e.preventDefault();
        const openHook = (active as any).__annoOpenSubmenu as
          | (() => void) | undefined;
        if (openHook) openHook();
        else active.click();
      }
      return;
    }

    if (e.key === "ArrowLeft") {
      if (menuStack.length > 1) {
        e.preventDefault();
        closeLevelsFrom(menuStack.length - 1);
        parentRow?.focus();
      }
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      const active = document.activeElement as HTMLElement | null;
      if (active && level.el.contains(active)) {
        e.preventDefault();
        active.click();
      }
    }
  };
  document.addEventListener("keydown", onKey);
  level.cleanup.push(() => document.removeEventListener("keydown", onKey));

  // Clear parent-open highlight when this level is disposed.
  if (parentRow) {
    level.cleanup.push(() => parentRow.classList.remove("is-parent-open"));
  }
  if (parentLevel) {
    level.cleanup.push(() => {
      parentLevel.openChildFromIdx = -1;
    });
  }
  void parentRowIdx; // captured at creation; used only via closeLevelsFrom bookkeeping

  return level;
}

/** Open the canvas context menu at (x, y). Closes any previously-open menu. */
export function openCanvasContextMenu(opts: OpenOptions): void {
  closeAll();
  ensureStyle();

  const root = renderMenu(opts.items, { x: opts.x, y: opts.y }, null, null, -1);
  menuStack.push(root);
  root.focusables[0]?.focus();

  // --- Global dismissal (document-wide) --------------------------------
  const onDocMouseDown = (e: MouseEvent) => {
    for (const lvl of menuStack) {
      if (lvl.el.contains(e.target as Node)) return;
    }
    closeAll();
  };
  const onScroll = () => closeAll();

  // Defer attach so the originating right-click doesn't immediately
  // close this very menu.
  requestAnimationFrame(() => {
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("scroll", onScroll, true);
  });
  globalCleanup.push(() => document.removeEventListener("mousedown", onDocMouseDown));
  globalCleanup.push(() => window.removeEventListener("scroll", onScroll, true));

  // Safety net — if the root is yanked from the DOM (e.g. host nukes
  // the editor), release global listeners too.
  const observer = new MutationObserver(() => {
    if (!document.body.contains(root.el)) {
      observer.disconnect();
      closeAll();
    }
  });
  observer.observe(document.body, { childList: true });
}

/** Close any open canvas context menu (e.g. on navigation). */
export function closeCanvasContextMenu(): void {
  closeAll();
}
