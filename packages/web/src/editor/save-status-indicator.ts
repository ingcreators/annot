/**
 * `<annot-save-status>` — compact save-state indicator for the editor
 * header. Follows the Google Docs / Notion convention:
 *
 *   [✓ Saved]        — idle, at rest
 *   [● Edited]       — edits made, autosave timer pending (brief)
 *   [↻ Saving…]      — write in progress (animated)
 *   [⚠ Save failed]  — last write raised an error (stays until next attempt)
 *
 * The indicator NEVER blocks interaction. It reports state; the app is
 * responsible for driving transitions by assigning `.status` at the
 * right points in the save lifecycle:
 *
 *   el.status = "pending"  → user edited, debounce timer running
 *   el.status = "saving"   → write started
 *   el.status = "saved"    → write completed
 *   el.status = "error"    → write threw
 *
 * Lit Phase 0 — first proof-of-concept migration from the imperative
 * `SaveStatusIndicator` class to a Lit element. Renders to light DOM
 * so the existing `.save-status` rules in `editor.css` apply without
 * churn (hybrid-CSS approach per `docs/plans/_done/lit-migration.md`).
 *
 * Uses Lit's `static properties` runtime API instead of field
 * decorators: the TC39 `accessor` keyword the decorator form requires
 * is left intact by Vite 8's oxc transformer, which Node 24 can't
 * parse. The runtime API is spec-stable and decorator-toolchain-
 * independent.
 */

import { type BuiltinIconId, builtinIcon } from "@ingcreators/annot-core";
import { html, LitElement } from "../lit.js";
import "../ui/annot-icon.js";

export type SaveStatus = "saved" | "pending" | "saving" | "error";

interface StatusSpec {
  icon: BuiltinIconId;
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

export class AnnotSaveStatusElement extends LitElement {
  static override properties = {
    status: { type: String },
  };

  // `declare` is type-only (no runtime class-field emit), so Lit's
  // `createProperty` can install its reactive getter/setter on the
  // prototype without a class-field initializer shadowing it.
  declare status: SaveStatus;

  constructor() {
    super();
    this.status = "saved";
  }

  // Light DOM so global `.save-status` / `.save-status-icon` CSS in
  // `@ingcreators/annot-core/styles/editor.css` applies unchanged.
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    const spec = STATUS_SPECS[this.status];
    return html`
      <annot-icon class="save-status-icon" .spec=${builtinIcon(spec.icon)}></annot-icon>
      <span class="save-status-label">${spec.label}</span>
    `;
  }

  protected override updated(): void {
    // The host element itself carries the `.save-status` surface
    // classes so descendant selectors (`.save-status .save-status-icon`)
    // continue matching. Set them here rather than in `render()`
    // because render() governs children, not host attributes.
    const spec = STATUS_SPECS[this.status];
    this.className = `save-status ${spec.className}`;
    this.setAttribute("role", "status");
    this.setAttribute("aria-live", "polite");
    this.setAttribute("aria-label", spec.ariaLabel);
    this.setAttribute("data-tooltip", spec.ariaLabel);
  }
}

if (!customElements.get("annot-save-status")) {
  customElements.define("annot-save-status", AnnotSaveStatusElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-save-status": AnnotSaveStatusElement;
  }
}
