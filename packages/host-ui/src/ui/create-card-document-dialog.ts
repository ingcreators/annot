/**
 * `showCreateCardDocumentDialog` — modal that collects the
 * inputs the card-document generator needs.
 *
 * Phase 4 of `docs/plans/_done/card-procedure-template.md`. Surfaces:
 *
 *   - **Title** (required) — doc title + `meta.title`. Defaults
 *     to "Untitled procedure" + selected to encourage rename.
 *   - **Step layout** — per-step `data-step-layout`. Stamped
 *     onto every generated step block AND used as the doc's
 *     `meta.cardLayout.defaultStepLayout` (so later-inserted
 *     step blocks via the slash menu inherit the choice).
 *   - **Cards per row** — doc-level `meta.cardLayout.columns`.
 *     `1` = single-column stack (Scribe shape); `2` / `3` =
 *     multi-column grid; `auto` = responsive `repeat(auto-
 *     fill, …)`.
 *   - **Step titles** — title pre-fill strategy. `Step 1 / 2 /
 *     …` (default), `Image 1 / 2 / …`, or empty (user types
 *     each title manually).
 *
 * Pattern mirrors `showDocSettingsDialog` so the dialog shape
 * feels consistent across doc-mode chrome.
 */

import "./annot-dialog.js";

type StepLayoutValue = "image-top" | "image-bottom" | "image-left" | "image-right" | "image-fill";

type CardColumnsValue = 1 | 2 | 3 | "auto";

type Numbering = "step-n" | "image-n" | "none";

export interface CreateCardDocumentInput {
  /** Trimmed title, never empty. Falls back to "Untitled
   *  procedure" when the user clears the field. */
  readonly title: string;
  /** Per-step layout (also stamped as the doc-level default). */
  readonly layout: StepLayoutValue;
  /** Doc-level cards-per-row. `1` (or undefined) leaves the
   *  document's `cardLayout.columns` field unset. */
  readonly columns?: CardColumnsValue;
  /** Title pre-fill strategy. */
  readonly numbering: Numbering;
}

export interface ShowCreateCardDocumentDialogOptions {
  /** Image count from the selection. Shown in the dialog
   *  header as "N image" / "N images" so the user can confirm
   *  the right batch is selected before generating. */
  readonly imageCount: number;
  /** Default title — defaults to "Untitled procedure". */
  readonly defaultTitle?: string;
  /** Default per-step layout. Defaults to `"image-top"`. */
  readonly defaultLayout?: StepLayoutValue;
  /** Default cards-per-row. Defaults to `1`. */
  readonly defaultColumns?: CardColumnsValue;
  /** Default title-prefill strategy. Defaults to `"step-n"`. */
  readonly defaultNumbering?: Numbering;
}

const STEP_LAYOUT_OPTIONS: readonly { value: StepLayoutValue; label: string }[] = [
  { value: "image-top", label: "Image top" },
  { value: "image-bottom", label: "Image bottom" },
  { value: "image-left", label: "Image left" },
  { value: "image-right", label: "Image right" },
  { value: "image-fill", label: "Image fill" },
];

const COLUMNS_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "1", label: "1 column (stack)" },
  { value: "2", label: "2 columns" },
  { value: "3", label: "3 columns" },
  { value: "auto", label: "Auto (responsive)" },
];

const NUMBERING_OPTIONS: readonly { value: Numbering; label: string }[] = [
  { value: "step-n", label: "Step 1, Step 2, …" },
  { value: "image-n", label: "Image 1, Image 2, …" },
  { value: "none", label: "Leave titles empty" },
];

function columnsToString(v: CardColumnsValue | undefined): string {
  if (v === "auto") return "auto";
  if (v === 2 || v === 3) return String(v);
  return "1";
}

function parseColumns(raw: string): CardColumnsValue | undefined {
  if (raw === "auto") return "auto";
  if (raw === "2") return 2;
  if (raw === "3") return 3;
  if (raw === "1") return 1;
  return undefined;
}

/**
 * Show the create-card-document dialog. Resolves with the
 * collected input on OK, or `null` on Cancel / Esc / outside
 * click.
 */
export function showCreateCardDocumentDialog(
  opts: ShowCreateCardDocumentDialogOptions,
): Promise<CreateCardDocumentInput | null> {
  return new Promise((resolve) => {
    const dlg = document.createElement("annot-dialog");
    dlg.title = "Create card document";
    const noun = opts.imageCount === 1 ? "image" : "images";
    dlg.message = `Generate one step card per selected image in click order — ${opts.imageCount} ${noun} ready to go. You can edit titles + bodies after the doc opens.`;
    dlg.okLabel = "Create";
    dlg.cancelLabel = "Cancel";

    const fields = document.createElement("div");
    fields.className = "annot-create-card-document-fields";
    fields.style.cssText = "display:flex;flex-direction:column;gap:8px;";

    const titleLabel = makeLabel("Title");
    const titleInput = makeInput({
      value: opts.defaultTitle ?? "Untitled procedure",
      ariaLabel: "Document title",
      placeholder: "Untitled procedure",
    });

    const layoutLabel = makeLabel("Step layout");
    const layoutSelect = makeSelect({
      value: opts.defaultLayout ?? "image-top",
      ariaLabel: "Per-step layout",
      options: STEP_LAYOUT_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    });

    const columnsLabel = makeLabel("Cards per row");
    const columnsSelect = makeSelect({
      value: columnsToString(opts.defaultColumns),
      ariaLabel: "Cards per row",
      options: COLUMNS_OPTIONS,
    });

    const numberingLabel = makeLabel("Step titles");
    const numberingSelect = makeSelect({
      value: opts.defaultNumbering ?? "step-n",
      ariaLabel: "Step title prefill",
      options: NUMBERING_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    });

    fields.append(
      titleLabel,
      titleInput,
      layoutLabel,
      layoutSelect,
      columnsLabel,
      columnsSelect,
      numberingLabel,
      numberingSelect,
    );
    dlg.appendChild(fields);
    document.body.appendChild(dlg);

    const close = () => dlg.remove();

    dlg.addEventListener("dialog-cancel", () => {
      close();
      resolve(null);
    });
    dlg.addEventListener("dialog-ok", () => {
      const title = titleInput.value.trim() || "Untitled procedure";
      const layout = layoutSelect.value as StepLayoutValue;
      const columns = parseColumns(columnsSelect.value);
      const numbering = numberingSelect.value as Numbering;
      close();
      const out: CreateCardDocumentInput = {
        title,
        layout,
        ...(columns !== undefined ? { columns } : {}),
        numbering,
      };
      resolve(out);
    });

    requestAnimationFrame(() => {
      titleInput.focus();
      titleInput.select();
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
  value: string;
  ariaLabel: string;
  placeholder?: string;
}

function makeInput(opts: InputOptions): HTMLInputElement {
  // Reuse the `.app-dialog-input` class that `<annot-dialog>` /
  // `showDocSettingsDialog` already style centrally — the
  // inline cssText we'd otherwise emit hard-codes dark-theme
  // colors which renders as dark-on-dark on the light
  // doc-mode modal background.
  const input = document.createElement("input");
  input.type = "text";
  input.className = "app-dialog-input";
  input.value = opts.value;
  input.setAttribute("aria-label", opts.ariaLabel);
  if (opts.placeholder) input.placeholder = opts.placeholder;
  return input;
}

interface SelectOptions {
  value: string;
  ariaLabel: string;
  options: readonly { value: string; label: string }[];
}

function makeSelect(opts: SelectOptions): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "app-dialog-input";
  select.setAttribute("aria-label", opts.ariaLabel);
  for (const o of opts.options) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    select.appendChild(opt);
  }
  select.value = opts.value;
  return select;
}
