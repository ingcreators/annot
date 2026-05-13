/**
 * `<annot-capture-screen-dialog>` — modal asking the user to pick
 * a capture mode (Auto Capture or Capture Once) before starting
 * a screen-share session.
 *
 * Phases 1 + 4 of `docs/plans/web-capture-redesign.md`. Auto
 * Capture is the default selection. The originally-planned
 * Capture Area mode was retired during the rollout — users get
 * the same outcome by running Capture Once and cropping in the
 * editor.
 *
 * Lit Phase 6 — light DOM, no decorators, `annot-` prefix. Mounts
 * via `showCaptureScreenDialog()` (capture-screen-dialog.ts), the
 * Promise wrapper that listens for `capture-confirm` /
 * `capture-cancel`.
 */

import { SAVE_SIZE_LABEL, type SaveSizePreset } from "@ingcreators/annot-core/encode/options";
import { html, LitElement } from "../lit.js";
import type { CursorMode } from "./capture-prefs.js";
import type { CaptureMode } from "./types.js";

/** Detail dispatched on `capture-confirm`. */
export interface CaptureScreenDialogConfirmDetail {
  mode: CaptureMode;
  cursor: CursorMode;
  /** Save-size preset the user picked. The host should persist it
   *  via `saveEncodeOptions` so future captures + the (future)
   *  Browser Extension settings UI see the same value. */
  saveSizePreset: SaveSizePreset;
}

const SAVE_SIZE_OPTIONS: readonly SaveSizePreset[] = [
  "light",
  "standard",
  "highQuality",
  "original",
];

interface ModeChip {
  mode: CaptureMode;
  label: string;
  description: string;
}

const MODE_CHIPS: readonly ModeChip[] = [
  {
    mode: "auto",
    label: "Auto Capture",
    description: "Automatically capture meaningful screen changes. Recommended for procedures.",
  },
  {
    mode: "once",
    label: "Capture Once",
    description:
      "Capture the current shared screen as a single image. Crop in the editor if you need a specific region.",
  },
];

export class AnnotCaptureScreenDialogElement extends LitElement {
  static override properties = {
    mode: { type: String },
    cursor: { type: String },
    saveSizePreset: { type: String },
  };

  declare mode: CaptureMode;
  declare cursor: CursorMode;
  declare saveSizePreset: SaveSizePreset;

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
    // Phase 4 of `docs/plans/web-capture-redesign.md` — Auto
    // Capture is now the default selection. `loadModePreference`
    // (used by `showCaptureScreenDialog`) returns `"auto"` when
    // nothing is stored, which matches.
    this.mode = "auto";
    this.cursor = "always";
    // Default mirrors `DEFAULT_ENCODE_OPTIONS.saveSizePreset`.
    // The Promise wrapper (`capture-screen-dialog.ts`) overrides
    // it with the user's persisted preference at mount time.
    this.saveSizePreset = "standard";
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
                  @click=${() => {
                    this.mode = chip.mode;
                  }}
                >
                  <div class="capture-screen-mode-label">${chip.label}</div>
                  <div class="capture-screen-mode-desc">${chip.description}</div>
                </button>
              `,
            )}
          </div>

          <label class="capture-dialog-row">
            <span class="capture-dialog-label">Save size</span>
            <select
              class="capture-dialog-select"
              .value=${this.saveSizePreset}
              @change=${(e: Event) => {
                this.saveSizePreset = (e.currentTarget as HTMLSelectElement)
                  .value as SaveSizePreset;
              }}
            >
              ${SAVE_SIZE_OPTIONS.map(
                (preset) => html`
                  <option value=${preset} ?selected=${this.saveSizePreset === preset}>
                    ${SAVE_SIZE_LABEL[preset]}
                  </option>
                `,
              )}
            </select>
          </label>

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
    return `${base}${active}`;
  }

  #confirm = (): void => {
    this.dispatchEvent(
      new CustomEvent<CaptureScreenDialogConfirmDetail>("capture-confirm", {
        detail: {
          mode: this.mode,
          cursor: this.cursor,
          saveSizePreset: this.saveSizePreset,
        },
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
