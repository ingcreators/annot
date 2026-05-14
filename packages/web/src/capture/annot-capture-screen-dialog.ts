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
 *
 * Advanced settings (collapsed by default per spec §6.6):
 * - Encode group: format / smart-fallback / JPEG quality —
 *   shared with the Browser Extension via
 *   `@ingcreators/annot-core/encode/options`.
 * - Auto Capture group (mode === "auto" only): interval /
 *   sensitivity / stable-wait / cursor-only-ignore — shared via
 *   `@ingcreators/annot-core/auto-capture-options`.
 */

import {
  CAPTURE_INTERVAL_LABEL,
  type CaptureIntervalPreset,
  CHANGE_SENSITIVITY_LABEL,
  type ChangeSensitivityPreset,
  STABLE_WAIT_LABEL,
  type StableWaitPreset,
} from "@ingcreators/annot-core/auto-capture-options";
import {
  type EncodeFormat,
  SAVE_SIZE_LABEL,
  type SaveSizePreset,
} from "@ingcreators/annot-core/encode/options";
import { html, LitElement, nothing } from "../lit.js";
import type { CursorMode } from "./capture-prefs.js";
import type { CaptureMode } from "./types.js";

/** Detail dispatched on `capture-confirm`. The wrapper persists
 *  each field to its respective shared options blob so future
 *  captures + the (future) Browser Extension surface see the
 *  same values. */
export interface CaptureScreenDialogConfirmDetail {
  mode: CaptureMode;
  cursor: CursorMode;
  saveSizePreset: SaveSizePreset;
  /** Encode pipeline format. */
  format: EncodeFormat;
  /** Smart-mode fallback when source is photo-heavy. */
  smartFallback: "png" | "jpeg";
  /** JPEG quality 60-100%. Used for `format: "jpeg"` and smart's
   *  JPEG fallback. */
  jpegPercent: number;
  /** Auto Capture engine: sampling cadence preset. */
  autoInterval: CaptureIntervalPreset;
  /** Auto Capture engine: diff sensitivity preset. */
  autoSensitivity: ChangeSensitivityPreset;
  /** Auto Capture engine: stable-wait preset. */
  autoStableWait: StableWaitPreset;
  /** Auto Capture engine: drop frames whose only change is
   *  cursor-shaped. */
  autoIgnoreCursorOnlyChanges: boolean;
}

const SAVE_SIZE_OPTIONS: readonly SaveSizePreset[] = [
  "light",
  "standard",
  "highQuality",
  "original",
];
const FORMAT_OPTIONS: readonly { value: EncodeFormat; label: string }[] = [
  { value: "smart", label: "Smart (PNG-8 / fallback)" },
  { value: "png", label: "PNG (lossless)" },
  { value: "jpeg", label: "JPEG (compressed)" },
];
const SMART_FALLBACK_OPTIONS: readonly { value: "png" | "jpeg"; label: string }[] = [
  { value: "png", label: "PNG (lossless, larger)" },
  { value: "jpeg", label: "JPEG (compressed, smaller)" },
];
const INTERVAL_OPTIONS: readonly CaptureIntervalPreset[] = ["fast", "standard", "slow"];
const SENSITIVITY_OPTIONS: readonly ChangeSensitivityPreset[] = ["sensitive", "standard", "major"];
const STABLE_WAIT_OPTIONS: readonly StableWaitPreset[] = ["none", "short", "long"];

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
    format: { type: String },
    smartFallback: { type: String },
    jpegPercent: { type: Number },
    autoInterval: { type: String },
    autoSensitivity: { type: String },
    autoStableWait: { type: String },
    autoIgnoreCursorOnlyChanges: { type: Boolean },
  };

  declare mode: CaptureMode;
  declare cursor: CursorMode;
  declare saveSizePreset: SaveSizePreset;
  declare format: EncodeFormat;
  declare smartFallback: "png" | "jpeg";
  declare jpegPercent: number;
  declare autoInterval: CaptureIntervalPreset;
  declare autoSensitivity: ChangeSensitivityPreset;
  declare autoStableWait: StableWaitPreset;
  declare autoIgnoreCursorOnlyChanges: boolean;

  #onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      this.#cancel();
    } else if (e.key === "Enter") {
      // Allow Enter from anywhere inside the dialog (so a non-input
      // focus like the mode chip button still confirms). Skip
      // when focus is on an interactive control inside the
      // collapsed Advanced section so users can edit numbers.
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName !== "BUTTON" &&
        target?.tagName !== "INPUT" &&
        target?.tagName !== "SELECT"
      ) {
        e.preventDefault();
        this.#confirm();
      }
    }
  };

  constructor() {
    super();
    // Defaults mirror the various `DEFAULT_*` blobs. The Promise
    // wrapper (`capture-screen-dialog.ts`) overrides each field
    // with the user's persisted preferences at mount time.
    this.mode = "auto";
    this.cursor = "always";
    this.saveSizePreset = "standard";
    this.format = "smart";
    this.smartFallback = "png";
    this.jpegPercent = 92;
    this.autoInterval = "standard";
    this.autoSensitivity = "standard";
    this.autoStableWait = "short";
    this.autoIgnoreCursorOnlyChanges = true;
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

          ${this.#renderAdvancedSection()}

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

  /** Collapsed-by-default `<details>`. Keeps the basic dialog
   *  surface the same height it was before Advanced settings
   *  landed; expanded state is per-mount only (the user opens it
   *  when they need to tweak, then it folds back next time the
   *  dialog appears). */
  #renderAdvancedSection() {
    const showJpegQuality = this.format === "jpeg" || this.smartFallback === "jpeg";
    return html`
      <details class="capture-dialog-advanced">
        <summary class="capture-dialog-advanced-summary">Advanced settings</summary>

        <div class="capture-dialog-advanced-group">
          <div class="capture-dialog-advanced-group-title">Image encoding</div>

          <label class="capture-dialog-row">
            <span class="capture-dialog-label">Format</span>
            <select
              class="capture-dialog-select"
              .value=${this.format}
              @change=${(e: Event) => {
                this.format = (e.currentTarget as HTMLSelectElement).value as EncodeFormat;
              }}
            >
              ${FORMAT_OPTIONS.map(
                (opt) => html`
                  <option value=${opt.value} ?selected=${this.format === opt.value}>
                    ${opt.label}
                  </option>
                `,
              )}
            </select>
          </label>

          ${
            this.format === "smart"
              ? html`<label class="capture-dialog-row">
                  <span class="capture-dialog-label">Smart fallback</span>
                  <select
                    class="capture-dialog-select"
                    .value=${this.smartFallback}
                    @change=${(e: Event) => {
                      this.smartFallback = (e.currentTarget as HTMLSelectElement).value as
                        | "png"
                        | "jpeg";
                    }}
                  >
                    ${SMART_FALLBACK_OPTIONS.map(
                      (opt) => html`
                        <option value=${opt.value} ?selected=${this.smartFallback === opt.value}>
                          ${opt.label}
                        </option>
                      `,
                    )}
                  </select>
                </label>`
              : nothing
          }

          ${
            showJpegQuality
              ? html`<label class="capture-dialog-row">
                  <span class="capture-dialog-label">JPEG quality</span>
                  <input
                    type="number"
                    class="capture-dialog-input"
                    min="60"
                    max="100"
                    step="1"
                    .value=${String(this.jpegPercent)}
                    @input=${(e: Event) => {
                      const v = Number.parseInt((e.currentTarget as HTMLInputElement).value, 10);
                      if (Number.isFinite(v)) {
                        this.jpegPercent = Math.max(60, Math.min(100, v));
                      }
                    }}
                  />
                </label>`
              : nothing
          }
        </div>

        ${
          this.mode === "auto"
            ? html`<div class="capture-dialog-advanced-group">
                <div class="capture-dialog-advanced-group-title">Auto Capture</div>

                <label class="capture-dialog-row">
                  <span class="capture-dialog-label">Capture interval</span>
                  <select
                    class="capture-dialog-select"
                    .value=${this.autoInterval}
                    @change=${(e: Event) => {
                      this.autoInterval = (e.currentTarget as HTMLSelectElement)
                        .value as CaptureIntervalPreset;
                    }}
                  >
                    ${INTERVAL_OPTIONS.map(
                      (preset) => html`
                        <option value=${preset} ?selected=${this.autoInterval === preset}>
                          ${CAPTURE_INTERVAL_LABEL[preset]}
                        </option>
                      `,
                    )}
                  </select>
                </label>

                <label class="capture-dialog-row">
                  <span class="capture-dialog-label">Change sensitivity</span>
                  <select
                    class="capture-dialog-select"
                    .value=${this.autoSensitivity}
                    @change=${(e: Event) => {
                      this.autoSensitivity = (e.currentTarget as HTMLSelectElement)
                        .value as ChangeSensitivityPreset;
                    }}
                  >
                    ${SENSITIVITY_OPTIONS.map(
                      (preset) => html`
                        <option value=${preset} ?selected=${this.autoSensitivity === preset}>
                          ${CHANGE_SENSITIVITY_LABEL[preset]}
                        </option>
                      `,
                    )}
                  </select>
                </label>

                <label class="capture-dialog-row">
                  <span class="capture-dialog-label">Stable wait</span>
                  <select
                    class="capture-dialog-select"
                    .value=${this.autoStableWait}
                    @change=${(e: Event) => {
                      this.autoStableWait = (e.currentTarget as HTMLSelectElement)
                        .value as StableWaitPreset;
                    }}
                  >
                    ${STABLE_WAIT_OPTIONS.map(
                      (preset) => html`
                        <option value=${preset} ?selected=${this.autoStableWait === preset}>
                          ${STABLE_WAIT_LABEL[preset]}
                        </option>
                      `,
                    )}
                  </select>
                </label>

                <label class="capture-dialog-row capture-dialog-row-checkbox">
                  <input
                    type="checkbox"
                    .checked=${this.autoIgnoreCursorOnlyChanges}
                    @change=${(e: Event) => {
                      this.autoIgnoreCursorOnlyChanges = (
                        e.currentTarget as HTMLInputElement
                      ).checked;
                    }}
                  />
                  <span class="capture-dialog-label">Ignore cursor-only changes</span>
                </label>
              </div>`
            : nothing
        }
      </details>
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
          format: this.format,
          smartFallback: this.smartFallback,
          jpegPercent: this.jpegPercent,
          autoInterval: this.autoInterval,
          autoSensitivity: this.autoSensitivity,
          autoStableWait: this.autoStableWait,
          autoIgnoreCursorOnlyChanges: this.autoIgnoreCursorOnlyChanges,
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
