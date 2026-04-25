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
 */

export interface AnchoredPopoverOptions {
  className?: string;
  /** "below" anchors the popover under the anchor (horizontal
   *  toolbar pattern); "right" anchors it to the right of the
   *  anchor (vertical toolbar pattern). Default: "right". */
  placement?: "below" | "right";
}

export function openAnchoredPopover(
  anchor: HTMLElement,
  fill: (root: HTMLElement) => void,
  opts: AnchoredPopoverOptions = {},
): () => void {
  // Toggle semantics — a second click on the same anchor closes
  // the popover instead of stacking another one underneath.
  const existing = document.querySelector<HTMLElement>(
    `[data-anchor-popover="${anchor.dataset["popoverId"] ?? ""}"]`,
  );
  if (existing && anchor.dataset["popoverId"]) {
    existing.remove();
    anchor.dataset["popoverId"] = "";
    return () => {};
  }
  const id = Math.random().toString(36).slice(2, 10);
  anchor.dataset["popoverId"] = id;

  const popover = document.createElement("div");
  popover.className = `tool-flyout ${opts.className || ""}`;
  popover.dataset["anchorPopover"] = id;
  popover.style.position = "fixed";
  popover.style.zIndex = "1000";
  fill(popover);
  document.body.appendChild(popover);

  const placement = opts.placement ?? "right";
  const reposition = () => {
    const r = anchor.getBoundingClientRect();
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
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);

  const cleanup = () => {
    popover.remove();
    if (anchor.dataset["popoverId"] === id) anchor.dataset["popoverId"] = "";
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", reposition);
    window.removeEventListener("scroll", reposition, true);
  };
  const onDocClick = (e: MouseEvent) => {
    if (popover.contains(e.target as Node)) return;
    if (anchor.contains(e.target as Node)) return;
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
