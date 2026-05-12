/**
 * `showLinkDialog` — modal that collects URL + display text
 * for an inline hyperlink. Google-Docs-style affordance:
 * user selects text → clicks the Link button in the format
 * toolbar → this dialog opens with the selected text as the
 * display label default and an empty URL slot.
 *
 * When the user invokes the dialog while the cursor sits
 * inside an existing `<a>`, the dialog opens in edit mode —
 * both fields are pre-filled with the link's current
 * attributes; an extra "Remove" button lets the user strip
 * the link without touching the surrounding text.
 *
 * Replaces the per-step `<input type="url">` chip the editor
 * used to render for `StepBlock.link` (retired in a follow-up
 * PR per the user's decision to drop the Scribe-style chip
 * in favour of inline links).
 *
 * URL sanitisation:
 *
 * - Allowed schemes: `http:` / `https:` / `mailto:`. Anything
 *   else is rejected (the OK button stays disabled).
 * - Inputs without a scheme are assumed to be `https://`
 *   and the dialog prepends the scheme before resolving.
 *   This matches Google Docs / Notion behaviour where a
 *   bare `example.com` resolves to `https://example.com`.
 *
 * Pattern mirrors `showDocSettingsDialog` /
 * `showCreateCardDocumentDialog` so the dialog shape feels
 * consistent across doc-mode chrome.
 */

import "./annot-dialog.js";

export interface LinkDialogInput {
  /** Fully-qualified URL with scheme. Sanitised before
   *  return; the caller can pass directly to `createLink`. */
  readonly url: string;
  /** Display label. The caller may use this to replace the
   *  selection text if it differs from the user's selection. */
  readonly label: string;
}

export type LinkDialogResult =
  | { readonly action: "save"; readonly input: LinkDialogInput }
  | { readonly action: "remove" }
  | { readonly action: "cancel" };

export interface ShowLinkDialogOptions {
  /** Pre-filled URL when editing an existing link. */
  readonly defaultUrl?: string;
  /** Pre-filled label. When the user invoked the dialog with
   *  a non-empty text selection, this carries the selected
   *  text; when editing an existing link this carries the
   *  link's current text content. */
  readonly defaultLabel?: string;
  /** When `true`, the dialog renders a "Remove" button in
   *  addition to OK / Cancel. The shell sets this when the
   *  user invoked the dialog while the cursor was inside an
   *  existing `<a>`. */
  readonly allowRemove?: boolean;
}

const ALLOWED_SCHEMES = ["http:", "https:", "mailto:"] as const;

/** Sanitise a user-supplied URL. Returns `null` for invalid
 *  inputs (caller should keep the OK button disabled). Schemes
 *  outside the allowlist return `null`; absent schemes are
 *  treated as `https://`. */
export function sanitiseLinkUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Prepend `https://` to bare hosts. We don't want to be
  // clever about detecting hosts — the heuristic is "no scheme
  // present, no whitespace inside, has a dot or starts with
  // localhost". This matches Google Docs' behaviour: typing
  // `example.com` resolves to `https://example.com`.
  let candidate = trimmed;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    // Mailto's a bit special — `user@host` has no scheme but
    // is clearly a mail link; lift it to `mailto:` form.
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
      candidate = `mailto:${candidate}`;
    } else {
      candidate = `https://${candidate}`;
    }
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (!ALLOWED_SCHEMES.includes(url.protocol as (typeof ALLOWED_SCHEMES)[number])) {
    return null;
  }
  return url.toString();
}

export function showLinkDialog(opts: ShowLinkDialogOptions = {}): Promise<LinkDialogResult> {
  return new Promise((resolve) => {
    const dlg = document.createElement("annot-dialog");
    dlg.title = opts.allowRemove ? "Edit link" : "Insert link";
    dlg.message =
      "Selected text becomes the link's display label. Bare hosts get an `https://` scheme prepended automatically.";
    dlg.okLabel = "Apply";
    dlg.cancelLabel = "Cancel";

    const fields = document.createElement("div");
    fields.className = "annot-link-dialog-fields";
    fields.style.cssText = "display:flex;flex-direction:column;gap:8px;";

    const labelLabel = makeLabel("Display text");
    const labelInput = makeInput({
      value: opts.defaultLabel ?? "",
      ariaLabel: "Link display text",
      placeholder: "Optional — defaults to the URL when empty",
    });
    const urlLabel = makeLabel("URL");
    const urlInput = makeInput({
      value: opts.defaultUrl ?? "",
      ariaLabel: "Link URL",
      placeholder: "https://example.com",
    });

    // Live validation: disable OK until the URL sanitises.
    const validate = (): void => {
      const ok = sanitiseLinkUrl(urlInput.value) !== null;
      (dlg as { okDisabled?: boolean }).okDisabled = !ok;
    };
    urlInput.addEventListener("input", validate);

    fields.append(labelLabel, labelInput, urlLabel, urlInput);

    // Optional Remove button — only shown when editing an
    // existing link. Built as a third inline button injected
    // into the dialog's slot.
    let removeBtn: HTMLButtonElement | null = null;
    if (opts.allowRemove) {
      removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "Remove link";
      removeBtn.className = "annot-link-dialog-remove";
      removeBtn.style.cssText =
        "margin-top:8px;align-self:flex-start;padding:4px 10px;border:1px solid var(--annot-doc-callout-warn-border,#d97706);background:transparent;color:var(--annot-doc-callout-warn-border,#d97706);border-radius:4px;cursor:pointer;font-size:13px;";
      removeBtn.addEventListener("click", () => {
        close();
        resolve({ action: "remove" });
      });
      fields.append(removeBtn);
    }

    dlg.appendChild(fields);
    document.body.appendChild(dlg);
    validate();

    const close = (): void => dlg.remove();

    dlg.addEventListener("dialog-cancel", () => {
      close();
      resolve({ action: "cancel" });
    });
    dlg.addEventListener("dialog-ok", () => {
      const url = sanitiseLinkUrl(urlInput.value);
      if (url === null) {
        // Defensive — the OK button is disabled, but if the
        // user dispatched the event via keyboard before the
        // validate handler ran, bounce.
        return;
      }
      const labelRaw = labelInput.value.trim();
      const label = labelRaw.length > 0 ? labelRaw : url;
      close();
      resolve({ action: "save", input: { url, label } });
    });

    requestAnimationFrame(() => {
      // If the dialog was opened with a default label (selected
      // text or existing link text), focus the URL field. If
      // not, focus the label field first.
      const target = (opts.defaultLabel ?? "").length > 0 ? urlInput : labelInput;
      target.focus();
      target.select();
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
