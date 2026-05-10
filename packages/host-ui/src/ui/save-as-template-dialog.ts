/**
 * `showSaveAsTemplateDialog` — modal that collects the name /
 * description / tags fields needed to mark a document as a
 * template and persist it under `Templates/<name>.annot.html`.
 *
 * Phase 8b of `docs/plans/annot-html-document.md` — pairs with
 * Phase 8a's `cloneTemplate` (Tier A) helper. Save-as-template
 * is the WRITE side: stamp `meta.template = {name, description,
 * tags}` onto the current document, serialise, and hand off to
 * `storage.saveDocument` via the calling host. `cloneTemplate`
 * is the READ side: parse a template, strip the markers, mint
 * fresh image-block IDs, return an editable clone.
 *
 * Pattern mirrors `showPromptDialog` / `showConfirmDialog` in
 * `./dialog.ts`: thin Promise-based wrapper around
 * `<annot-dialog>`. The dialog itself owns the chrome (overlay,
 * title, OK/Cancel actions, Esc handling); this helper owns the
 * three field inputs + validation.
 *
 * Validation:
 *   - `name` is required and stripped.
 *   - `name` may not contain `/`, `\`, or `..`. The save path
 *     is `Templates/${name}.annot.html`; allowing path
 *     separators would let the user escape the templates folder.
 *   - The caller is responsible for filename uniqueness — the
 *     storage backend's `saveDocument` already runs the
 *     dedupe-by-suffix pass, so the dialog doesn't need to
 *     pre-check.
 */

import "./annot-dialog.js";

export interface SaveAsTemplateInput {
  /** Plain template name (no extension, no path). The caller
   *  combines this with `Templates/` + `.annot.html` when
   *  computing the save filename. */
  readonly name: string;
  /** Optional human-readable description. Stored in
   *  `meta.template.description` (and shown in the picker as
   *  hover text). Empty string after `.trim()` is normalised
   *  to `undefined`. */
  readonly description?: string;
  /** Comma-split tag list (whitespace-trimmed; empty entries
   *  dropped). Stored in `meta.template.tags`. */
  readonly tags: readonly string[];
}

export interface ShowSaveAsTemplateDialogOptions {
  /** Pre-fills the name field — typically the document's
   *  current title so the user can confirm + tweak rather than
   *  re-type. */
  readonly defaultName?: string;
  readonly defaultDescription?: string;
  readonly defaultTags?: readonly string[];
}

/**
 * Show the save-as-template dialog. Resolves with the user's
 * input on OK, or `null` on Cancel / Esc / outside-click.
 */
export function showSaveAsTemplateDialog(
  opts: ShowSaveAsTemplateDialogOptions = {},
): Promise<SaveAsTemplateInput | null> {
  return new Promise((resolve) => {
    const dlg = document.createElement("annot-dialog");
    dlg.title = "Save as template";
    dlg.message = "Saved under Templates/ as a reusable starter for new documents.";
    dlg.okLabel = "Save template";
    dlg.cancelLabel = "Cancel";

    // Field block — flex-column inside `.app-dialog-body` so
    // labels stack above inputs.
    const fields = document.createElement("div");
    fields.className = "annot-save-as-template-fields";

    const nameLabel = makeLabel("Template name");
    const nameInput = makeInput({
      type: "text",
      value: opts.defaultName ?? "",
      ariaLabel: "Template name",
      placeholder: "e.g. Bug report walkthrough",
    });

    const descLabel = makeLabel("Description (optional)");
    const descInput = makeTextarea({
      value: opts.defaultDescription ?? "",
      ariaLabel: "Template description",
      placeholder: "What is this template for?",
    });

    const tagsLabel = makeLabel("Tags (optional, comma-separated)");
    const tagsInput = makeInput({
      type: "text",
      value: opts.defaultTags?.join(", ") ?? "",
      ariaLabel: "Template tags",
      placeholder: "e.g. manual, onboarding",
    });

    const errEl = document.createElement("div");
    errEl.className = "app-dialog-error";
    errEl.style.display = "none";

    fields.append(nameLabel, nameInput, descLabel, descInput, tagsLabel, tagsInput, errEl);
    dlg.appendChild(fields);
    document.body.appendChild(dlg);

    const showError = (msg: string) => {
      errEl.textContent = msg;
      errEl.style.display = "";
      nameInput.setAttribute("aria-invalid", "true");
      nameInput.focus();
      nameInput.select();
    };
    const clearError = () => {
      errEl.style.display = "none";
      nameInput.removeAttribute("aria-invalid");
    };
    nameInput.addEventListener("input", clearError);

    const close = () => dlg.remove();

    dlg.addEventListener("dialog-cancel", () => {
      close();
      resolve(null);
    });
    dlg.addEventListener("dialog-ok", () => {
      const name = nameInput.value.trim();
      if (!name) {
        showError("Template name is required.");
        return;
      }
      // Filename safety: the save path is
      // `Templates/${name}.annot.html`. Any of `/`, `\`, or `..`
      // would let the user write outside `Templates/`. Reject
      // here rather than silently sanitise so the failure mode
      // is visible.
      if (name.includes("/") || name.includes("\\") || name.includes("..")) {
        showError("Template name can't contain '/', '\\\\', or '..'.");
        return;
      }
      const description = descInput.value.trim();
      const tags = tagsInput.value
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      close();
      const out: SaveAsTemplateInput = description ? { name, description, tags } : { name, tags };
      resolve(out);
    });

    // Enter on the single-line inputs submits; Enter inside the
    // textarea adds a newline (default browser behaviour).
    const submitOnEnter = (e: KeyboardEvent): void => {
      if (e.key === "Enter") {
        e.preventDefault();
        dlg.querySelector<HTMLButtonElement>(".app-dialog-ok")?.click();
      }
    };
    nameInput.addEventListener("keydown", submitOnEnter);
    tagsInput.addEventListener("keydown", submitOnEnter);

    requestAnimationFrame(() => {
      nameInput.focus();
      nameInput.select();
    });
  });
}

// ---- Internal helpers ----------------------------------------------------

function makeLabel(text: string): HTMLLabelElement {
  const lbl = document.createElement("label");
  lbl.textContent = text;
  lbl.style.cssText = "font-size:12px;color:var(--annot-text-secondary,#9ca3af);margin-top:4px;";
  return lbl;
}

interface InputOptions {
  type: string;
  value: string;
  ariaLabel: string;
  placeholder?: string;
}

function makeInput(opts: InputOptions): HTMLInputElement {
  const el = document.createElement("input");
  el.type = opts.type;
  el.className = "app-dialog-input";
  el.value = opts.value;
  el.setAttribute("aria-label", opts.ariaLabel);
  if (opts.placeholder) el.placeholder = opts.placeholder;
  return el;
}

function makeTextarea(opts: Omit<InputOptions, "type">): HTMLTextAreaElement {
  const el = document.createElement("textarea");
  // Reuses the dialog-input's border / focus styling. Override
  // `height` so it grows past one line; `min-height` matches
  // ~3 rows of the dialog font size.
  el.className = "app-dialog-input";
  el.style.cssText = "height:auto;min-height:64px;padding:8px 12px;resize:vertical;";
  el.value = opts.value;
  el.setAttribute("aria-label", opts.ariaLabel);
  if (opts.placeholder) el.placeholder = opts.placeholder;
  el.rows = 3;
  return el;
}
