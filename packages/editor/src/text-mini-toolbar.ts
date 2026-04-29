/**
 * `createTextMiniToolbar` — floating Bold / Italic / Underline
 * affordance that hovers above the active selection inside a
 * TextTool contentEditable session.
 *
 * Mirrors PowerPoint's "Mini Toolbar" UX: appears above the
 * selection while a non-empty range is selected, hides when the
 * selection collapses or focus leaves the contentEditable host.
 * Each button toggles the corresponding inline span via
 * `document.execCommand` so the result is byte-equivalent to the
 * keyboard shortcuts (Ctrl+B / Ctrl+I / Ctrl+U) the TextTool
 * also dispatches.
 *
 * Tier C — owns DOM event listeners + `getBoundingClientRect`
 * positioning. Tracks `selectionchange` on the host's document
 * while the edit session is active; the returned `close()`
 * tears down both the toolbar element and the listeners.
 *
 * Vanilla constructor (no Lit) — matches the convention used by
 * `anchored-popover.ts` / `color-palette.ts` / `custom-select.ts`
 * inside `@ingcreators/annot-editor`. The Lit components in
 * Annot live in `@ingcreators/annot-web`.
 */

export interface TextMiniToolbarOptions {
  /** The contentEditable host element the toolbar tracks. The
   *  toolbar shows when this element owns the active selection;
   *  closes on `blur` or when the selection moves elsewhere. */
  host: HTMLElement;
  /** Optional callback fired whenever the user toggles a
   *  formatting flag — useful for integrating with a sidebar
   *  PropertyPanel that mirrors the same controls. */
  onCommand?: (cmd: "bold" | "italic" | "underline") => void;
}

export interface TextMiniToolbarHandle {
  /** Tear down the toolbar element + event listeners. Idempotent. */
  close(): void;
}

const TOOLBAR_CLASS = "annot-text-mini-toolbar";

export function createTextMiniToolbar(opts: TextMiniToolbarOptions): TextMiniToolbarHandle {
  const { host, onCommand } = opts;

  const toolbar = document.createElement("div");
  toolbar.className = TOOLBAR_CLASS;
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Text formatting");
  toolbar.style.cssText = `
    position: fixed;
    z-index: 1000;
    display: none;
    gap: 2px;
    padding: 4px;
    background: var(--annot-bg-panel, #fff);
    border: 1px solid var(--annot-border, rgba(0,0,0,0.15));
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    font-family: system-ui, sans-serif;
  `;

  const buttons: Array<{
    cmd: "bold" | "italic" | "underline";
    label: string;
    glyph: string;
    style: string;
  }> = [
    { cmd: "bold", label: "Bold (Ctrl+B)", glyph: "B", style: "font-weight: bold" },
    { cmd: "italic", label: "Italic (Ctrl+I)", glyph: "I", style: "font-style: italic" },
    {
      cmd: "underline",
      label: "Underline (Ctrl+U)",
      glyph: "U",
      style: "text-decoration: underline",
    },
  ];

  for (const b of buttons) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset["cmd"] = b.cmd;
    btn.title = b.label;
    btn.setAttribute("aria-label", b.label);
    btn.style.cssText = `
      width: 28px;
      height: 28px;
      padding: 0;
      border: 1px solid transparent;
      background: transparent;
      cursor: pointer;
      border-radius: 4px;
      ${b.style};
    `;
    btn.textContent = b.glyph;
    btn.addEventListener("mousedown", (e) => {
      // Prevent the contentEditable from losing focus on click —
      // execCommand applies to the active selection, which we want
      // to keep alive across the click.
      e.preventDefault();
    });
    btn.addEventListener("click", () => {
      // `execCommand` is the canonical contentEditable formatting
      // path; it remains supported by every browser even though the
      // spec marks it deprecated. Guard the lookup so headless
      // test runners (happy-dom doesn't implement it) and any
      // future browser that drops the API still degrade
      // gracefully — the `onCommand` hook keeps firing so the
      // PropertyPanel side can apply the formatting via a
      // declarative path once Phase 4 lands.
      if (typeof document.execCommand === "function") {
        document.execCommand(b.cmd);
      }
      onCommand?.(b.cmd);
      reposition();
    });
    toolbar.appendChild(btn);
  }

  document.body.appendChild(toolbar);

  let visible = false;

  const showAt = (rect: DOMRect): void => {
    const margin = 8;
    const tw = toolbar.offsetWidth || 96;
    const th = toolbar.offsetHeight || 32;
    let left = Math.round(rect.left + rect.width / 2 - tw / 2);
    let top = Math.round(rect.top - th - margin);
    // Clamp to the viewport so the toolbar stays visible at any
    // selection position.
    left = Math.max(margin, Math.min(left, window.innerWidth - tw - margin));
    if (top < margin) {
      // Fallback below the selection when there's no room above.
      top = Math.round(rect.bottom + margin);
    }
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
    toolbar.style.display = "flex";
    visible = true;
  };

  const hide = (): void => {
    if (!visible) return;
    toolbar.style.display = "none";
    visible = false;
  };

  const reposition = (): void => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      hide();
      return;
    }
    // Only show when the selection lives inside the host
    // contentEditable — otherwise a selection on the surrounding
    // page would summon a stray toolbar.
    const range = sel.getRangeAt(0);
    if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) {
      hide();
      return;
    }
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      hide();
      return;
    }
    showAt(rect);
  };

  const onSelectionChange = (): void => reposition();
  const onScroll = (): void => {
    if (visible) reposition();
  };

  document.addEventListener("selectionchange", onSelectionChange);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);

  // Initial check in case the host already has an active selection
  // when the toolbar is created.
  reposition();

  return {
    close(): void {
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      toolbar.remove();
      visible = false;
    },
  };
}
