/**
 * `showDocSettingsDialog` — modal that collects the doc-level
 * metadata fields the user can tweak from the Phase 1 header
 * strip's overflow menu.
 *
 * Phase 11 of `docs/plans/annot-html-document-ux-polish.md`.
 *
 * Surface (each field maps 1:1 to an `AnnotDocument` member):
 *
 *   - **Title** (required) — `doc.title` + `doc.meta.title`.
 *     The format spec keeps the two in sync; the dialog
 *     mirrors that contract.
 *   - **Language** — `doc.lang`. Free-input text plus a
 *     dropdown of common picks (en / ja / de / fr / es / zh /
 *     ko / etc). The free input wins if both are populated.
 *   - **Author** (optional) — `doc.meta.author`.
 *   - **Theme** — `doc.meta.theme` (`"light" | "dark" | "auto"`).
 *     Drives the `<style>` block injected at serialise time
 *     so the saved `.annot.html` honours the choice when
 *     re-opened in any browser.
 *   - **Max width** — `doc.meta.maxWidth` (`"narrow" |
 *     "medium" | "wide" | "full"`). Same `<style>` injection
 *     as theme.
 *
 * Pattern mirrors `showSaveAsTemplateDialog` so the dialog
 * shape feels consistent across doc-mode chrome.
 */

import "./annot-dialog.js";

export interface DocSettingsInput {
  /** Trimmed title, never empty. Falls back to "Untitled" when
   *  the user clears the field. Used for both `doc.title` and
   *  `doc.meta.title`. */
  readonly title: string;
  /** BCP-47-ish language code (we don't strictly validate; any
   *  non-empty string is accepted). Empty trims to `undefined`
   *  meaning "leave the model unchanged". */
  readonly lang?: string;
  /** Author display name. `undefined` clears the field. */
  readonly author?: string;
  /** Theme — `undefined` means "auto" (the default). */
  readonly theme?: "light" | "dark" | "auto";
  /** Article width — `undefined` means "medium" (the default). */
  readonly maxWidth?: "narrow" | "medium" | "wide" | "full";
}

export interface ShowDocSettingsDialogOptions {
  readonly defaultTitle?: string;
  readonly defaultLang?: string;
  readonly defaultAuthor?: string;
  readonly defaultTheme?: "light" | "dark" | "auto";
  readonly defaultMaxWidth?: "narrow" | "medium" | "wide" | "full";
}

const COMMON_LANGS: readonly { value: string; label: string }[] = [
  { value: "en", label: "English (en)" },
  { value: "ja", label: "日本語 (ja)" },
  { value: "de", label: "Deutsch (de)" },
  { value: "fr", label: "Français (fr)" },
  { value: "es", label: "Español (es)" },
  { value: "zh", label: "中文 (zh)" },
  { value: "ko", label: "한국어 (ko)" },
];

const THEME_OPTIONS: readonly { value: "light" | "dark" | "auto"; label: string }[] = [
  { value: "auto", label: "Auto (follow system)" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const WIDTH_OPTIONS: readonly {
  value: "narrow" | "medium" | "wide" | "full";
  label: string;
}[] = [
  { value: "narrow", label: "Narrow (~640 px)" },
  { value: "medium", label: "Medium (~768 px)" },
  { value: "wide", label: "Wide (~960 px)" },
  { value: "full", label: "Full width" },
];

/**
 * Show the doc-settings dialog. Resolves with the user's input
 * on OK, or `null` on Cancel / Esc / outside-click.
 */
export function showDocSettingsDialog(
  opts: ShowDocSettingsDialogOptions = {},
): Promise<DocSettingsInput | null> {
  return new Promise((resolve) => {
    const dlg = document.createElement("annot-dialog");
    dlg.title = "Document settings";
    dlg.message =
      "Title and language are saved into the file. Theme + width affect the standalone browser-view rendering.";
    dlg.okLabel = "Apply";
    dlg.cancelLabel = "Cancel";

    const fields = document.createElement("div");
    fields.className = "annot-doc-settings-fields";
    fields.style.cssText = "display:flex;flex-direction:column;gap:8px;";

    const titleLabel = makeLabel("Title");
    const titleInput = makeInput({
      value: opts.defaultTitle ?? "",
      ariaLabel: "Document title",
      placeholder: "Untitled",
    });

    const langLabel = makeLabel("Language");
    const langSelect = makeSelect({
      value: opts.defaultLang ?? "en",
      ariaLabel: "Document language",
      options: [
        ...COMMON_LANGS.map((l) => ({ value: l.value, label: l.label })),
        { value: "__custom", label: "Other (enter below)…" },
      ],
    });
    const langCustomInput = makeInput({
      value:
        opts.defaultLang && !COMMON_LANGS.some((l) => l.value === opts.defaultLang)
          ? opts.defaultLang
          : "",
      ariaLabel: "Custom language code",
      placeholder: "BCP-47 code, e.g. pt-BR",
    });
    if (opts.defaultLang && !COMMON_LANGS.some((l) => l.value === opts.defaultLang)) {
      langSelect.value = "__custom";
    }
    const updateLangCustomVisibility = () => {
      langCustomInput.style.display = langSelect.value === "__custom" ? "" : "none";
    };
    langSelect.addEventListener("change", updateLangCustomVisibility);
    updateLangCustomVisibility();

    const authorLabel = makeLabel("Author (optional)");
    const authorInput = makeInput({
      value: opts.defaultAuthor ?? "",
      ariaLabel: "Author",
      placeholder: "Name or handle",
    });

    const themeLabel = makeLabel("Theme");
    const themeSelect = makeSelect({
      value: opts.defaultTheme ?? "auto",
      ariaLabel: "Theme",
      options: THEME_OPTIONS.map((t) => ({ value: t.value, label: t.label })),
    });

    const widthLabel = makeLabel("Article width");
    const widthSelect = makeSelect({
      value: opts.defaultMaxWidth ?? "medium",
      ariaLabel: "Article width",
      options: WIDTH_OPTIONS.map((w) => ({ value: w.value, label: w.label })),
    });

    fields.append(
      titleLabel,
      titleInput,
      langLabel,
      langSelect,
      langCustomInput,
      authorLabel,
      authorInput,
      themeLabel,
      themeSelect,
      widthLabel,
      widthSelect,
    );
    dlg.appendChild(fields);
    document.body.appendChild(dlg);

    const close = () => dlg.remove();

    dlg.addEventListener("dialog-cancel", () => {
      close();
      resolve(null);
    });
    dlg.addEventListener("dialog-ok", () => {
      const title = titleInput.value.trim() || "Untitled";
      const langPick = langSelect.value;
      const lang =
        langPick === "__custom"
          ? langCustomInput.value.trim() || undefined
          : langPick.trim() || undefined;
      const author = authorInput.value.trim() || undefined;
      const theme = themeSelect.value as "light" | "dark" | "auto";
      const maxWidth = widthSelect.value as "narrow" | "medium" | "wide" | "full";
      close();
      const out: DocSettingsInput = {
        title,
        ...(lang !== undefined ? { lang } : {}),
        ...(author !== undefined ? { author } : {}),
        theme,
        maxWidth,
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
  const el = document.createElement("input");
  el.type = "text";
  el.className = "app-dialog-input";
  el.value = opts.value;
  el.setAttribute("aria-label", opts.ariaLabel);
  if (opts.placeholder) el.placeholder = opts.placeholder;
  return el;
}

interface SelectOptions {
  value: string;
  ariaLabel: string;
  options: readonly { value: string; label: string }[];
}

function makeSelect(opts: SelectOptions): HTMLSelectElement {
  const el = document.createElement("select");
  el.className = "app-dialog-input";
  el.setAttribute("aria-label", opts.ariaLabel);
  for (const o of opts.options) {
    const option = document.createElement("option");
    option.value = o.value;
    option.textContent = o.label;
    el.appendChild(option);
  }
  el.value = opts.value;
  return el;
}
