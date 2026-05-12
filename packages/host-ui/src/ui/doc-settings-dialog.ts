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

/** Layout enum mirrored from `@ingcreators/annot-doc`'s
 *  `StepLayout`. Mirrored here (rather than imported) to keep
 *  this dialog dependency-free at the type level — the dialog
 *  bundles into the same chunk as the doc shell and pulling the
 *  enum across packages would force a doc-package eager import
 *  for the few hosts that haven't opted into documents yet.
 *  The set of allowed values is held in sync by the
 *  `STEP_LAYOUT_OPTIONS` constant below. */
type StepLayoutValue = "image-top" | "image-bottom" | "image-left" | "image-right" | "image-fill";

type CardColumnsValue = 1 | 2 | 3 | "auto";

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
  /** Phase 3b of card-procedure-template — cards-per-row in the
   *  standalone view. `undefined` means "leave the model
   *  unchanged" (used when the user keeps the default). */
  readonly cardColumns?: CardColumnsValue;
  /** Phase 3b — default layout for newly-inserted step blocks.
   *  Per-block `data-step-layout` always wins on render. */
  readonly cardDefaultStepLayout?: StepLayoutValue;
  /** Phase 7c — Scribe-style document header opt-in. When the
   *  user sets a description and/or icon the doc gains a header
   *  block above the body content + a matching PPTX cover slide.
   *  Both nested fields default to the empty string to mean
   *  "clear this field". */
  readonly headerDescription?: string;
  readonly headerIcon?: string;
  /** Phase 3 of `docs/plans/card-step-auto-numbering.md` —
   *  driver for `meta.numbering.steps`. Always present; the
   *  caller is expected to merge into the existing
   *  `meta.numbering` object so unrelated toggles
   *  (headings / figures) aren't dropped. */
  readonly numberingSteps: boolean;
  /** Phase 3 — driver for `meta.numbering.stepLabel`. Absent
   *  when `numberingSteps === false` OR when the user kept the
   *  default `"%n"` template (so the saved sidecar stays
   *  minimal). The literal `%n` placeholder is required; the
   *  helper `STEP_LABEL_PRESETS` below carries the offered
   *  options. */
  readonly numberingStepLabel?: string;
  /** Phase 3 of `docs/plans/card-document-themes.md` — driver
   *  for `meta.appearance.template`. Absent → "use legacy theme"
   *  (caller clears `meta.appearance.template` and keeps the
   *  `meta.theme` keyword). Present → caller writes
   *  `meta.appearance.template = value` AND clears `meta.theme`
   *  so the two fields don't fight. */
  readonly appearanceTemplate?: string;
  /** Phase 4 of `docs/plans/card-document-themes.md` — driver
   *  for `meta.appearance.fontFamily`. Each field is independent
   *  (the dialog renders three separate text inputs). Empty
   *  strings collapse to `undefined` so the saved sidecar stays
   *  minimal. When ALL three fields are empty, the caller drops
   *  the `fontFamily` object entirely. */
  readonly appearanceFontFamilySans?: string;
  readonly appearanceFontFamilySerif?: string;
  readonly appearanceFontFamilyMono?: string;
  /** Phase 5 of `docs/plans/card-document-themes.md` — driver
   *  for `meta.appearance.customCss`. The string is the user's
   *  raw input; the caller is expected to run it through
   *  `sanitiseCustomCss` from `@ingcreators/annot-doc/headless`
   *  before writing it to `meta.appearance.customCss`. The
   *  dialog itself also runs the sanitiser at save time and
   *  surfaces a warning when stripping is applied (the
   *  `customCssWarnings` field carries those warnings back to
   *  the caller so the host can decide where to surface them —
   *  toast, status bar, etc.). */
  readonly appearanceCustomCss?: string;
  readonly customCssWarnings?: readonly string[];
}

export interface ShowDocSettingsDialogOptions {
  readonly defaultTitle?: string;
  readonly defaultLang?: string;
  readonly defaultAuthor?: string;
  readonly defaultTheme?: "light" | "dark" | "auto";
  readonly defaultMaxWidth?: "narrow" | "medium" | "wide" | "full";
  readonly defaultCardColumns?: CardColumnsValue;
  readonly defaultCardStepLayout?: StepLayoutValue;
  readonly defaultHeaderDescription?: string;
  readonly defaultHeaderIcon?: string;
  /** Phase 3 of `docs/plans/card-step-auto-numbering.md` —
   *  current `meta.numbering.steps`. Absent / `undefined` /
   *  `false` → checkbox starts unchecked. */
  readonly defaultNumberingSteps?: boolean;
  /** Phase 3 — current `meta.numbering.stepLabel`. Absent →
   *  defaults to `"%n"` (numeral only). The dropdown matches
   *  on the verbatim string; custom values surface in the
   *  "Custom" branch with the user's literal in the text input. */
  readonly defaultNumberingStepLabel?: string;
  /** Phase 3 of `docs/plans/card-document-themes.md` — current
   *  `meta.appearance.template`. Absent → "Legacy" radio is
   *  checked, the legacy `Theme:` dropdown drives appearance. */
  readonly defaultAppearanceTemplate?: string;
  /** Phase 4 of `docs/plans/card-document-themes.md` — current
   *  `meta.appearance.fontFamily.{sans,serif,mono}`. Absent /
   *  empty → corresponding text input is empty, and the
   *  resolved field collapses to undefined on save. */
  readonly defaultAppearanceFontFamilySans?: string;
  readonly defaultAppearanceFontFamilySerif?: string;
  readonly defaultAppearanceFontFamilyMono?: string;
  /** Phase 5 of `docs/plans/card-document-themes.md` — current
   *  `meta.appearance.customCss`. Absent / empty → the
   *  "Advanced: Custom CSS" textarea starts empty. */
  readonly defaultAppearanceCustomCss?: string;
}

/** Phase 3 of `docs/plans/card-document-themes.md` — built-in
 *  theme options shown in the Appearance picker. Each entry's
 *  `id` matches the matching `BuiltinThemeId` in
 *  `@ingcreators/annot-doc/themes`; the labels are mirrored here
 *  (rather than imported from the doc package) for the same
 *  dependency-light reason the layout enum is mirrored above.
 *  The sentinel `__legacy` entry maps to "no appearance.template
 *  is set" — the user is asking us to defer to the legacy `Theme`
 *  dropdown below. */
const APPEARANCE_TEMPLATE_LEGACY = "__legacy";
const APPEARANCE_TEMPLATE_OPTIONS: readonly {
  value: string;
  label: string;
  description: string;
}[] = [
  {
    value: APPEARANCE_TEMPLATE_LEGACY,
    label: "Legacy (use Theme below)",
    description:
      "Driven by the legacy “Theme” dropdown — Light / Dark / Auto. Pick this to keep documents authored before themes were added unchanged.",
  },
  {
    value: "modern-light",
    label: "Modern Light",
    description: "Soft shadows, blue accent, white background.",
  },
  {
    value: "modern-dark",
    label: "Modern Dark",
    description: "Always-dark variant of Modern Light.",
  },
  {
    value: "minimal",
    label: "Minimal",
    description: "Hairline borders, no shadows, neutral mono-toned palette.",
  },
  {
    value: "editorial",
    label: "Editorial",
    description: "Serif headings, off-white background, magazine-style pull quotes.",
  },
  {
    value: "playful",
    label: "Playful",
    description: "Pastel palette, generous radii, chat-bubble badge.",
  },
];

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

const CARD_COLUMNS_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "1", label: "1 column (stack)" },
  { value: "2", label: "2 columns" },
  { value: "3", label: "3 columns" },
  { value: "auto", label: "Auto (responsive)" },
];

const STEP_LAYOUT_OPTIONS: readonly { value: StepLayoutValue; label: string }[] = [
  { value: "image-top", label: "Image top" },
  { value: "image-bottom", label: "Image bottom" },
  { value: "image-left", label: "Image left" },
  { value: "image-right", label: "Image right" },
  { value: "image-fill", label: "Image fill" },
];

/** Phase 3 of `docs/plans/card-step-auto-numbering.md` — built-in
 *  step badge label templates. `%n` is the CSS counter
 *  placeholder; everything else is literal CSS `content` text.
 *  The "Custom" branch lets the user type their own template. */
const STEP_LABEL_PRESETS: readonly { value: string; label: string }[] = [
  { value: "%n", label: "Number only (1, 2, 3…)" },
  { value: "Step %n", label: "“Step N” prefix (Step 1, Step 2…)" },
  { value: "%n.", label: "“N.” suffix (1., 2., 3…)" },
  { value: "#%n", label: "Hash prefix (#1, #2, #3…)" },
];

const STEP_LABEL_CUSTOM_SENTINEL = "__custom";

function cardColumnsToString(v: CardColumnsValue | undefined): string {
  if (v === "auto") return "auto";
  if (v === 1 || v === 2 || v === 3) return String(v);
  return "1";
}

function parseCardColumns(raw: string): CardColumnsValue | undefined {
  if (raw === "auto") return "auto";
  if (raw === "1") return 1;
  if (raw === "2") return 2;
  if (raw === "3") return 3;
  return undefined;
}

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
    // The dialog has grown a lot since the Appearance picker +
    // font family overrides + custom CSS expander landed —
    // without an explicit cap on the fields container, the
    // dialog can extend below the viewport on shorter screens
    // and the OK / Cancel buttons end up unreachable. Cap at
    // 60vh + scroll so the buttons (rendered by
    // `<annot-dialog>` outside this `fields` div) always stay
    // visible.
    fields.style.cssText =
      "display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow-y:auto;padding-right:4px;";

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

    // Phase 3 of card-document-themes.md — Appearance picker.
    // Renders the built-in themes as radio cards. Selecting a
    // theme writes `meta.appearance.template`; selecting "Legacy"
    // clears it (the legacy Theme dropdown below wins). The
    // dropdown itself stays for back-compat — selecting a value
    // there auto-flips the Appearance picker back to "Legacy" so
    // the two fields don't fight at save time.
    const appearanceLabel = makeLabel("Appearance");
    const appearanceGroup = document.createElement("div");
    appearanceGroup.className = "annot-doc-settings-appearance";
    appearanceGroup.setAttribute("role", "radiogroup");
    appearanceGroup.setAttribute("aria-label", "Appearance template");
    appearanceGroup.style.cssText =
      "display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--annot-border-subtle,#e5e7eb);border-radius:6px;";
    const initialAppearance = opts.defaultAppearanceTemplate ?? APPEARANCE_TEMPLATE_LEGACY;
    const appearanceRadios = new Map<string, HTMLInputElement>();
    for (const option of APPEARANCE_TEMPLATE_OPTIONS) {
      const card = document.createElement("label");
      card.style.cssText =
        "display:flex;align-items:flex-start;gap:8px;padding:6px;border-radius:4px;cursor:pointer;font-size:13px;";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "annot-doc-appearance";
      radio.value = option.value;
      radio.setAttribute("aria-label", option.label);
      if (option.value === initialAppearance) radio.checked = true;
      appearanceRadios.set(option.value, radio);
      const textBox = document.createElement("div");
      textBox.style.cssText = "display:flex;flex-direction:column;gap:2px;flex:1;";
      const titleEl = document.createElement("span");
      titleEl.textContent = option.label;
      titleEl.style.cssText = "font-weight:600;";
      const descEl = document.createElement("span");
      descEl.textContent = option.description;
      descEl.style.cssText = "color:var(--annot-text-secondary,#6b7280);font-size:12px;";
      textBox.append(titleEl, descEl);
      card.append(radio, textBox);
      appearanceGroup.appendChild(card);
    }

    // Phase 4 of card-document-themes.md — three text inputs for
    // font family overrides. Each accepts a logical token
    // (`Annot Sans` / `Annot Serif` / `Annot Mono`) or a raw CSS
    // family stack. Empty → no override (sidecar stays minimal).
    const fontFamilyHeader = makeLabel("Font family overrides (optional)");
    const fontFamilySansInput = makeInput({
      value: opts.defaultAppearanceFontFamilySans ?? "",
      ariaLabel: "Sans font family override",
      placeholder: "e.g. Inter, sans-serif — or Annot Serif",
    });
    const fontFamilySansLabel = makeSubLabel("Sans (body)");
    const fontFamilySerifInput = makeInput({
      value: opts.defaultAppearanceFontFamilySerif ?? "",
      ariaLabel: "Serif font family override",
      placeholder: "e.g. Charter, serif",
    });
    const fontFamilySerifLabel = makeSubLabel("Serif (Annot Serif token)");
    const fontFamilyMonoInput = makeInput({
      value: opts.defaultAppearanceFontFamilyMono ?? "",
      ariaLabel: "Mono font family override",
      placeholder: "e.g. Fira Code, monospace",
    });
    const fontFamilyMonoLabel = makeSubLabel("Mono (code)");

    // Phase 5 of card-document-themes.md — Advanced: Custom CSS
    // expander. Renders as a `<details>` so the textarea takes
    // zero vertical space until the user opens it. The dialog
    // re-runs the sanitiser at save time and forwards warnings
    // through `result.customCssWarnings` for the host to surface.
    const customCssDetails = document.createElement("details");
    customCssDetails.style.cssText = "margin-top:4px;";
    const customCssSummary = document.createElement("summary");
    customCssSummary.textContent = "Advanced: Custom CSS";
    customCssSummary.style.cssText =
      "font-size:12px;cursor:pointer;color:var(--annot-text-secondary,#9ca3af);";
    const customCssTextarea = makeTextarea({
      value: opts.defaultAppearanceCustomCss ?? "",
      ariaLabel: "Custom CSS appended after the theme",
      placeholder:
        "/* Free-form CSS appended after the theme.\n   @import + external url() refs get stripped on save. */",
      rows: 6,
    });
    customCssTextarea.style.cssText += "font-family:monospace;font-size:12px;white-space:pre;";
    customCssDetails.append(customCssSummary, customCssTextarea);
    if (opts.defaultAppearanceCustomCss && opts.defaultAppearanceCustomCss.length > 0) {
      customCssDetails.open = true;
    }

    const themeLabel = makeLabel("Theme (legacy — Appearance overrides)");
    const themeSelect = makeSelect({
      value: opts.defaultTheme ?? "auto",
      ariaLabel: "Theme",
      options: THEME_OPTIONS.map((t) => ({ value: t.value, label: t.label })),
    });
    // Cross-toggle: picking a real theme card clears the legacy
    // dropdown's effect (we DON'T mutate the dropdown's UI value
    // — just the result emission); picking a Theme dropdown
    // value flips the Appearance picker back to "Legacy" so the
    // user gets immediate feedback about which side wins.
    themeSelect.addEventListener("change", () => {
      const legacyRadio = appearanceRadios.get(APPEARANCE_TEMPLATE_LEGACY);
      if (legacyRadio && !legacyRadio.checked) legacyRadio.checked = true;
    });

    const widthLabel = makeLabel("Article width");
    const widthSelect = makeSelect({
      value: opts.defaultMaxWidth ?? "medium",
      ariaLabel: "Article width",
      options: WIDTH_OPTIONS.map((w) => ({ value: w.value, label: w.label })),
    });

    // Phase 3b of card-procedure-template — card layout section.
    // Two selects controlling how step blocks pack into the
    // standalone view (columns) and which layout newly-inserted
    // step blocks default to.
    const cardColumnsLabel = makeLabel("Card columns");
    const cardColumnsSelect = makeSelect({
      value: cardColumnsToString(opts.defaultCardColumns),
      ariaLabel: "Cards per row",
      options: CARD_COLUMNS_OPTIONS,
    });
    const cardDefaultLayoutLabel = makeLabel("Default step layout");
    const cardDefaultLayoutSelect = makeSelect({
      value: opts.defaultCardStepLayout ?? "image-top",
      ariaLabel: "Default step layout for new step blocks",
      options: STEP_LAYOUT_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
    });

    // Phase 3 of card-step-auto-numbering.md — Scribe-style
    // auto-numbering badge on every step block. The checkbox
    // controls `meta.numbering.steps`; the label-format select
    // drives `meta.numbering.stepLabel`. Both are gated on
    // step-numbering being on — the label format hides
    // (display: none) when the checkbox is off so the dialog
    // doesn't tease a control that has no effect.
    const stepNumberingLabel = makeLabel("Step numbering");
    const stepNumberingRow = document.createElement("div");
    stepNumberingRow.style.cssText = "display:flex;align-items:center;gap:8px;";
    const stepNumberingCheckbox = document.createElement("input");
    stepNumberingCheckbox.type = "checkbox";
    stepNumberingCheckbox.setAttribute("aria-label", "Auto-number step blocks");
    stepNumberingCheckbox.checked = opts.defaultNumberingSteps === true;
    const stepNumberingCheckboxText = document.createElement("span");
    stepNumberingCheckboxText.textContent = "Auto-number step blocks with a Scribe-style badge";
    stepNumberingCheckboxText.style.cssText = "font-size:13px;";
    stepNumberingRow.append(stepNumberingCheckbox, stepNumberingCheckboxText);

    const stepLabelLabel = makeLabel("Step badge label");
    const initialStepLabel = opts.defaultNumberingStepLabel;
    const isPresetStepLabel =
      initialStepLabel === undefined ||
      STEP_LABEL_PRESETS.some((p) => p.value === initialStepLabel);
    const stepLabelSelect = makeSelect({
      value: isPresetStepLabel ? (initialStepLabel ?? "%n") : STEP_LABEL_CUSTOM_SENTINEL,
      ariaLabel: "Step badge label format",
      options: [
        ...STEP_LABEL_PRESETS,
        { value: STEP_LABEL_CUSTOM_SENTINEL, label: "Custom (enter below)…" },
      ],
    });
    const stepLabelCustomInput = makeInput({
      value: !isPresetStepLabel && initialStepLabel !== undefined ? initialStepLabel : "",
      ariaLabel: "Custom step badge label",
      placeholder: "e.g. “%n / 5” — %n is the auto-counter",
    });
    const updateStepLabelVisibility = () => {
      const numberingOn = stepNumberingCheckbox.checked;
      stepLabelLabel.style.display = numberingOn ? "" : "none";
      stepLabelSelect.style.display = numberingOn ? "" : "none";
      stepLabelCustomInput.style.display =
        numberingOn && stepLabelSelect.value === STEP_LABEL_CUSTOM_SENTINEL ? "" : "none";
    };
    stepNumberingCheckbox.addEventListener("change", updateStepLabelVisibility);
    stepLabelSelect.addEventListener("change", updateStepLabelVisibility);
    updateStepLabelVisibility();

    // Phase 7c — header description + icon. Setting either of
    // these opts the document into a Scribe-style header block
    // above the body content + a matching PPTX cover slide.
    const headerDescriptionLabel = makeLabel("Header description (optional)");
    const headerDescriptionInput = makeTextarea({
      value: opts.defaultHeaderDescription ?? "",
      ariaLabel: "Document header description",
      placeholder: "Short summary shown in the doc header + PPTX cover slide",
      rows: 2,
    });
    const headerIconLabel = makeLabel("Header icon (data: URL, optional)");
    const headerIconInput = makeInput({
      value: opts.defaultHeaderIcon ?? "",
      ariaLabel: "Document header icon data URL",
      placeholder: "data:image/png;base64,…",
    });

    fields.append(
      titleLabel,
      titleInput,
      langLabel,
      langSelect,
      langCustomInput,
      authorLabel,
      authorInput,
      appearanceLabel,
      appearanceGroup,
      fontFamilyHeader,
      fontFamilySansLabel,
      fontFamilySansInput,
      fontFamilySerifLabel,
      fontFamilySerifInput,
      fontFamilyMonoLabel,
      fontFamilyMonoInput,
      customCssDetails,
      themeLabel,
      themeSelect,
      widthLabel,
      widthSelect,
      cardColumnsLabel,
      cardColumnsSelect,
      cardDefaultLayoutLabel,
      cardDefaultLayoutSelect,
      stepNumberingLabel,
      stepNumberingRow,
      stepLabelLabel,
      stepLabelSelect,
      stepLabelCustomInput,
      headerDescriptionLabel,
      headerDescriptionInput,
      headerIconLabel,
      headerIconInput,
    );
    dlg.appendChild(fields);
    document.body.appendChild(dlg);

    const close = () => dlg.remove();

    dlg.addEventListener("dialog-cancel", () => {
      close();
      resolve(null);
    });
    dlg.addEventListener("dialog-ok", async () => {
      const title = titleInput.value.trim() || "Untitled";
      const langPick = langSelect.value;
      const lang =
        langPick === "__custom"
          ? langCustomInput.value.trim() || undefined
          : langPick.trim() || undefined;
      const author = authorInput.value.trim() || undefined;
      const theme = themeSelect.value as "light" | "dark" | "auto";
      const maxWidth = widthSelect.value as "narrow" | "medium" | "wide" | "full";
      const cardColumns = parseCardColumns(cardColumnsSelect.value);
      const cardDefaultStepLayout = cardDefaultLayoutSelect.value as StepLayoutValue;
      // Phase 7c — empty trims to the empty string so the
      // caller can detect "user cleared the field" vs "user
      // didn't touch it" (the latter shows up as the same
      // value as defaultHeaderDescription / defaultHeaderIcon).
      const headerDescription = headerDescriptionInput.value.trim();
      const headerIcon = headerIconInput.value.trim();
      // Phase 3 — collapse the dropdown + custom-text input
      // pair into a single string. The dropdown's sentinel
      // value defers to the text input; everything else is the
      // verbatim preset. Empty custom text is treated as
      // "user cleared the field — fall back to the default".
      const numberingSteps = stepNumberingCheckbox.checked;
      let numberingStepLabel: string | undefined;
      if (numberingSteps) {
        const selectVal = stepLabelSelect.value;
        if (selectVal === STEP_LABEL_CUSTOM_SENTINEL) {
          const custom = stepLabelCustomInput.value.trim();
          numberingStepLabel = custom.length > 0 ? custom : undefined;
        } else if (selectVal !== "%n") {
          // `"%n"` matches the data-layer default, so we
          // collapse to undefined for sidecar minimality.
          numberingStepLabel = selectVal;
        } else {
          numberingStepLabel = undefined;
        }
      } else {
        numberingStepLabel = undefined;
      }
      // Phase 3 of card-document-themes.md — read the selected
      // appearance template. The "__legacy" sentinel collapses
      // to undefined so the caller clears
      // `meta.appearance.template` (the legacy `meta.theme`
      // dropdown above drives the look).
      let appearanceTemplate: string | undefined;
      for (const [value, radio] of appearanceRadios) {
        if (radio.checked) {
          appearanceTemplate = value === APPEARANCE_TEMPLATE_LEGACY ? undefined : value;
          break;
        }
      }
      // Phase 4 of card-document-themes.md — read the font
      // family text inputs. Empty values collapse to undefined.
      const appearanceFontFamilySans = fontFamilySansInput.value.trim() || undefined;
      const appearanceFontFamilySerif = fontFamilySerifInput.value.trim() || undefined;
      const appearanceFontFamilyMono = fontFamilyMonoInput.value.trim() || undefined;
      // Phase 5 of card-document-themes.md — sanitise the custom
      // CSS at save time and forward any warnings to the host.
      // Dynamic import keeps the host-ui chunk free of a
      // load-time dep on @ingcreators/annot-doc (the dialog is
      // bundled with the editor surface; the doc package may
      // not be in the chunk graph for hosts that don't use
      // documents).
      const customCssRaw = customCssTextarea.value;
      let appearanceCustomCss: string | undefined;
      let customCssWarnings: readonly string[] | undefined;
      if (customCssRaw.length > 0) {
        const { sanitiseCustomCss } = await import("@ingcreators/annot-doc");
        const sanitisedResult = sanitiseCustomCss(customCssRaw);
        if (sanitisedResult.css.length > 0) {
          appearanceCustomCss = sanitisedResult.css;
        }
        if (sanitisedResult.warnings.length > 0) {
          customCssWarnings = sanitisedResult.warnings;
        }
      }
      close();
      const out: DocSettingsInput = {
        title,
        ...(lang !== undefined ? { lang } : {}),
        ...(author !== undefined ? { author } : {}),
        theme,
        maxWidth,
        ...(cardColumns !== undefined ? { cardColumns } : {}),
        cardDefaultStepLayout,
        headerDescription,
        headerIcon,
        numberingSteps,
        ...(numberingStepLabel !== undefined ? { numberingStepLabel } : {}),
        ...(appearanceTemplate !== undefined ? { appearanceTemplate } : {}),
        ...(appearanceFontFamilySans !== undefined ? { appearanceFontFamilySans } : {}),
        ...(appearanceFontFamilySerif !== undefined ? { appearanceFontFamilySerif } : {}),
        ...(appearanceFontFamilyMono !== undefined ? { appearanceFontFamilyMono } : {}),
        ...(appearanceCustomCss !== undefined ? { appearanceCustomCss } : {}),
        ...(customCssWarnings !== undefined ? { customCssWarnings } : {}),
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

/** Sub-label for the font-family override inputs — slightly
 *  smaller + slightly less indented than the section header. */
function makeSubLabel(text: string): HTMLLabelElement {
  const lbl = document.createElement("label");
  lbl.textContent = text;
  lbl.style.cssText = "font-size:11px;color:var(--annot-text-secondary,#9ca3af);margin-top:2px;";
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

interface TextareaOptions {
  value: string;
  ariaLabel: string;
  placeholder?: string;
  rows?: number;
}

function makeTextarea(opts: TextareaOptions): HTMLTextAreaElement {
  const el = document.createElement("textarea");
  el.className = "app-dialog-input";
  el.value = opts.value;
  el.setAttribute("aria-label", opts.ariaLabel);
  if (opts.placeholder) el.placeholder = opts.placeholder;
  el.rows = opts.rows ?? 2;
  el.style.cssText = "resize:vertical;min-height:48px;font:inherit;";
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
