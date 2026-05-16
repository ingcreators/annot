/**
 * `showSettingsDialog` — application-level Settings dialog.
 *
 * Replaces the direct light/dark theme-toggle button in the
 * gallery / image-editor / doc-editor headers. The dialog hosts
 * one section today (Appearance → Theme) but is laid out as a
 * sequence of `<section>` blocks so future settings rows can be
 * appended without rewriting the shell.
 *
 * Pattern mirrors `doc-settings-dialog.ts` — `<annot-dialog>`
 * wrapper, Promise-based functional API, native `<select>`
 * elements styled with the `app-dialog-input` class so the chrome
 * matches the rest of the host's dialogs.
 */

import {
  applyPersistedTheme,
  getPersistedThemeMode,
  persistThemeChoice,
  type ThemeMode,
} from "@ingcreators/annot-editor";

import "./annot-dialog.js";

export interface ShowSettingsDialogOptions {
  /** Override the persisted-mode read used to populate the
   *  select. Mostly useful for Storybook / tests; production
   *  callers leave this unset. */
  readonly defaultTheme?: ThemeMode;
}

export interface SettingsDialogResult {
  /** The theme mode the user picked. Already persisted +
   *  applied by the time the promise resolves. */
  readonly theme: ThemeMode;
}

const THEME_OPTIONS: readonly { value: ThemeMode; label: string }[] = [
  { value: "system", label: "System (follow OS)" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * Show the Settings dialog. Resolves with the user's input on OK
 * (after persisting + re-applying the theme) or `null` on
 * Cancel / Esc / outside-click.
 */
export function showSettingsDialog(
  opts: ShowSettingsDialogOptions = {},
): Promise<SettingsDialogResult | null> {
  return new Promise((resolve) => {
    const dlg = document.createElement("annot-dialog");
    dlg.title = "Settings";
    dlg.message = "";
    dlg.okLabel = "Apply";
    dlg.cancelLabel = "Cancel";

    const fields = document.createElement("div");
    fields.className = "annot-settings-fields";
    // Match doc-settings-dialog's layout: vertical stack of
    // sections, capped at 60vh so the OK / Cancel buttons stay
    // reachable on short viewports. Future sections appended
    // here scroll inside the same container.
    fields.style.cssText =
      "display:flex;flex-direction:column;gap:16px;max-height:60vh;overflow-y:auto;padding-right:4px;";

    fields.appendChild(buildAppearanceSection(opts));

    dlg.appendChild(fields);
    document.body.appendChild(dlg);

    const close = (): void => dlg.remove();

    dlg.addEventListener("dialog-cancel", () => {
      close();
      resolve(null);
    });
    dlg.addEventListener("dialog-ok", () => {
      const themeSelect = fields.querySelector<HTMLSelectElement>("[data-annot-settings-theme]");
      const theme = (themeSelect?.value as ThemeMode | undefined) ?? "system";
      persistThemeChoice(theme);
      applyPersistedTheme();
      close();
      resolve({ theme });
    });
  });
}

// ---- Sections -------------------------------------------------------------

/** Appearance — currently holds only the Theme row. Each future
 *  section follows the same shape: returns a `<section>` element
 *  with an `<h3>` header + a stack of label/control pairs. */
function buildAppearanceSection(opts: ShowSettingsDialogOptions): HTMLElement {
  const section = makeSection("Appearance");

  const themeLabel = makeLabel("Theme");
  const initialTheme = opts.defaultTheme ?? getPersistedThemeMode();
  const themeSelect = makeSelect({
    value: initialTheme,
    ariaLabel: "Theme",
    options: THEME_OPTIONS.map((t) => ({ value: t.value, label: t.label })),
  });
  themeSelect.setAttribute("data-annot-settings-theme", "");

  section.append(themeLabel, themeSelect);
  return section;
}

// ---- Internal helpers -----------------------------------------------------

function makeSection(title: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "annot-settings-section";
  section.style.cssText = "display:flex;flex-direction:column;gap:8px;";
  const heading = document.createElement("h3");
  heading.textContent = title;
  heading.style.cssText =
    "margin:0;font-size:13px;font-weight:600;color:var(--annot-text-primary,#e5e7eb);";
  section.appendChild(heading);
  return section;
}

function makeLabel(text: string): HTMLLabelElement {
  const lbl = document.createElement("label");
  lbl.textContent = text;
  lbl.style.cssText = "font-size:12px;color:var(--annot-text-secondary,#9ca3af);margin-top:4px;";
  return lbl;
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
