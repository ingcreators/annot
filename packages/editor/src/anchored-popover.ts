/**
 * `openAnchoredPopover` — generic popover positioning helper
 * shared between the Toolbar (relocated to web), the
 * `custom-select` widget, and `property-controls`.
 *
 * The popover is appended to `<body>` with `position: fixed`
 * so it escapes any ancestor `overflow: hidden` (the editor
 * header / vertical toolbar both have one). Closes on outside
 * click, Escape, scroll, or resize.
 *
 * Returns a `close()` function so the caller can dismiss the
 * popover from within its content (e.g. after the user clicks
 * a variant chip).
 *
 * Lit Phase 5a — extracted out of `toolbar.ts` so the Toolbar
 * class can move to `@ingcreators/annot-web` without dragging
 * core's `custom-select` and `property-controls` into a
 * cross-package import. The function uses DOM APIs but stays
 * in core because two of its three consumers
 * (`PropertyPanel` / `custom-select`) live in core too.
 *
 * Anchor target: either an `HTMLElement` (default toolbar /
 * property-control flyout case — toggle semantics + outside-
 * click skip the anchor itself) OR a `{ point: { x, y } }`
 * value (canvas right-click case — the popover opens at the
 * cursor position with no associated button to track).
 */

export interface AnchoredPopoverOptions {
  className?: string;
  /** "below" anchors the popover under the anchor (horizontal
   *  toolbar pattern); "right" anchors it to the right of the
   *  anchor (vertical toolbar pattern). Default: "right". */
  placement?: "below" | "right";
}

/** Anchor target for `openAnchoredPopover`. An `HTMLElement` keeps
 *  the existing toolbar / property-control behavior — toggle on
 *  re-open, outside-click ignores the anchor. A `{ point }` value
 *  switches to a "context-menu" style: the popover opens at the
 *  cursor position with no toggle bookkeeping and no anchor element
 *  to exclude from outside-click. */
export type AnchoredPopoverAnchor = HTMLElement | { point: { x: number; y: number } };

export function openAnchoredPopover(
  anchor: AnchoredPopoverAnchor,
  fill: (root: HTMLElement) => void,
  opts: AnchoredPopoverOptions = {},
): () => void {
  const anchorEl = anchor instanceof HTMLElement ? anchor : null;
  const anchorPoint = anchorEl ? null : (anchor as { point: { x: number; y: number } }).point;

  // Toggle semantics — a second call on the same anchor element
  // closes the popover instead of stacking another one underneath.
  // Point-anchored popovers (right-click context menus) skip this
  // dance: there's no element whose dataset survives across calls,
  // and the caller's gesture (right-click → menu pick → invoke) has
  // no "click the same anchor again" pattern to worry about.
  if (anchorEl) {
    const existing = document.querySelector<HTMLElement>(
      `[data-anchor-popover="${anchorEl.dataset["popoverId"] ?? ""}"]`,
    );
    if (existing && anchorEl.dataset["popoverId"]) {
      existing.remove();
      anchorEl.dataset["popoverId"] = "";
      return () => {};
    }
  }
  const id = Math.random().toString(36).slice(2, 10);
  if (anchorEl) anchorEl.dataset["popoverId"] = id;

  const popover = document.createElement("div");
  popover.className = `tool-flyout ${opts.className || ""}`;
  popover.dataset["anchorPopover"] = id;
  popover.style.position = "fixed";
  popover.style.zIndex = "1000";
  fill(popover);
  document.body.appendChild(popover);

  const placement = opts.placement ?? "right";
  const reposition = () => {
    // Treat a point anchor as a 0×0 rect at the cursor — the existing
    // placement math (right/below + viewport flip) then works
    // unchanged. The "below" branch will open just under the cursor;
    // "right" opens just to the side of it.
    const r = anchorEl
      ? anchorEl.getBoundingClientRect()
      : ({
          top: anchorPoint!.y,
          right: anchorPoint!.x,
          bottom: anchorPoint!.y,
          left: anchorPoint!.x,
        } as Pick<DOMRect, "top" | "right" | "bottom" | "left">);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = popover.offsetWidth;
    const ph = popover.offsetHeight;
    let top: number;
    let left: number;
    if (placement === "right") {
      // Vertical toolbar sits on the left edge → popover to the right.
      left = Math.round(r.right + 4);
      top = Math.round(r.top);
      if (left + pw > vw - 8) left = Math.max(8, r.left - pw - 4);
    } else {
      // Horizontal toolbar → popover below.
      top = Math.round(r.bottom + 4);
      left = Math.round(r.left);
      if (left + pw > vw - 8) left = Math.max(8, vw - pw - 8);
    }
    if (top + ph > vh - 8) top = Math.max(8, vh - ph - 8);
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  };
  reposition();
  // Point-anchored popovers stay locked at the original cursor
  // position — re-following on resize/scroll would feel weird since
  // there's no element the user expects them to track.
  if (anchorEl) {
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
  }

  const cleanup = () => {
    popover.remove();
    if (anchorEl && anchorEl.dataset["popoverId"] === id) anchorEl.dataset["popoverId"] = "";
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onKey);
    if (anchorEl) {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    }
  };
  const onDocClick = (e: MouseEvent) => {
    if (popover.contains(e.target as Node)) return;
    // Element-anchored popovers ignore clicks on the anchor itself
    // (the anchor's own click handler manages toggle). Point-
    // anchored popovers have no anchor to skip.
    if (anchorEl?.contains(e.target as Node)) return;
    cleanup();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") cleanup();
  };
  // setTimeout so the opening click doesn't immediately close us.
  setTimeout(() => {
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
  }, 0);

  return cleanup;
}
