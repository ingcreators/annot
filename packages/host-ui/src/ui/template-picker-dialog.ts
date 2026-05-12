/**
 * `showTemplatePickerDialog` — full-viewport modal that mounts
 * `<annot-template-picker>` and resolves with the chosen entry.
 *
 * Phase 8d of `docs/plans/_done/annot-html-document.md`. Closes the
 * loop the previous three Phase-8 rows opened:
 *
 *   - Phase 8a → `cloneTemplate` (Tier A): READ-side helper.
 *   - Phase 8b → "Save as template…" dialog: WRITE side.
 *   - Phase 8c → `<annot-template-picker>` Lit element:
 *     presentational layer.
 *   - Phase 8d → THIS modal + the file-manager "From
 *     Template…" entry that hosts it: data + flow layer.
 *
 * The dialog is stylistically aligned with the
 * `app-dialog-overlay` chrome but uses a wider container
 * (`max-width: 920px`) so the card grid renders without
 * cramping. Same dismissal triggers as the existing dialogs:
 *
 *   - Esc key.
 *   - Click on the overlay (outside the panel).
 *   - The dedicated Cancel button in the footer.
 *
 * The caller is responsible for fetching + filtering the
 * `Templates/` folder before invocation. The helper is
 * presentation-only — it doesn't reach into storage, doesn't
 * call `cloneTemplate`, and doesn't navigate. The parent picks
 * up the resolved `TemplateSelectedDetail` and orchestrates the
 * post-selection flow (load bytes → `parseDocument` →
 * `cloneTemplate` → `storage.saveDocument` → push route).
 *
 * Pattern intentionally mirrors `showSaveAsTemplateDialog` so
 * both halves of the templates-mechanism feel uniform.
 */

import "../annot-template-picker.js";
import type {
  AnnotTemplatePickerElement,
  BuiltinTemplateEntry,
  TemplateSelectedDetail,
  UserTemplateEntry,
} from "../annot-template-picker.js";

export interface ShowTemplatePickerDialogOptions {
  readonly userTemplates?: readonly UserTemplateEntry[];
  readonly builtinTemplates?: readonly BuiltinTemplateEntry[];
  /** Show the "Loading…" state in the user-templates section.
   *  Useful when the parent kicks off `listDocuments` lazily
   *  and wants to mount the dialog immediately so the
   *  built-in row is visible. */
  readonly loadingUser?: boolean;
  /** localStorage key for recently-used IDs. Defaults to the
   *  shared `annot-recent-templates`. */
  readonly recentKey?: string;
  /** Title shown in the dialog header. Defaults to "Choose a
   *  template". */
  readonly title?: string;
  /** Cancel button label. Defaults to "Cancel". */
  readonly cancelLabel?: string;
}

const STYLES_INSTALLED = "annot-template-picker-dialog-styles";
const PICKER_DIALOG_CSS = `
.annot-template-picker-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1500;
  animation: app-dialog-fade 0.12s ease-out;
}
.annot-template-picker-dialog-panel {
  background: var(--annot-bg-panel, #ffffff);
  color: var(--annot-text-primary, inherit);
  border: 1px solid var(--annot-border-color, #d1d5db);
  border-radius: 12px;
  width: min(920px, 92vw);
  max-height: 80vh;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  display: grid;
  grid-template-rows: auto 1fr auto;
  overflow: hidden;
  animation: app-dialog-pop 0.14s cubic-bezier(0.2, 0, 0.2, 1);
}
.annot-template-picker-dialog-header {
  padding: 14px 18px;
  border-bottom: 1px solid var(--annot-border-color, #d1d5db);
  font-size: 17px;
  font-weight: 600;
}
.annot-template-picker-dialog-body {
  padding: 12px 16px;
  overflow: auto;
}
.annot-template-picker-dialog-footer {
  padding: 10px 16px;
  border-top: 1px solid var(--annot-border-color, #d1d5db);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.annot-template-picker-dialog-footer button {
  padding: 8px 14px;
  border: 1px solid var(--annot-border-color, #d1d5db);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 0.875rem;
}
.annot-template-picker-dialog-footer button:hover {
  border-color: var(--annot-accent, #2563eb);
}
`;

/** One-time inject of the dialog's chrome stylesheet into
 *  `<head>`. Cheap dedupe via the `id` attribute. */
function installStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLES_INSTALLED)) return;
  const style = document.createElement("style");
  style.id = STYLES_INSTALLED;
  style.textContent = PICKER_DIALOG_CSS;
  document.head.appendChild(style);
}

/**
 * Show the template-picker dialog. Resolves with the chosen
 * entry's `TemplateSelectedDetail` on click, or `null` on
 * Cancel / Esc / overlay-click.
 */
export function showTemplatePickerDialog(
  opts: ShowTemplatePickerDialogOptions = {},
): Promise<TemplateSelectedDetail | null> {
  return new Promise((resolve) => {
    installStyles();

    const overlay = document.createElement("div");
    overlay.className = "annot-template-picker-dialog-overlay";

    const panel = document.createElement("div");
    panel.className = "annot-template-picker-dialog-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");

    const header = document.createElement("div");
    header.className = "annot-template-picker-dialog-header";
    header.textContent = opts.title ?? "Choose a template";

    const body = document.createElement("div");
    body.className = "annot-template-picker-dialog-body";

    const picker = document.createElement("annot-template-picker") as AnnotTemplatePickerElement;
    picker.userTemplates = opts.userTemplates ?? [];
    picker.builtinTemplates = opts.builtinTemplates ?? [];
    picker.loadingUser = opts.loadingUser ?? false;
    if (opts.recentKey !== undefined) picker.recentKey = opts.recentKey;
    body.appendChild(picker);

    const footer = document.createElement("div");
    footer.className = "annot-template-picker-dialog-footer";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = opts.cancelLabel ?? "Cancel";
    footer.appendChild(cancelBtn);

    panel.append(header, body, footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    let resolved = false;
    const close = (value: TemplateSelectedDetail | null) => {
      if (resolved) return;
      resolved = true;
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
      resolve(value);
    };

    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(null);
      }
    };
    document.addEventListener("keydown", onKeydown, true);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(null);
    });

    cancelBtn.addEventListener("click", () => close(null));

    picker.addEventListener("template-selected", (e) => {
      const detail = (e as CustomEvent<TemplateSelectedDetail>).detail;
      close(detail);
    });
  });
}
