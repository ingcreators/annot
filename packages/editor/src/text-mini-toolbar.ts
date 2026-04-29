/**
 * `createTextMiniToolbar` — floating PowerPoint-style mini toolbar
 * that hovers above the active selection inside a TextTool
 * contentEditable session.
 *
 * Layout (compact two-row bar mirroring PowerPoint's mini toolbar):
 *
 *   ┌─ Row 1 ──────────────────────────────────────────────────┐
 *   │ [Family ▾] [Size ▾] [A+] [A−]                            │
 *   ├─ Row 2 ──────────────────────────────────────────────────┤
 *   │ [B] [I] [U]   [⇤] [≡] [⇥]   [Color]                      │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Affordances:
 *   - Bold / Italic / Underline toggles
 *   - Per-character font family + size dropdowns
 *   - A+ / A− step the per-character font size up / down across
 *     the PowerPoint-standard ladder
 *   - Horizontal alignment (start / middle / end) — writes
 *     `data-text-anchor` on the host's containing
 *     `<g data-type="shape">` so the OUTER alignment matches the
 *     inline rich-text formatting
 *   - Text color picker (per-character)
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
 */

export type TextMiniToolbarFlagCmd = "bold" | "italic" | "underline";
export type TextMiniToolbarStyleCmd =
  | "fontFamily"
  | "fontSize"
  | "color"
  | "textAnchor"
  | "fontSizeStep";
export type TextMiniToolbarCmd = TextMiniToolbarFlagCmd | TextMiniToolbarStyleCmd;

export interface TextMiniToolbarOptions {
  /** The contentEditable host element the toolbar tracks. The
   *  toolbar shows when this element owns the active selection;
   *  closes on `blur` or when the selection moves elsewhere. */
  host: HTMLElement;
  /** Optional callback fired whenever the user toggles or applies
   *  a formatting change. */
  onCommand?: (cmd: TextMiniToolbarCmd, value?: string) => void;
  /** Optional callback fired when the user clicks an alignment
   *  button. Annot's alignment lives at the SHAPE wrapper level
   *  (data-text-anchor) — the host plumbs this back to the
   *  active text-bearing shape. */
  onAlignmentChange?: (anchor: "start" | "middle" | "end") => void;
}

export interface TextMiniToolbarHandle {
  /** Tear down the toolbar element + event listeners. Idempotent. */
  close(): void;
}

const TOOLBAR_CLASS = "annot-text-mini-toolbar";

/** PowerPoint-style discrete font-size ladder (px). The A+ / A−
 *  buttons step up / down through this sequence; values outside
 *  the ladder snap to the nearest neighbour. */
const SIZE_LADDER_PX = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96] as const;

/** Family dropdown — mirrors the SELECTION-side `fontFamily`
 *  PropertyPanel control's option set so users see the same label
 *  ladder in both places. */
const FAMILY_PRESETS = [
  { value: "sans-serif", label: "Sans-serif" },
  { value: "serif", label: "Serif" },
  { value: "monospace", label: "Monospace" },
  { value: "system-ui, -apple-system, sans-serif", label: "System UI" },
] as const;

/** Compact single-character / glyph button styling. PowerPoint-style:
 *  28×28, transparent background, hover highlight, active state when
 *  the formatting flag is on. */
const BTN_STYLE = `
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  border-radius: 3px;
  font-family: inherit;
  font-size: 13px;
  color: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;

const SELECT_STYLE = `
  height: 26px;
  padding: 0 4px;
  border: 1px solid var(--annot-border, rgba(0,0,0,0.15));
  border-radius: 3px;
  background: var(--annot-bg-panel, #fff);
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  color: inherit;
`;

const DIVIDER_STYLE = `
  width: 1px;
  height: 18px;
  background: var(--annot-border, rgba(0,0,0,0.15));
  margin: 0 4px;
  display: inline-block;
`;

export function createTextMiniToolbar(opts: TextMiniToolbarOptions): TextMiniToolbarHandle {
  const { host, onCommand, onAlignmentChange } = opts;

  const toolbar = document.createElement("div");
  toolbar.className = TOOLBAR_CLASS;
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Text formatting");
  toolbar.style.cssText = `
    position: fixed;
    z-index: 1000;
    display: none;
    flex-direction: column;
    gap: 2px;
    padding: 4px;
    background: var(--annot-bg-panel, #fff);
    border: 1px solid var(--annot-border, rgba(0,0,0,0.15));
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.18);
    font-family: system-ui, sans-serif;
    color: var(--annot-text, #1f1f1f);
    user-select: none;
  `;

  const row1 = document.createElement("div");
  row1.style.cssText = "display: flex; align-items: center; gap: 4px;";
  toolbar.appendChild(row1);

  const row2 = document.createElement("div");
  row2.style.cssText = "display: flex; align-items: center; gap: 2px;";
  toolbar.appendChild(row2);

  // ─── Row 1: Family | Size | A+ A− ─────────────────────────────
  const familySelect = makeSelect("Font", FAMILY_PRESETS, (value) => {
    wrapSelectionWithStyle(host, "fontFamily", value);
    onCommand?.("fontFamily", value);
    reposition();
  });
  row1.appendChild(familySelect);

  const sizeSelect = makeSelect(
    "Size",
    SIZE_LADDER_PX.map((v) => ({ value: String(v), label: String(v) })),
    (value) => {
      wrapSelectionWithStyle(host, "fontSize", `${value}px`);
      onCommand?.("fontSize", `${value}px`);
      reposition();
    },
  );
  // Override: size dropdown can be narrower than the family one.
  sizeSelect.style.minWidth = "56px";
  row1.appendChild(sizeSelect);

  const sizeUp = makeIconButton("A▲", "Increase font size", () => {
    stepFontSize(host, +1);
    onCommand?.("fontSizeStep", "+1");
    reposition();
  });
  // Slightly larger glyph for "A up"
  sizeUp.style.fontSize = "11px";
  row1.appendChild(sizeUp);

  const sizeDown = makeIconButton("A▼", "Decrease font size", () => {
    stepFontSize(host, -1);
    onCommand?.("fontSizeStep", "-1");
    reposition();
  });
  sizeDown.style.fontSize = "11px";
  row1.appendChild(sizeDown);

  // ─── Row 2: B I U | align | color ────────────────────────────
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
    const btn = makeIconButton(b.glyph, b.label, () => {
      if (typeof document.execCommand === "function") {
        document.execCommand(b.cmd);
      }
      onCommand?.(b.cmd);
      reposition();
    });
    btn.dataset["cmd"] = b.cmd;
    btn.style.cssText += `; ${b.style};`;
    row2.appendChild(btn);
  }

  const div1 = document.createElement("span");
  div1.style.cssText = DIVIDER_STYLE;
  row2.appendChild(div1);

  // Alignment buttons — write to the host's containing
  // `<g data-type="shape">` via the `onAlignmentChange` callback.
  const alignButtons: Array<{
    value: "start" | "middle" | "end";
    label: string;
    glyph: string;
  }> = [
    { value: "start", label: "Align left", glyph: "≡" },
    { value: "middle", label: "Center", glyph: "≣" },
    { value: "end", label: "Align right", glyph: "≡" },
  ];
  for (const a of alignButtons) {
    const btn = makeIconButton(a.glyph, a.label, () => {
      onAlignmentChange?.(a.value);
      onCommand?.("textAnchor", a.value);
      reposition();
    });
    btn.dataset["align"] = a.value;
    if (a.value === "start") {
      // Visual hint via text-align so the glyph slants left.
      btn.style.textAlign = "left";
      btn.textContent = "⇤";
    } else if (a.value === "end") {
      btn.style.textAlign = "right";
      btn.textContent = "⇥";
    } else {
      btn.textContent = "≡";
    }
    row2.appendChild(btn);
  }

  const div2 = document.createElement("span");
  div2.style.cssText = DIVIDER_STYLE;
  row2.appendChild(div2);

  // Color picker — native input wrapped in a labeled box.
  const colorWrap = document.createElement("label");
  colorWrap.title = "Text color";
  colorWrap.setAttribute("aria-label", "Text color");
  colorWrap.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid transparent;
    border-radius: 3px;
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
  // Don't steal focus on click — keep the contentEditable selection alive.
  colorWrap.addEventListener("mousedown", (e) => e.preventDefault());
  colorInput.addEventListener("mousedown", (e) => e.stopPropagation());
  colorInput.addEventListener("input", () => {
    const value = colorInput.value;
    colorGlyph.style.color = value;
    wrapSelectionWithStyle(host, "color", value);
    onCommand?.("color", value);
    reposition();
  });
  row2.appendChild(colorWrap);

  document.body.appendChild(toolbar);

  let visible = false;

  const showAt = (rect: DOMRect): void => {
    const margin = 8;
    const tw = toolbar.offsetWidth || 280;
    const th = toolbar.offsetHeight || 64;
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

/** Build a button with the standard mini-toolbar styling that
 *  preserves the contentEditable selection on click (no focus
 *  steal). */
function makeIconButton(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.style.cssText = BTN_STYLE;
  btn.textContent = glyph;
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });
  btn.addEventListener("click", onClick);
  return btn;
}

interface SelectOption {
  value: string;
  label: string;
}

/** Build a `<select>` with a placeholder header label and a
 *  callback that fires when the user picks a real option. The
 *  placeholder option remains selected after each pick so a
 *  second pick of the same value still fires `change`. */
function makeSelect(
  placeholder: string,
  options: ReadonlyArray<SelectOption>,
  onPick: (value: string) => void,
): HTMLSelectElement {
  const sel = document.createElement("select");
  sel.title = placeholder;
  sel.setAttribute("aria-label", placeholder);
  sel.style.cssText = SELECT_STYLE;
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = placeholder;
  ph.disabled = true;
  ph.selected = true;
  sel.appendChild(ph);
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  sel.addEventListener("mousedown", (e) => e.stopPropagation());
  sel.addEventListener("change", () => {
    const value = sel.value;
    if (!value) return;
    onPick(value);
    sel.value = "";
  });
  return sel;
}

/** Wrap the current selection's contents in a `<span style="...">`
 *  carrying the supplied CSS property. The wrap respects the host
 *  boundary — selections that touch DOM outside `host` are
 *  rejected. The new span becomes the active range so the toolbar
 *  stays anchored. */
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
  span.style[property] = value;
  const fragment = range.extractContents();
  span.appendChild(fragment);
  range.insertNode(span);
  sel.removeAllRanges();
  const next = document.createRange();
  next.selectNodeContents(span);
  sel.addRange(next);
  return true;
}

/** Step the active selection's font size up (`direction = +1`) or
 *  down (`direction = -1`) through the PowerPoint-style ladder.
 *  Existing per-run sizes snap to the nearest ladder entry so the
 *  next step lands on a predictable preset. */
function stepFontSize(host: HTMLElement, direction: 1 | -1): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return;
  // Read the current font-size on the start container (or its
  // nearest styled ancestor) and snap to the ladder.
  let node: Node | null = range.startContainer;
  let currentPx = 16; // sensible default
  while (node && node !== host) {
    if (node.nodeType === 1 /* element */) {
      const cs = window.getComputedStyle(node as Element);
      const px = Number.parseFloat(cs.fontSize);
      if (Number.isFinite(px) && px > 0) {
        currentPx = px;
        break;
      }
    }
    node = node.parentNode;
  }
  // Find the nearest ladder index, then step.
  let idx = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < SIZE_LADDER_PX.length; i++) {
    const d = Math.abs(SIZE_LADDER_PX[i]! - currentPx);
    if (d < bestDiff) {
      bestDiff = d;
      idx = i;
    }
  }
  const next = SIZE_LADDER_PX[Math.max(0, Math.min(SIZE_LADDER_PX.length - 1, idx + direction))]!;
  wrapSelectionWithStyle(host, "fontSize", `${next}px`);
}
