/**
 * `createTextMiniToolbar` — floating PowerPoint-style mini toolbar
 * that hovers above the active selection inside a TextTool
 * contentEditable session.
 *
 * Affordances:
 *   - Bold / Italic / Underline toggles (B / I / U buttons)
 *   - Per-character font family dropdown
 *   - Per-character font size dropdown
 *   - Per-character text color picker
 *
 * Toggles use `document.execCommand`; family / size / color use a
 * range-extraction + `<span style="...">` wrapper so the resulting
 * HTML tracks the canonical shape `htmlToRuns` recognises (the
 * mapper reads `<span style="...">` first-class — `<font>` legacy
 * tags don't survive the round-trip).
 *
 * Tier C — owns DOM event listeners + `getBoundingClientRect`
 * positioning. Tracks `selectionchange` on the host's document
 * while the edit session is active; the returned `close()`
 * tears down the toolbar element + listeners.
 *
 * Vanilla constructor (no Lit) — matches the convention used by
 * `anchored-popover.ts` / `color-palette.ts` / `custom-select.ts`
 * inside `@ingcreators/annot-editor`.
 */

export type TextMiniToolbarFlagCmd = "bold" | "italic" | "underline";
export type TextMiniToolbarStyleCmd = "fontFamily" | "fontSize" | "color";
export type TextMiniToolbarCmd = TextMiniToolbarFlagCmd | TextMiniToolbarStyleCmd;

export interface TextMiniToolbarOptions {
  /** The contentEditable host element the toolbar tracks. The
   *  toolbar shows when this element owns the active selection;
   *  closes on `blur` or when the selection moves elsewhere. */
  host: HTMLElement;
  /** Optional callback fired whenever the user toggles or applies
   *  a formatting change — useful for integrating with a sidebar
   *  PropertyPanel that mirrors the same controls. */
  onCommand?: (cmd: TextMiniToolbarCmd, value?: string) => void;
}

export interface TextMiniToolbarHandle {
  /** Tear down the toolbar element + event listeners. Idempotent. */
  close(): void;
}

const TOOLBAR_CLASS = "annot-text-mini-toolbar";

/** Pixel sizes shown in the size dropdown. PowerPoint-ish ladder
 *  (8 / 10 / 12 / 14 / 18 / 24 / 32 / 48 / 72) translated to px so
 *  the values plug straight into the canonical `font-size: Npx`
 *  inline style. */
const SIZE_PRESETS = [8, 10, 12, 14, 16, 18, 24, 32, 48, 72] as const;

/** Family dropdown — mirrors the SELECTION-side `fontFamily`
 *  PropertyPanel control's option set so users see the same label
 *  ladder in both places. */
const FAMILY_PRESETS = [
  { value: "sans-serif", label: "Sans-serif" },
  { value: "serif", label: "Serif" },
  { value: "monospace", label: "Monospace" },
  { value: "system-ui, -apple-system, sans-serif", label: "System UI" },
] as const;

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
    align-items: center;
    gap: 4px;
    padding: 4px;
    background: var(--annot-bg-panel, #fff);
    border: 1px solid var(--annot-border, rgba(0,0,0,0.15));
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    font-family: system-ui, sans-serif;
    font-size: 13px;
  `;

  // ─── B / I / U toggle buttons ─────────────────────────────────
  const flagButtons: Array<{
    cmd: TextMiniToolbarFlagCmd;
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

  for (const b of flagButtons) {
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
      // execCommand / range-wrap apply to the active selection,
      // which we want to keep alive across the click.
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
      // declarative path.
      if (typeof document.execCommand === "function") {
        document.execCommand(b.cmd);
      }
      onCommand?.(b.cmd);
      reposition();
    });
    toolbar.appendChild(btn);
  }

  // ─── divider ──────────────────────────────────────────────────
  const divider = document.createElement("span");
  divider.style.cssText = `
    width: 1px;
    height: 20px;
    background: var(--annot-border, rgba(0,0,0,0.15));
    margin: 0 2px;
  `;
  toolbar.appendChild(divider);

  // ─── Family dropdown ─────────────────────────────────────────
  const familySelect = document.createElement("select");
  familySelect.title = "Font";
  familySelect.setAttribute("aria-label", "Font");
  familySelect.style.cssText = `
    height: 28px;
    padding: 0 4px;
    border: 1px solid var(--annot-border, rgba(0,0,0,0.15));
    border-radius: 4px;
    background: var(--annot-bg-panel, #fff);
    cursor: pointer;
    font-size: 12px;
  `;
  // Placeholder default that doesn't apply on selection (so the
  // dropdown reads "Font" until the user picks a real option).
  const familyPlaceholder = document.createElement("option");
  familyPlaceholder.value = "";
  familyPlaceholder.textContent = "Font";
  familyPlaceholder.disabled = true;
  familyPlaceholder.selected = true;
  familySelect.appendChild(familyPlaceholder);
  for (const f of FAMILY_PRESETS) {
    const opt = document.createElement("option");
    opt.value = f.value;
    opt.textContent = f.label;
    familySelect.appendChild(opt);
  }
  familySelect.addEventListener("mousedown", (e) => {
    // Don't steal focus from the contentEditable.
    e.stopPropagation();
  });
  familySelect.addEventListener("change", () => {
    const value = familySelect.value;
    if (!value) return;
    wrapSelectionWithStyle(host, "fontFamily", value);
    onCommand?.("fontFamily", value);
    // Reset to the placeholder so a second pick of the same value
    // still fires `change`.
    familySelect.value = "";
    reposition();
  });
  toolbar.appendChild(familySelect);

  // ─── Size dropdown ───────────────────────────────────────────
  const sizeSelect = document.createElement("select");
  sizeSelect.title = "Font size";
  sizeSelect.setAttribute("aria-label", "Font size");
  sizeSelect.style.cssText = familySelect.style.cssText;
  const sizePlaceholder = document.createElement("option");
  sizePlaceholder.value = "";
  sizePlaceholder.textContent = "Size";
  sizePlaceholder.disabled = true;
  sizePlaceholder.selected = true;
  sizeSelect.appendChild(sizePlaceholder);
  for (const px of SIZE_PRESETS) {
    const opt = document.createElement("option");
    opt.value = String(px);
    opt.textContent = String(px);
    sizeSelect.appendChild(opt);
  }
  sizeSelect.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  });
  sizeSelect.addEventListener("change", () => {
    const value = sizeSelect.value;
    if (!value) return;
    wrapSelectionWithStyle(host, "fontSize", `${value}px`);
    onCommand?.("fontSize", `${value}px`);
    sizeSelect.value = "";
    reposition();
  });
  toolbar.appendChild(sizeSelect);

  // ─── Color picker ────────────────────────────────────────────
  const colorWrap = document.createElement("label");
  colorWrap.title = "Text color";
  colorWrap.setAttribute("aria-label", "Text color");
  colorWrap.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--annot-border, rgba(0,0,0,0.15));
    border-radius: 4px;
    cursor: pointer;
    position: relative;
  `;
  const colorGlyph = document.createElement("span");
  colorGlyph.textContent = "A";
  colorGlyph.style.cssText = `
    font-weight: bold;
    border-bottom: 3px solid currentColor;
    padding-bottom: 1px;
    line-height: 1;
    font-size: 14px;
  `;
  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = "#000000";
  colorInput.style.cssText = `
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    border: none;
    padding: 0;
  `;
  colorWrap.appendChild(colorGlyph);
  colorWrap.appendChild(colorInput);
  colorInput.addEventListener("mousedown", (e) => {
    e.stopPropagation();
  });
  colorInput.addEventListener("input", () => {
    const value = colorInput.value;
    colorGlyph.style.color = value;
    wrapSelectionWithStyle(host, "color", value);
    onCommand?.("color", value);
    reposition();
  });
  toolbar.appendChild(colorWrap);

  document.body.appendChild(toolbar);

  let visible = false;

  const showAt = (rect: DOMRect): void => {
    const margin = 8;
    const tw = toolbar.offsetWidth || 200;
    const th = toolbar.offsetHeight || 32;
    let left = Math.round(rect.left + rect.width / 2 - tw / 2);
    let top = Math.round(rect.top - th - margin);
    left = Math.max(margin, Math.min(left, window.innerWidth - tw - margin));
    if (top < margin) {
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

/** Wrap the current selection's contents in a `<span style="...">`
 *  carrying the supplied CSS property. The wrap respects the host
 *  boundary — selections that touch DOM outside `host` are
 *  rejected. The new span becomes the active range so the toolbar
 *  stays anchored.
 *
 *  Exported so unit tests can drive the wrap path without
 *  instantiating the whole toolbar. */
export function wrapSelectionWithStyle(
  host: HTMLElement,
  property: "fontFamily" | "fontSize" | "color",
  value: string,
): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return false;
  const span = document.createElement("span");
  // Set via CSS property name (camelCase) so happy-dom + browsers
  // both populate the matching `style` declaration.
  span.style[property] = value;
  // Extracting then inserting preserves the runs' inline tree
  // structure within the new wrapper.
  const fragment = range.extractContents();
  span.appendChild(fragment);
  range.insertNode(span);
  // Restore selection so the toolbar stays anchored over the same
  // text region.
  sel.removeAllRanges();
  const next = document.createRange();
  next.selectNodeContents(span);
  sel.addRange(next);
  return true;
}
