/**
 * `<annot-extension-popup>` — the toolbar popup for the Annot Chrome
 * extension. Phase 1 of `docs/plans/browser-extension-web-optimized-pudding.md`.
 *
 * Structure (light DOM, hybrid CSS: layout styles live in
 * `packages/extension/src/styles/popup.css`, this element only owns
 * the rendering logic + message dispatch):
 *
 *   ▸ Quick Options              ← `<details>`-collapsed by default
 *     Format / Save size / Emulation / Hide overlays / Whole Page output
 *
 *   CAPTURE ONCE                 ← section header
 *     Visible Area / Select Region / Whole Page
 *
 *   CONTINUOUS CAPTURE           ← section header (Phase 2: Auto button lands here)
 *     Hotkey  (configurable shortcut, default Alt+Shift+Z)
 *
 *   Gallery / Settings
 *
 * Quick Options binds directly to the shared `Settings` blob in
 * `chrome.storage.sync` via `loadSettings` / `saveSettings`. The
 * `Whole Page` button dispatches `whole-page-stitched` or
 * `whole-page-per-screen` based on `settings.wholePageOutput`.
 *
 * Lit-Phase-0 conventions: light DOM, no decorators, runtime
 * `static properties` + `declare`, custom-element prefix `annot-`.
 * Imports Lit via `@ingcreators/annot-host-ui/lit` so the host-ui
 * + extension surfaces share the single `LitElement` identity.
 */

import type {
  EmulationPreset,
  ImageFormat,
  OverlayMode,
  Settings,
  WholePageOutput,
} from "@ingcreators/annot-capture/shared";
import type { SaveSizePreset } from "@ingcreators/annot-core/encode/options";
import { SAVE_SIZE_LABEL } from "@ingcreators/annot-core/encode/options";
import { html, LitElement, nothing } from "@ingcreators/annot-host-ui/lit";
import type { PopupMessage } from "../shared/messages.js";

export type PopupView = "idle" | "hotkeyActive" | "autoActive";

/** Read-only summary of the live Auto Capture session, shown in
 *  the active-state view so users can tell what's driving the
 *  background captures. */
export interface AutoCaptureSummary {
  /** Live frame count from the service worker. */
  count: number;
  /** Resolved stable-wait duration in ms. */
  stableWaitMs: number;
  /** Resolved min-interval between captures in ms. */
  minIntervalMs: number;
}

const FORMAT_OPTIONS: readonly { value: ImageFormat; label: string }[] = [
  { value: "smart", label: "Smart" },
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
];

const SAVE_SIZE_OPTIONS: readonly SaveSizePreset[] = [
  "light",
  "standard",
  "highQuality",
  "original",
];

const EMULATION_OPTIONS: readonly { value: EmulationPreset; label: string }[] = [
  { value: "native", label: "Off (native)" },
  { value: "fullhd", label: "FullHD 1920x1080" },
  { value: "macbook", label: "MacBook 1440x900" },
  { value: "iphonese", label: "iPhone SE 375x667" },
  { value: "iphone15promax", label: "iPhone 15 Pro Max 430x932" },
  { value: "ipad", label: "iPad 1024x1366" },
  { value: "custom", label: "Custom" },
];

const OVERLAY_OPTIONS: readonly { value: OverlayMode; label: string }[] = [
  { value: "scrollOnly", label: "Scroll captures only" },
  { value: "all", label: "Always hide" },
  { value: "never", label: "Never hide" },
];

const WHOLE_PAGE_OUTPUT_OPTIONS: readonly { value: WholePageOutput; label: string }[] = [
  { value: "stitched", label: "Stitched (one tall image)" },
  { value: "perScreen", label: "Per-screen (N images)" },
];

export class AnnotExtensionPopupElement extends LitElement {
  static override properties = {
    view: { state: true },
    hotkeyCount: { state: true },
    autoSummary: { attribute: false },
    settings: { attribute: false },
    quickOptionsOpen: { state: true },
    hotkeyShortcut: { attribute: false },
    hotkeyUnboundNotice: { state: true },
  };

  declare view: PopupView;
  declare hotkeyCount: number;
  declare autoSummary: AutoCaptureSummary | null;
  declare settings: Settings | null;
  declare quickOptionsOpen: boolean;
  /** Resolved keyboard shortcut bound to the `hotkey` command, as
   *  reported by `chrome.commands.getAll()` at popup boot. Empty
   *  string when the user has unbound it in the browser's extension
   *  shortcuts page; the renderer falls back to a "Configure a
   *  shortcut in Settings" hint in that case. */
  declare hotkeyShortcut: string;
  /** Transient inline notice that appears under the Hotkey button
   *  when the user clicks it while no shortcut is bound. The popup
   *  is short-lived (closes on each capture), so we open it inline
   *  rather than closing the popup → opening Settings → asking the
   *  user to re-click the toolbar icon. Cleared on each fresh popup
   *  open since the property starts at `false`. */
  declare hotkeyUnboundNotice: boolean;

  constructor() {
    super();
    this.view = "idle";
    this.hotkeyCount = 0;
    this.autoSummary = null;
    this.settings = null;
    this.quickOptionsOpen = false;
    this.hotkeyShortcut = "";
    this.hotkeyUnboundNotice = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    if (this.view === "hotkeyActive") return this.#renderHotkeyActive();
    if (this.view === "autoActive") return this.#renderAutoActive();
    return this.#renderIdle();
  }

  #renderIdle() {
    return html`
      <div class="popup-brand">
        <svg
          width="32"
          height="32"
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <circle cx="24" cy="7" r="3.5" fill="#7c9cff" />
          <path d="M24 13 L13 38" stroke="#7ef0c5" stroke-width="4" stroke-linecap="round" />
          <path d="M24 13 L35 38" stroke="#b391ff" stroke-width="4" stroke-linecap="round" />
          <path d="M19 24 H29" stroke="#7c9cff" stroke-width="3.5" stroke-linecap="round" />
        </svg>
        <span class="popup-brand-stack">
          <span class="popup-brand-name">Annot</span>
          <span class="popup-brand-org">by ingcreators</span>
        </span>
      </div>

      ${this.#renderQuickOptions()}

      <div class="popup-section-title">Capture once</div>
      <button
        type="button"
        class="popup-btn"
        @click=${() => this.#dispatch({ type: "visible-area" })}
      >
        <span class="popup-btn-icon" aria-hidden="true">&#9634;</span>
        <span class="popup-btn-label">Visible Area</span>
      </button>
      <button
        type="button"
        class="popup-btn"
        @click=${() => this.#dispatch({ type: "select-region" })}
      >
        <span class="popup-btn-icon" aria-hidden="true">&#9698;</span>
        <span class="popup-btn-label">Select Region</span>
      </button>
      <button type="button" class="popup-btn" @click=${this.#onWholePageClick}>
        <span class="popup-btn-icon" aria-hidden="true">&#128196;</span>
        <span class="popup-btn-label">Whole Page</span>
      </button>

      <div class="popup-section-title">Continuous capture</div>
      <button
        type="button"
        class="popup-btn"
        @click=${() => this.#dispatch({ type: "auto-start" })}
      >
        <span class="popup-btn-icon" aria-hidden="true">&#9889;</span>
        <span class="popup-btn-label">Auto</span>
      </button>
      <button
        type="button"
        class="popup-btn"
        @click=${this.#onHotkeyClick}
      >
        <span class="popup-btn-icon" aria-hidden="true">&#9000;</span>
        <span class="popup-btn-label">Hotkey</span>
        ${
          this.hotkeyShortcut
            ? html`<span class="popup-btn-trailing">${this.hotkeyShortcut}</span>`
            : nothing
        }
      </button>
      ${this.hotkeyUnboundNotice ? this.#renderHotkeyUnboundNotice() : nothing}

      <div class="popup-separator"></div>

      <button
        type="button"
        class="popup-btn popup-btn-secondary"
        @click=${() => this.#dispatch({ type: "open-gallery" })}
      >
        <span class="popup-btn-icon" aria-hidden="true">&#128444;</span>
        <span class="popup-btn-label">Gallery</span>
      </button>
      <button type="button" class="popup-btn popup-btn-secondary" @click=${this.#openOptions}>
        <span class="popup-btn-icon" aria-hidden="true">&#9881;</span>
        <span class="popup-btn-label">Settings</span>
      </button>
    `;
  }

  #renderHotkeyActive() {
    return html`
      <div class="popup-rec-indicator">
        <span class="popup-rec-dot" aria-hidden="true"></span>
        <span class="popup-rec-text">Hotkey Capture Active</span>
      </div>
      <div class="popup-rec-count">
        ${
          this.hotkeyShortcut
            ? html`Press <span class="popup-kbd">${this.hotkeyShortcut}</span> to capture`
            : html`Configure a shortcut in Settings to capture frames`
        }
      </div>
      <div class="popup-rec-count">${this.hotkeyCount} frame${this.hotkeyCount === 1 ? "" : "s"} captured</div>
      <button
        type="button"
        class="popup-btn popup-btn-primary"
        @click=${() => this.#dispatch({ type: "hotkey-capture-now" })}
      >
        <span class="popup-btn-icon" aria-hidden="true">+</span>
        <span class="popup-btn-label">Add Capture</span>
      </button>
      <button
        type="button"
        class="popup-btn popup-btn-stop"
        @click=${() => this.#dispatch({ type: "hotkey-stop" })}
      >
        <span class="popup-btn-icon" aria-hidden="true">&#9632;</span>
        <span class="popup-btn-label">Stop &amp; Review</span>
      </button>
      <div class="popup-separator"></div>
      <button
        type="button"
        class="popup-btn popup-btn-secondary"
        @click=${() => this.#dispatch({ type: "open-gallery" })}
      >
        <span class="popup-btn-icon" aria-hidden="true">&#128444;</span>
        <span class="popup-btn-label">Gallery</span>
      </button>
    `;
  }

  #renderAutoActive() {
    const summary = this.autoSummary;
    const count = summary?.count ?? 0;
    const stable = summary ? `${(summary.stableWaitMs / 1000).toFixed(1)}s` : "—";
    const interval = summary ? `${(summary.minIntervalMs / 1000).toFixed(1)}s` : "—";
    return html`
      <div class="popup-rec-indicator">
        <span class="popup-rec-dot" aria-hidden="true"></span>
        <span class="popup-rec-text">Auto Capture Active</span>
      </div>
      <div class="popup-rec-count">Watching for DOM changes on the active tab…</div>
      <div class="popup-rec-count">${count} frame${count === 1 ? "" : "s"} captured</div>
      <div class="popup-rec-summary">
        Stable wait: <span class="popup-kbd">${stable}</span> · Min interval:
        <span class="popup-kbd">${interval}</span>
      </div>
      <button
        type="button"
        class="popup-btn popup-btn-primary"
        @click=${() => this.#dispatch({ type: "auto-capture-now" })}
      >
        <span class="popup-btn-icon" aria-hidden="true">+</span>
        <span class="popup-btn-label">Add Capture</span>
      </button>
      <button
        type="button"
        class="popup-btn popup-btn-stop"
        @click=${() => this.#dispatch({ type: "auto-stop" })}
      >
        <span class="popup-btn-icon" aria-hidden="true">&#9632;</span>
        <span class="popup-btn-label">Stop &amp; Review</span>
      </button>
      <div class="popup-separator"></div>
      <button
        type="button"
        class="popup-btn popup-btn-secondary"
        @click=${() => this.#dispatch({ type: "open-gallery" })}
      >
        <span class="popup-btn-icon" aria-hidden="true">&#128444;</span>
        <span class="popup-btn-label">Gallery</span>
      </button>
    `;
  }

  #renderQuickOptions() {
    const s = this.settings;
    return html`
      <details
        class="popup-quick-options"
        ?open=${this.quickOptionsOpen}
        @toggle=${(e: Event) => {
          this.quickOptionsOpen = (e.currentTarget as HTMLDetailsElement).open;
        }}
      >
        <summary class="popup-quick-options-summary">Quick Options</summary>
        ${
          s === null
            ? html`<div class="popup-quick-options-loading">Loading…</div>`
            : html`
              <label class="popup-quick-options-row">
                <span class="popup-quick-options-label">Format</span>
                <select
                  class="popup-quick-options-select"
                  .value=${s.quality.format}
                  @change=${(e: Event) => this.#updateFormat(e)}
                >
                  ${FORMAT_OPTIONS.map(
                    (opt) => html`
                      <option value=${opt.value} ?selected=${s.quality.format === opt.value}>
                        ${opt.label}
                      </option>
                    `,
                  )}
                </select>
              </label>

              <label class="popup-quick-options-row">
                <span class="popup-quick-options-label">Save size</span>
                <select
                  class="popup-quick-options-select"
                  .value=${s.quality.saveSizePreset}
                  @change=${(e: Event) => this.#updateSaveSize(e)}
                >
                  ${SAVE_SIZE_OPTIONS.map(
                    (preset) => html`
                      <option
                        value=${preset}
                        ?selected=${s.quality.saveSizePreset === preset}
                      >
                        ${SAVE_SIZE_LABEL[preset]}
                      </option>
                    `,
                  )}
                </select>
              </label>

              <label class="popup-quick-options-row">
                <span class="popup-quick-options-label">Emulation</span>
                <select
                  class="popup-quick-options-select"
                  .value=${s.emulation.enabled ? s.emulation.preset : "native"}
                  @change=${(e: Event) => this.#updateEmulation(e)}
                >
                  ${EMULATION_OPTIONS.map(
                    (opt) => html`
                      <option
                        value=${opt.value}
                        ?selected=${
                          (s.emulation.enabled ? s.emulation.preset : "native") === opt.value
                        }
                      >
                        ${opt.label}
                      </option>
                    `,
                  )}
                </select>
              </label>

              <label class="popup-quick-options-row">
                <span class="popup-quick-options-label">Hide overlays</span>
                <select
                  class="popup-quick-options-select"
                  .value=${s.overlays.mode}
                  @change=${(e: Event) => this.#updateOverlayMode(e)}
                >
                  ${OVERLAY_OPTIONS.map(
                    (opt) => html`
                      <option value=${opt.value} ?selected=${s.overlays.mode === opt.value}>
                        ${opt.label}
                      </option>
                    `,
                  )}
                </select>
              </label>

              <label class="popup-quick-options-row">
                <span class="popup-quick-options-label">Whole Page output</span>
                <select
                  class="popup-quick-options-select"
                  .value=${s.wholePageOutput}
                  @change=${(e: Event) => this.#updateWholePageOutput(e)}
                >
                  ${WHOLE_PAGE_OUTPUT_OPTIONS.map(
                    (opt) => html`
                      <option value=${opt.value} ?selected=${s.wholePageOutput === opt.value}>
                        ${opt.label}
                      </option>
                    `,
                  )}
                </select>
              </label>
            `
        }
      </details>
      ${nothing}
    `;
  }

  /** Whole Page button picks the matching capture entry point based
   *  on the persisted `wholePageOutput` preference. */
  #onWholePageClick = (): void => {
    const out = this.settings?.wholePageOutput ?? "stitched";
    const type: PopupMessage["type"] =
      out === "perScreen" ? "whole-page-per-screen" : "whole-page-stitched";
    this.#dispatch({ type } as PopupMessage);
  };

  /** Hotkey button: starts the session when a keyboard shortcut is
   *  bound; otherwise surfaces the inline notice so the user can
   *  jump straight to the browser shortcuts page without closing
   *  the popup and re-clicking the toolbar icon. */
  #onHotkeyClick = (): void => {
    if (this.hotkeyShortcut) {
      this.#dispatch({ type: "hotkey-start" });
    } else {
      this.hotkeyUnboundNotice = true;
    }
  };

  /** Notice rendered below the Hotkey button when the user clicks
   *  it while no shortcut is bound. The host owns the actual
   *  navigation (the popup component is host-neutral) — clicking
   *  "Configure" dispatches `open-shortcuts`, which popup.ts
   *  translates into a browser-detected `chrome.tabs.create`. */
  #renderHotkeyUnboundNotice() {
    return html`
      <div class="popup-hotkey-notice" role="status">
        <div class="popup-hotkey-notice-text">
          No keyboard shortcut is bound to <strong>Hotkey</strong>. Configure one in
          your browser's extension settings to use this capture mode.
        </div>
        <div class="popup-hotkey-notice-actions">
          <button
            type="button"
            class="popup-hotkey-notice-btn"
            @click=${this.#openShortcuts}
          >
            Configure shortcut
          </button>
          <button
            type="button"
            class="popup-hotkey-notice-dismiss"
            aria-label="Dismiss"
            @click=${() => {
              this.hotkeyUnboundNotice = false;
            }}
          >
            &times;
          </button>
        </div>
      </div>
    `;
  }

  #openShortcuts = (): void => {
    this.dispatchEvent(new CustomEvent("open-shortcuts"));
  };

  #updateFormat(e: Event): void {
    const value = (e.currentTarget as HTMLSelectElement).value as ImageFormat;
    this.#mutate((s) => {
      s.quality.format = value;
    });
  }

  #updateSaveSize(e: Event): void {
    const value = (e.currentTarget as HTMLSelectElement).value as SaveSizePreset;
    this.#mutate((s) => {
      s.quality.saveSizePreset = value;
    });
  }

  /** Emulation collapses two underlying fields (`enabled` + `preset`)
   *  into one select. `"native"` resolves to `enabled = false`; any
   *  preset resolves to `enabled = true, preset = <value>`. */
  #updateEmulation(e: Event): void {
    const value = (e.currentTarget as HTMLSelectElement).value as EmulationPreset;
    this.#mutate((s) => {
      if (value === "native") {
        s.emulation.enabled = false;
        s.emulation.preset = "native";
      } else {
        s.emulation.enabled = true;
        s.emulation.preset = value;
      }
    });
  }

  #updateOverlayMode(e: Event): void {
    const value = (e.currentTarget as HTMLSelectElement).value as OverlayMode;
    this.#mutate((s) => {
      s.overlays.mode = value;
    });
  }

  #updateWholePageOutput(e: Event): void {
    const value = (e.currentTarget as HTMLSelectElement).value as WholePageOutput;
    this.#mutate((s) => {
      s.wholePageOutput = value;
    });
  }

  #mutate(fn: (draft: Settings) => void): void {
    if (this.settings === null) return;
    const next: Settings = structuredClone(this.settings);
    fn(next);
    this.settings = next;
    this.dispatchEvent(
      new CustomEvent<Settings>("popup-settings-changed", { detail: next, bubbles: true }),
    );
  }

  #dispatch(msg: PopupMessage): void {
    this.dispatchEvent(
      new CustomEvent<PopupMessage>("popup-message", { detail: msg, bubbles: true }),
    );
  }

  #openOptions = (): void => {
    this.dispatchEvent(new CustomEvent("open-options", { bubbles: true }));
  };
}

if (!customElements.get("annot-extension-popup")) {
  customElements.define("annot-extension-popup", AnnotExtensionPopupElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-extension-popup": AnnotExtensionPopupElement;
  }
}
