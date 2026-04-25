/**
 * Built-in `drawer.file` section — shows filename (inline-editable),
 * folder, dimensions, file size, timestamps, source URL.
 *
 * Lit Phase 1 — replaces the imperative `render` + `makeNameRow`
 * closures with a `<annot-drawer-file-section>` element.
 * The `createFileSection` factory stays so the drawer host can
 * compose it as a `UISection` alongside plugin-authored sections
 * (whose `mount` is still an opaque callback).
 *
 * Reactive lifecycle: assigning `.data` / `.onRename` triggers a
 * Lit re-render; the factory's `update(ctx)` re-reads via
 * `deps.getData()` and reassigns the property.
 */

import type { UISection } from "../../app/plugin-host.js";
import { html, LitElement, nothing } from "../../lit.js";
import type { FileDetailsData } from "../file-details-drawer-types.js";
import { validateFilename } from "../file-details-drawer-types.js";
import { formatBytes, formatDate } from "./helpers.js";

export class AnnotDrawerFileSectionElement extends LitElement {
  static override properties = {
    data: { attribute: false },
    onRename: { attribute: false },
    errorMessage: { state: true },
    inputDisabled: { state: true },
  };

  declare data: FileDetailsData;
  declare onRename: ((newName: string) => Promise<void>) | null;
  declare errorMessage: string;
  declare inputDisabled: boolean;

  constructor() {
    super();
    // `data` has no sensible default — callers must assign. We
    // only initialise so the first render doesn't crash if the
    // factory hasn't wired us up yet.
    this.data = {
      filename: "",
      folderPath: "",
      width: 0,
      height: 0,
      fileSizeBytes: 0,
      tags: {},
    };
    this.onRename = null;
    this.errorMessage = "";
    this.inputDisabled = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    const data = this.data;
    return html`
      ${this.#renderNameRow(data.filename)}
      ${this.#renderRow("Location", data.folderPath || "(root)", {
        selectable: true,
        mono: true,
      })}
      ${this.#renderRow("Dimensions", `${data.width} \u00d7 ${data.height} px`)}
      ${this.#renderRow("File size", formatBytes(data.fileSizeBytes))}
      ${data.createdAt ? this.#renderRow("Created", formatDate(data.createdAt)) : nothing}
      ${data.updatedAt ? this.#renderRow("Modified", formatDate(data.updatedAt)) : nothing}
      ${data.sourceUrl
        ? this.#renderRow("Source", data.sourceUrl, {
            selectable: true,
            mono: true,
            link: true,
          })
        : nothing}
    `;
  }

  /** Plain label → value row. `link: true` renders the value as a
   *  clickable external link when it looks like an http(s) URL. */
  #renderRow(
    label: string,
    value: string,
    opts: { selectable?: boolean; mono?: boolean; link?: boolean } = {},
  ) {
    const cls = `file-details-row-value${opts.mono ? " mono" : ""}${
      opts.selectable ? " selectable" : ""
    }`;
    const isHttpLink = opts.link && /^https?:\/\//i.test(value);
    return html`
      <div class="file-details-row">
        <span class="file-details-row-label">${label}</span>
        ${isHttpLink
          ? html`<a
              class=${cls}
              href=${value}
              target="_blank"
              rel="noopener noreferrer"
              data-tooltip=${value}
              aria-label=${value}
              >${value}</a
            >`
          : html`<span class=${cls} data-tooltip=${value} aria-label=${value}>${value}</span>`}
      </div>
    `;
  }

  #renderNameRow(filename: string) {
    return html`
      <div class="file-details-row">
        <span class="file-details-row-label">Name</span>
        <div class="file-details-name-wrap">
          <input
            type="text"
            class="file-details-name-input"
            .value=${filename}
            spellcheck="false"
            autocomplete="off"
            aria-label="File name, editable"
            data-tooltip="Click to rename. Enter to save, Esc to cancel."
            ?disabled=${this.inputDisabled}
            @focus=${this.#onNameFocus}
            @keydown=${this.#onNameKeydown}
            @blur=${this.#onNameBlur}
          />
          <div class="file-details-name-error" aria-live="polite">${this.errorMessage}</div>
        </div>
      </div>
    `;
  }

  /** Select only the base name (before the last dot) when the user
   *  focuses — matches Finder / Explorer "rename" behaviour so
   *  users don't accidentally wipe the extension. */
  #onNameFocus = (e: FocusEvent): void => {
    const input = e.currentTarget as HTMLInputElement;
    const dot = input.value.lastIndexOf(".");
    if (dot > 0) {
      // defer so browser's default all-select is overridden
      setTimeout(() => input.setSelectionRange(0, dot), 0);
    }
  };

  #onNameKeydown = (e: KeyboardEvent): void => {
    const input = e.currentTarget as HTMLInputElement;
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur(); // triggers commit via blur listener
    } else if (e.key === "Escape") {
      e.preventDefault();
      input.value = this.data.filename; // cancel
      this.errorMessage = "";
      input.blur();
    }
  };

  #onNameBlur = (e: FocusEvent): void => {
    void this.#commitRename(e.currentTarget as HTMLInputElement);
  };

  async #commitRename(input: HTMLInputElement): Promise<void> {
    const next = input.value.trim();
    const original = this.data.filename;
    if (!next || next === original) {
      input.value = original; // restore
      this.errorMessage = "";
      return;
    }
    const err = validateFilename(next);
    if (err) {
      this.errorMessage = err;
      input.focus();
      return;
    }
    try {
      this.inputDisabled = true;
      this.errorMessage = "";
      await this.onRename?.(next);
      // setData from the host will refresh `.value` with the final
      // (possibly uniquified) name on the next reactive update.
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message || "Rename failed";
      this.errorMessage = msg;
      input.value = original; // restore
    } finally {
      this.inputDisabled = false;
    }
  }
}

if (!customElements.get("annot-drawer-file-section")) {
  customElements.define("annot-drawer-file-section", AnnotDrawerFileSectionElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-drawer-file-section": AnnotDrawerFileSectionElement;
  }
}

export interface FileSectionDeps {
  getData(): FileDetailsData;
  /** Commit a filename change. The host is expected to call
   *  `storage.renameImage`, then call `setData` on the drawer with
   *  the final (possibly uniquified) name so this section's input
   *  reflects the truth. Reject the promise to surface an inline
   *  error message under the filename input. */
  onRename?(newFilename: string): Promise<void>;
}

export function createFileSection(deps: FileSectionDeps): UISection {
  let el: AnnotDrawerFileSectionElement | null = null;
  const sync = () => {
    if (!el) return;
    el.data = deps.getData();
    el.onRename = deps.onRename ? (next) => deps.onRename!(next) : null;
  };

  return {
    id: "drawer.file",
    title: "File",
    priority: 10,
    mount(container) {
      el = document.createElement("annot-drawer-file-section");
      container.appendChild(el);
      sync();
      return {
        update() {
          sync();
        },
        unmount() {
          el?.remove();
          el = null;
        },
      };
    },
  };
}
