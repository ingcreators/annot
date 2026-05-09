/**
 * `<annot-apply-redactions-button>` — "Apply redactions to image"
 * action surface.
 *
 * Phase 3 of [`docs/plans/_done/redact-burn-into-image.md`](../../../docs/plans/_done/redact-burn-into-image.md) —
 * the per-host UI half of the privacy-driven "make redaction
 * permanent" action. Phase 1 added the Tier C-render helper and
 * Phase 2 added `EditorShell.applyAllRedactions`; this component
 * surfaces that orchestration to the user.
 *
 * Wiring contract (one of the host's right-panel sections mounts
 * one of these):
 *
 *   - Set `count` to the current redact-element count. The button
 *     is disabled when `count === 0` so callers don't have to
 *     conditionally render it (mounting + hiding via `count = 0` is
 *     equivalent to not mounting at all). Non-zero `count` is part
 *     of the dialog's body text ("N redaction(s) will be permanently
 *     baked into the image …").
 *   - Set `onApply` to a Promise-returning callback. The host
 *     usually wires this to `editorShell.applyAllRedactions()` and
 *     hooks the resulting count into a status-bar toast (Phase 5).
 *
 * Click flow:
 *   1. Open `showConfirmDialog` (the existing destructive-style
 *      modal in `./ui/dialog.ts`) with the plan's body text.
 *   2. On confirm → run `onApply()`, then dispatch an `applied`
 *      CustomEvent (`detail: { count }`) so the host can toast.
 *   3. On cancel / Esc / outside-click → no-op.
 *
 * Hosts: PWA (right-panel — wired in this same PR), VSCode +
 * Desktop (Phase 6 — same component, mounted in the host's
 * equivalent action area).
 *
 * Light DOM + `display: contents` so the wrapper integrates
 * transparently into the right-panel's flex column layout (matches
 * the existing right-panel sections).
 */

import { builtinIcon } from "@ingcreators/annot-core";
import "./annot-icon.js";
import { html, LitElement } from "./lit.js";
import { showConfirmDialog } from "./ui/dialog.js";

/** Detail payload for the `applied` CustomEvent fired after a
 *  successful burn-in. Hosts wire this to a status-bar toast in
 *  Phase 5. */
export interface ApplyRedactionsAppliedDetail {
  count: number;
}

export class AnnotApplyRedactionsButtonElement extends LitElement {
  static override properties = {
    count: { type: Number },
    onApply: { attribute: false },
  };

  declare count: number;
  declare onApply: (() => Promise<{ count: number }>) | null;

  /** Set to true while the confirm dialog is open or the burn is
   *  running, so a quick double-click doesn't fire two apply
   *  passes. Reset when the dialog resolves. */
  #busy = false;

  constructor() {
    super();
    this.count = 0;
    this.onApply = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    const disabled = this.count === 0 || this.#busy || this.onApply === null;
    return html`
      <button
        type="button"
        class="annot-apply-redactions-btn"
        title=${
          this.count === 0 ? "No redactions to apply" : `Apply ${this.count} redaction(s) to image`
        }
        aria-label="Apply redactions to image"
        ?disabled=${disabled}
        @click=${this.#onClick}
      >
        <annot-icon .spec=${builtinIcon("visibility_off")}></annot-icon>
        <span class="annot-apply-redactions-label">Apply redactions to image</span>
      </button>
    `;
  }

  #onClick = async (): Promise<void> => {
    if (this.#busy) return;
    if (this.count === 0) return;
    const onApply = this.onApply;
    if (!onApply) return;

    this.#busy = true;
    this.requestUpdate();
    try {
      const ok = await showConfirmDialog({
        title: "Apply redactions to image?",
        message:
          `${this.count} redaction(s) will be permanently baked into the image. ` +
          "The original pixels under each redaction can no longer be recovered " +
          "after the next save. Continue?",
        okLabel: "Apply",
        cancelLabel: "Cancel",
        danger: true,
      });
      if (!ok) return;
      const result = await onApply();
      this.dispatchEvent(
        new CustomEvent<ApplyRedactionsAppliedDetail>("applied", {
          bubbles: true,
          composed: true,
          detail: { count: result.count },
        }),
      );
    } finally {
      this.#busy = false;
      this.requestUpdate();
    }
  };
}

if (!customElements.get("annot-apply-redactions-button")) {
  customElements.define("annot-apply-redactions-button", AnnotApplyRedactionsButtonElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-apply-redactions-button": AnnotApplyRedactionsButtonElement;
  }
}
