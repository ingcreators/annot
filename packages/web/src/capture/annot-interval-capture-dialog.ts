/**
 * `<annot-interval-capture-dialog>` — modal asking the user for
 * the interval seconds, frame count, and cursor visibility for
 * a timed screen-capture session.
 *
 * Lit Phase 6 — replaces the imperative DOM-builder closure
 * inside `showIntervalCaptureDialog` (`interval-dialog.ts`).
 * The Promise-based public function keeps the same shape; it
 * mounts this element + listens for the `capture-confirm` /
 * `capture-cancel` events.
 */

import { html, LitElement } from "../lit.js";

export type CursorMode = "always" | "motion" | "never";

export interface IntervalCaptureConfig {
  intervalSec: number;
  count: number;
  cursor: CursorMode;
}

export interface IntervalCaptureConfirmDetail {
  config: IntervalCaptureConfig;
}

export class AnnotIntervalCaptureDialogElement extends LitElement {
  static override properties = {
    intervalSec: { type: Number },
    frameCount: { type: Number },
    cursor: { type: String },
  };

  declare intervalSec: number;
  declare frameCount: number;
  declare cursor: CursorMode;

  #onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      this.#cancel();
    }
  };

  constructor() {
    super();
    this.intervalSec = 10;
    this.frameCount = 10;
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
    this.querySelector<HTMLInputElement>(".capture-dialog-input")?.focus();
  }

  override render() {
    return html`
      <div
        class="capture-dialog-overlay"
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) this.#cancel();
        }}
      >
        <div class="capture-dialog">
          <div class="capture-dialog-title">Timed screen capture</div>
          <div class="capture-dialog-desc">
            You'll be asked to pick a screen/window once. Frames will be captured at
            the configured interval.
          </div>

          <label class="capture-dialog-row">
            <span class="capture-dialog-label">Interval (seconds)</span>
            <input
              type="number"
              class="capture-dialog-input"
              min="1"
              max="3600"
              step="1"
              .value=${String(this.intervalSec)}
              @input=${(e: Event) => {
                this.intervalSec = Number.parseInt(
                  (e.currentTarget as HTMLInputElement).value,
                  10,
                );
              }}
              @keydown=${this.#onInputKeydown}
            />
          </label>

          <label class="capture-dialog-row">
            <span class="capture-dialog-label">Frame count</span>
            <input
              type="number"
              class="capture-dialog-input"
              min="1"
              max="1000"
              step="1"
              .value=${String(this.frameCount)}
              @input=${(e: Event) => {
                this.frameCount = Number.parseInt(
                  (e.currentTarget as HTMLInputElement).value,
                  10,
                );
              }}
              @keydown=${this.#onInputKeydown}
            />
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
              <option value="motion" ?selected=${this.cursor === "motion"}>Only when moving</option>
              <option value="never" ?selected=${this.cursor === "never"}>Hide</option>
            </select>
          </label>

          <div class="capture-dialog-actions">
            <button
              type="button"
              class="capture-dialog-btn"
              @click=${this.#cancel}
            >
              Cancel
            </button>
            <button
              type="button"
              class="capture-dialog-btn capture-dialog-btn-primary"
              @click=${this.#confirm}
            >
              Start
            </button>
          </div>
        </div>
      </div>
    `;
  }

  #onInputKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      this.#confirm();
    }
  };

  #confirm = (): void => {
    if (
      !Number.isFinite(this.intervalSec) ||
      this.intervalSec <= 0 ||
      !Number.isFinite(this.frameCount) ||
      this.frameCount <= 0
    ) {
      this.querySelector<HTMLInputElement>(".capture-dialog-input")?.focus();
      return;
    }
    this.dispatchEvent(
      new CustomEvent<IntervalCaptureConfirmDetail>("capture-confirm", {
        detail: {
          config: {
            intervalSec: this.intervalSec,
            count: this.frameCount,
            cursor: this.cursor,
          },
        },
        bubbles: true,
      }),
    );
  };

  #cancel = (): void => {
    this.dispatchEvent(new CustomEvent("capture-cancel", { bubbles: true }));
  };
}

if (!customElements.get("annot-interval-capture-dialog")) {
  customElements.define(
    "annot-interval-capture-dialog",
    AnnotIntervalCaptureDialogElement,
  );
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-interval-capture-dialog": AnnotIntervalCaptureDialogElement;
  }
}
