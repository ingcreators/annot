/**
 * `<annot-capture-screen-dialog>` — modal asking the user to pick
 * one of three capture modes (Auto Capture / Capture Once /
 * Capture Area) before starting a screen-share session.
 *
 * Phase 1 of `docs/plans/web-capture-redesign.md`. Only `once` is
 * enabled in this phase; the other two render disabled with a
 * "Coming soon" hint. Phase 4 enables `auto` and makes it the
 * default; the deferred Capture Area work enables `area`.
 *
 * Lit Phase 6 — light DOM, no decorators, `annot-` prefix. Mounts
 * via `showCaptureScreenDialog()` (capture-screen-dialog.ts), the
 * Promise wrapper that listens for `capture-confirm` /
 * `capture-cancel`.
 */

import { html, LitElement } from "../lit.js";
import type { CursorMode } from "./capture-prefs.js";
import type { CaptureMode } from "./types.js";

/** Detail dispatched on `capture-confirm`. */
export interface CaptureScreenDialogConfirmDetail {
  mode: CaptureMode;
  cursor: CursorMode;
}

interface ModeChip {
  mode: CaptureMode;
  label: string;
  description: string;
  enabled: boolean;
  comingSoon?: string;
}

const MODE_CHIPS: readonly ModeChip[] = [
  {
    mode: "auto",
    label: "Auto Capture",
    description: "Automatically capture meaningful screen changes.",
    enabled: false,
    comingSoon: "Coming soon",
  },
  {
    mode: "once",
    label: "Capture Once",
    description: "Capture the current shared screen as a single image.",
    enabled: true,
  },
  {
    mode: "area",
    label: "Capture Area",
    description: "Select an area from the shared preview and capture it.",
    enabled: false,
    comingSoon: "Coming soon",
  },
];

export class AnnotCaptureScreenDialogElement extends LitElement {
  static override properties = {
    mode: { type: String },
    cursor: { type: String },
  };

  declare mode: CaptureMode;
  declare cursor: CursorMode;

  #onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      this.#cancel();
    } else if (e.key === "Enter") {
      // Allow Enter from anywhere inside the dialog (so a non-input
      // focus like the mode chip button still confirms).
      const target = e.target as HTMLElement | null;
      if (target?.tagName !== "BUTTON") {
        e.preventDefault();
        this.#confirm();
      }
    }
  };

  constructor() {
    super();
    this.mode = "once";
    this.cursor = "always";
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("keydown", this.#onKey);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("keydown", this.#onKey);
  }

  protected override firstUpdated(): void {
    this.querySelector<HTMLButtonElement>(".capture-screen-mode-chip-active")?.focus();
  }

  override render() {
    return html`
      <div
        class="capture-dialog-overlay"
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) this.#cancel();
        }}
      >
        <div class="capture-dialog capture-screen-dialog" role="dialog" aria-modal="true">
          <div class="capture-dialog-title">Capture Screen</div>
          <div class="capture-dialog-desc">Choose a capture mode</div>

          <div class="capture-screen-mode-list" role="radiogroup">
            ${MODE_CHIPS.map(
              (chip) => html`
                <button
                  type="button"
                  role="radio"
                  aria-checked=${this.mode === chip.mode}
                  class=${this.#chipClass(chip)}
                  ?disabled=${!chip.enabled}
                  @click=${() => {
                    if (chip.enabled) this.mode = chip.mode;
                  }}
                >
                  <div class="capture-screen-mode-label">
                    ${chip.label}
                    ${
                      chip.comingSoon
                        ? html`<span class="capture-screen-mode-coming-soon"
                            >${chip.comingSoon}</span
                          >`
                        : null
                    }
                  </div>
                  <div class="capture-screen-mode-desc">${chip.description}</div>
                </button>
              `,
            )}
          </div>

          <label class="capture-dialog-row">
            <span class="capture-dialog-label">Mouse cursor</span>
            <select
              class="capture-dialog-select"
              .value=${this.cursor}
              @change=${(e: Event) => {
                this.cursor = (e.currentTarget as HTMLSelectElement).value as CursorMode;
              }}
            >
              <option value="always" ?selected=${this.cursor === "always"}>Always show</option>
              <option value="motion" ?selected=${this.cursor === "motion"}>
                Only when moving
              </option>
              <option value="never" ?selected=${this.cursor === "never"}>Hide</option>
            </select>
          </label>

          <div class="capture-dialog-actions">
            <button type="button" class="capture-dialog-btn" @click=${this.#cancel}>Cancel</button>
            <button
              type="button"
              class="capture-dialog-btn capture-dialog-btn-primary"
              ?disabled=${!this.#selectedChipEnabled()}
              @click=${this.#confirm}
            >
              Start Screen Share
            </button>
          </div>
        </div>
      </div>
    `;
  }

  #chipClass(chip: ModeChip): string {
    const base = "capture-screen-mode-chip";
    const active = this.mode === chip.mode ? " capture-screen-mode-chip-active" : "";
    const disabled = chip.enabled ? "" : " capture-screen-mode-chip-disabled";
    return `${base}${active}${disabled}`;
  }

  #selectedChipEnabled(): boolean {
    return MODE_CHIPS.find((c) => c.mode === this.mode)?.enabled === true;
  }

  #confirm = (): void => {
    if (!this.#selectedChipEnabled()) return;
    this.dispatchEvent(
      new CustomEvent<CaptureScreenDialogConfirmDetail>("capture-confirm", {
        detail: { mode: this.mode, cursor: this.cursor },
        bubbles: true,
      }),
    );
  };

  #cancel = (): void => {
    this.dispatchEvent(new CustomEvent("capture-cancel", { bubbles: true }));
  };
}

if (!customElements.get("annot-capture-screen-dialog")) {
  customElements.define("annot-capture-screen-dialog", AnnotCaptureScreenDialogElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-capture-screen-dialog": AnnotCaptureScreenDialogElement;
  }
}
