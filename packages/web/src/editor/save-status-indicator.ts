/**
 * SaveStatusIndicator — compact save-state indicator for the editor
 * header. Follows the Google Docs / Notion convention:
 *
 *   [✓ Saved]      — idle, at rest
 *   [● Edited]     — edits made, autosave timer pending (brief)
 *   [↻ Saving…]    — write in progress (animated)
 *   [⚠ Save failed] — last write raised an error (stays until next attempt)
 *
 * The indicator NEVER blocks interaction. It reports state; the app is
 * responsible for driving transitions by calling setStatus() at the right
 * points in the save lifecycle.
 *
 * Intended lifecycle:
 *   setStatus("pending")  → user edited, debounce timer running
 *   setStatus("saving")   → write started
 *   setStatus("saved")    → write completed
 *   setStatus("error")    → write threw
 */

export type SaveStatus = "saved" | "pending" | "saving" | "error";

interface StatusSpec {
  icon: string; // Material Symbols icon name
  label: string;
  className: string;
  ariaLabel: string;
}

const STATUS_SPECS: Record<SaveStatus, StatusSpec> = {
  saved: {
    icon: "cloud_done",
    label: "Saved",
    className: "save-status-saved",
    ariaLabel: "All changes saved",
  },
  pending: {
    icon: "edit",
    label: "Edited",
    className: "save-status-pending",
    ariaLabel: "Unsaved changes — will auto-save shortly",
  },
  saving: {
    icon: "sync",
    label: "Saving…",
    className: "save-status-saving",
    ariaLabel: "Saving changes",
  },
  error: {
    icon: "cloud_off",
    label: "Save failed",
    className: "save-status-error",
    ariaLabel: "Save failed — changes may not be persisted",
  },
};

import { setTooltip } from "@ingcreators/annot-core/utils";

export class SaveStatusIndicator {
  #el: HTMLElement;
  #iconEl: HTMLElement;
  #labelEl: HTMLElement;
  #status: SaveStatus = "saved";

  constructor(container: HTMLElement) {
    this.#el = document.createElement("span");
    this.#el.className = "save-status";
    this.#el.setAttribute("role", "status");
    this.#el.setAttribute("aria-live", "polite");

    this.#iconEl = document.createElement("span");
    this.#iconEl.className = "save-status-icon material-symbols-outlined";
    this.#el.appendChild(this.#iconEl);

    this.#labelEl = document.createElement("span");
    this.#labelEl.className = "save-status-label";
    this.#el.appendChild(this.#labelEl);

    container.appendChild(this.#el);
    this.#render();
  }

  setStatus(status: SaveStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#render();
  }

  #render(): void {
    const spec = STATUS_SPECS[this.#status];
    // Reset status-specific classes then apply the new one, keeping the
    // base `save-status` class intact.
    this.#el.className = `save-status ${spec.className}`;
    this.#el.setAttribute("aria-label", spec.ariaLabel);
    setTooltip(this.#el, spec.ariaLabel);
    this.#iconEl.textContent = spec.icon;
    this.#labelEl.textContent = spec.label;
  }

  destroy(): void {
    this.#el.remove();
  }
}
