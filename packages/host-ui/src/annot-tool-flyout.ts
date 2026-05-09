/**
 * `<annot-tool-flyout>` — popover body for the toolbar's variant
 * + Highlight-color pickers. Renders a row of chips with optional
 * inline SVG glyphs (variant flyout) or color swatches (highlight
 * flyout); the active chip is highlighted; clicking one fires a
 * `chip-select` `CustomEvent` carrying the chosen value.
 *
 * The popover positioning + click-outside dismissal stays with
 * `openAnchoredPopover` (in core); this element is appended INTO
 * the popover root and renders the chip strip declaratively.
 *
 * Lit Phase 5c — replaces the imperative DOM-builder closures
 * inside `Toolbar.#showVariantFlyout` and
 * `Toolbar.#showHighlightColorFlyout`.
 */

import { builtinIcon } from "@ingcreators/annot-core";
import { html, LitElement, nothing, unsafeHTML } from "./lit.js";
import "./annot-icon.js";

export interface ToolFlyoutChip {
  /** Identifier passed back in the `chip-select` event detail. */
  value: string;
  /** Material Symbols ligature name. Used when neither `svg` nor
   *  `color` is set. */
  icon?: string;
  /** Inline SVG markup. Takes precedence over `icon`. */
  svg?: string;
  /** When set, the chip is rendered as a color swatch instead of
   *  an icon glyph (used for the Highlight-color flyout). */
  color?: string;
  /** User-facing label for tooltip + aria-label. */
  label: string;
}

export interface ChipSelectDetail {
  value: string;
}

export class AnnotToolFlyoutElement extends LitElement {
  static override properties = {
    chips: { attribute: false },
    active: { type: String },
    /** "variant" → icon / svg chips; "color" → color-swatch
     *  chips. Drives the row className so the existing CSS
     *  vocabulary (`.tool-flyout-color-row`) matches. */
    layout: { type: String },
  };

  declare chips: ToolFlyoutChip[];
  declare active: string;
  declare layout: "variant" | "color";

  constructor() {
    super();
    this.chips = [];
    this.active = "";
    this.layout = "variant";
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    const rowClass =
      this.layout === "color" ? "tool-flyout-row tool-flyout-color-row" : "tool-flyout-row";
    return html`
      <div class=${rowClass}>
        ${this.chips.map((chip) => this.#renderChip(chip))}
      </div>
    `;
  }

  #renderChip(chip: ToolFlyoutChip) {
    const isActive = this.active === chip.value;
    const isColor = chip.color !== undefined;
    const cls = isColor
      ? `tool-flyout-color-chip${isActive ? " active" : ""}`
      : `tool-flyout-chip${chip.svg ? " tool-flyout-chip-svg" : ""}${isActive ? " active" : ""}`;
    const onClick = () => {
      this.dispatchEvent(
        new CustomEvent<ChipSelectDetail>("chip-select", {
          detail: { value: chip.value },
          bubbles: true,
        }),
      );
    };
    return html`
      <button
        type="button"
        class=${cls}
        data-tooltip=${chip.label}
        aria-label=${chip.label}
        style=${isColor ? `--swatch-color: ${chip.color}` : ""}
        @click=${onClick}
      >
        ${
          isColor
            ? nothing
            : chip.svg
              ? unsafeHTML(chip.svg)
              : chip.icon
                ? html`<annot-icon .spec=${builtinIcon(chip.icon)}></annot-icon>`
                : nothing
        }
      </button>
    `;
  }
}

if (!customElements.get("annot-tool-flyout")) {
  customElements.define("annot-tool-flyout", AnnotToolFlyoutElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-tool-flyout": AnnotToolFlyoutElement;
  }
}
