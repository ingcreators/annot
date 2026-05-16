/**
 * `<annot-capture-settings>` — capture-mode settings form.
 *
 * Phase 6 of `docs/plans/desktop-browser-mode.md`. Hosts (the
 * Electron Browse window today; a future PWA capture surface
 * tomorrow) embed this Lit component in a modal / drawer / page
 * and persist the emitted `Settings` via their own host I/O
 * (`chrome.storage.sync` for the extension; the
 * `capture.settings.save` IPC for the desktop).
 *
 * The component is purely presentational + form-state. It
 * doesn't reach for `chrome.storage` / `electronAPI` itself; the
 * embedding host provides initial settings via the `settings`
 * property and listens for `settings-changed` events on every
 * form input. The same component therefore works in:
 *
 *   - Desktop Browse window (this PR)
 *   - PWA capture surface (future)
 *   - Storybook (mock host that just logs the events)
 *
 * Light-DOM scoped CSS (hybrid) — same convention as the rest
 * of `host-ui`'s built-in Lit elements. Styles live in
 * `static styles` so embedding hosts don't need to opt in to a
 * shared stylesheet; the form lays out cleanly inside any
 * container.
 */

import {
  DEFAULT_SETTINGS,
  type EmulationPreset,
  type ImageFormat,
  mergeSettings,
  type OverlayMode,
  type Settings,
} from "@ingcreators/annot-capture/shared";
import {
  type AutoCaptureOptions,
  CAPTURE_INTERVAL_LABEL,
  type CaptureIntervalPreset,
  CHANGE_SENSITIVITY_LABEL,
  type ChangeSensitivityPreset,
  DEFAULT_AUTO_CAPTURE_OPTIONS,
  STABLE_WAIT_LABEL,
  type StableWaitPreset,
} from "@ingcreators/annot-core/auto-capture-options";
import { type CSSResultGroup, css, html, LitElement } from "./lit.js";

export interface CaptureSettingsChangeDetail {
  /** Validated, fully-formed Settings — always passed through
   *  `mergeSettings` so the host can persist the value as-is
   *  without re-validating. */
  settings: Settings;
}

export interface AutoCaptureOptionsChangeDetail {
  /** Fully-formed `AutoCaptureOptions`. The host listener persists
   *  this blob separately from `Settings` (it lives at
   *  `chrome.storage.sync["annot.autoCapture.v1"]` on the
   *  extension). */
  options: AutoCaptureOptions;
}

/** Combined emulation selection: `"off"` collapses the storage-level
 *  `enabled: false` + `preset: "native"` pair into one UI choice so
 *  the user isn't asked to set two coupled fields. */
const EMULATION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "off", label: "Off (use the real viewport)" },
  { value: "fullhd", label: "Full HD — 1920 × 1080" },
  { value: "macbook", label: "MacBook — 1440 × 900" },
  { value: "iphonese", label: "iPhone SE — 375 × 667" },
  { value: "iphone15promax", label: "iPhone 15 Pro Max — 430 × 932" },
  { value: "ipad", label: "iPad — 1024 × 1366" },
  { value: "custom", label: "Custom…" },
];

const INTERVAL_OPTIONS: readonly CaptureIntervalPreset[] = ["fast", "standard", "slow"];
const SENSITIVITY_OPTIONS: readonly ChangeSensitivityPreset[] = ["sensitive", "standard", "major"];
const STABLE_WAIT_OPTIONS: readonly StableWaitPreset[] = ["none", "short", "long"];

export class AnnotCaptureSettingsElement extends LitElement {
  static override properties = {
    settings: { attribute: false },
    autoCaptureOptions: { attribute: false },
    showAutoCapture: { attribute: false },
  };

  declare settings: Settings;
  declare autoCaptureOptions: AutoCaptureOptions;
  /** Whether to surface the Auto Capture options section. Default
   *  `false` — the host (e.g. the chrome extension's options page)
   *  opts in. Desktop Browse window leaves it off because Auto
   *  Capture isn't a feature there. */
  declare showAutoCapture: boolean;

  constructor() {
    super();
    this.settings = DEFAULT_SETTINGS;
    this.autoCaptureOptions = DEFAULT_AUTO_CAPTURE_OPTIONS;
    this.showAutoCapture = false;
  }

  static override styles: CSSResultGroup = css`
    /* Theme tokens come from the host page's :root — custom
       properties inherit through the shadow-DOM boundary. Defaults
       below apply when the consumer hasn't published a value
       (e.g. the desktop browse window's <annot-capture-settings>
       dialog, which is dark-only chrome). The extension's options
       page publishes both dark and light variants on :root vs
       :root.light so the element retints automatically with the
       page-level theme class. */
    :host {
      display: block;
      font: 13px / 1.45 system-ui, -apple-system, "Segoe UI", Roboto,
        sans-serif;
      color: var(--annot-text, #e7ecf7);
    }

    .options-section {
      background: var(--annot-bg-panel, #10172b);
      border: 1px solid var(--annot-border, #1f2746);
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 14px;
    }

    .options-section h2 {
      margin: 0 0 4px;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }

    .section-hint {
      margin: 0 0 14px;
      color: var(--annot-text-muted, #9fb0dc);
      font-size: 12px;
    }

    .field {
      margin-bottom: 12px;
    }
    .field:last-child {
      margin-bottom: 0;
    }

    .field label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 4px;
      color: var(--annot-text-strong, #d1d5db);
    }

    .field-hint {
      margin-top: 4px;
      font-size: 11px;
      color: var(--annot-text-muted, #9fb0dc);
      line-height: 1.4;
    }

    .checkbox-row label.checkbox {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      color: var(--annot-text, #e7ecf7);
    }

    .field-row {
      display: flex;
      gap: 12px;
    }
    .field-row > div {
      flex: 1;
    }

    select,
    input[type="text"],
    input[type="number"],
    textarea {
      width: 100%;
      background: var(--annot-input-bg, #0d1325);
      color: var(--annot-text, #e7ecf7);
      border: 1px solid var(--annot-border, #1f2746);
      border-radius: 6px;
      padding: 6px 8px;
      font: inherit;
    }
    textarea {
      resize: vertical;
      min-height: 60px;
      font-family: ui-monospace, SF Mono, Menlo, monospace;
      font-size: 12px;
    }
    select:focus,
    input:focus,
    textarea:focus {
      outline: 2px solid var(--annot-accent, #7c9cff);
      outline-offset: -1px;
      border-color: transparent;
    }

    input[type="range"] {
      width: 100%;
      accent-color: var(--annot-accent, #7c9cff);
    }

    output {
      float: right;
      font-variant-numeric: tabular-nums;
      color: var(--annot-text-muted, #9fb0dc);
      font-size: 12px;
    }

    details.advanced summary {
      cursor: pointer;
      font-size: 12px;
      color: var(--annot-text-muted, #9fb0dc);
      padding: 4px 0;
    }

    .options-footer {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 18px;
      padding: 12px 0 0;
      border-top: 1px solid var(--annot-border, #1f2746);
    }

    .btn {
      background: var(--annot-bg-section, #13192d);
      color: var(--annot-text, #e7ecf7);
      border: 1px solid var(--annot-border, #1f2746);
      border-radius: 6px;
      padding: 6px 14px;
      font: inherit;
      cursor: pointer;
    }
    .btn:hover {
      background: var(--annot-bg-section-hover, #1c2444);
    }
    .footer-spacer {
      flex: 1;
    }
    .footer-saved {
      font-size: 12px;
      color: var(--annot-text-muted, #9fb0dc);
    }

    code {
      font-family: ui-monospace, SF Mono, Menlo, monospace;
      font-size: 12px;
      padding: 1px 4px;
      background: var(--annot-input-bg, #0d1325);
      border-radius: 3px;
    }
  `;

  override render(): unknown {
    const s = this.settings;
    return html`
      <section class="options-section">
        <h2>Overlays</h2>
        <p class="section-hint">
          Hide fixed headers, stickies, and modals during capture.
        </p>

        <div class="field">
          <label for="overlay-mode">When to hide overlays</label>
          <select
            id="overlay-mode"
            .value=${s.overlays.mode}
            @change=${this.#onOverlayMode}
          >
            <option value="scrollOnly">
              Scroll &amp; per-page captures only (recommended)
            </option>
            <option value="all">All captures</option>
            <option value="never">Never — always keep overlays</option>
          </select>
        </div>

        <div class="field checkbox-row">
          <label class="checkbox">
            <input
              type="checkbox"
              ?checked=${s.overlays.keepFirstSegment}
              @change=${this.#onKeepFirstSegment}
            />
            <span>Keep overlays on the first viewport (scroll / per-page)</span>
          </label>
          <div class="field-hint">
            Recommended. Keeps the page's natural header on the first
            segment, hides it from segment 2 onward so it doesn't
            repeat in the stitched image.
          </div>
        </div>

        <details class="advanced">
          <summary>Advanced: preserved selectors</summary>
          <div class="field">
            <label for="preserved-selectors"
              >CSS selectors to NEVER hide (one per line, or
              comma-separated)</label
            >
            <textarea
              id="preserved-selectors"
              rows="3"
              placeholder=".must-stay, #keep-this, header.brand"
              .value=${s.overlays.preservedSelectors}
              @change=${this.#onPreservedSelectors}
            ></textarea>
            <div class="field-hint">
              Example: <code>.toast, #cookie-banner</code> — useful
              when a banner is part of the page you want to capture.
            </div>
          </div>
        </details>
      </section>

      <section class="options-section">
        <h2>Scrollbars</h2>
        <div class="field checkbox-row">
          <label class="checkbox">
            <input
              type="checkbox"
              ?checked=${s.scrollbars.hide}
              @change=${this.#onScrollbarsHide}
            />
            <span>Hide browser scrollbars during capture</span>
          </label>
        </div>
      </section>

      <section class="options-section">
        <h2>Capture timing</h2>
        <p class="section-hint">
          Longer delays produce more stable captures on slow / animated
          pages.
        </p>

        <div class="field">
          <label for="scroll-settle">
            Scroll settle delay
            <output>${s.timing.scrollSettleMs} ms</output>
          </label>
          <input
            type="range"
            id="scroll-settle"
            min="100"
            max="2000"
            step="50"
            .value=${String(s.timing.scrollSettleMs)}
            @input=${this.#onScrollSettle}
          />
          <div class="field-hint">
            Wait after scrolling before snapping each full-page /
            per-page segment.
          </div>
        </div>

        <div class="field">
          <label for="click-settle">
            Click-capture settle delay
            <output>${s.timing.clickSettleMs} ms</output>
          </label>
          <input
            type="range"
            id="click-settle"
            min="50"
            max="1500"
            step="25"
            .value=${String(s.timing.clickSettleMs)}
            @input=${this.#onClickSettle}
          />
          <div class="field-hint">
            Wait after each click before the shot (lets menus /
            tooltips render).
          </div>
        </div>

        <div class="field">
          <label for="hotkey-settle">
            Hotkey-capture settle delay
            <output>${s.timing.hotkeySettleMs} ms</output>
          </label>
          <input
            type="range"
            id="hotkey-settle"
            min="0"
            max="500"
            step="10"
            .value=${String(s.timing.hotkeySettleMs)}
            @input=${this.#onHotkeySettle}
          />
          <div class="field-hint">
            Usually kept short so the shot matches the exact moment
            the key fired.
          </div>
        </div>

        <div class="field">
          <label for="inter-seg">
            Inter-segment pause
            <output>${s.timing.interSegmentMs} ms</output>
          </label>
          <input
            type="range"
            id="inter-seg"
            min="0"
            max="500"
            step="25"
            .value=${String(s.timing.interSegmentMs)}
            @input=${this.#onInterSegment}
          />
          <div class="field-hint">
            Throttle between successive segments of scroll / per-page
            captures.
          </div>
        </div>
      </section>

      <section class="options-section">
        <h2>Image format</h2>

        <div class="field">
          <label for="image-format">Format</label>
          <select
            id="image-format"
            .value=${s.quality.format}
            @change=${this.#onImageFormat}
          >
            <option value="smart">
              Smart — PNG-8 for UI, fallback for photos (recommended)
            </option>
            <option value="png">PNG — always lossless (larger files)</option>
            <option value="jpeg">JPEG — smallest, lossy on text/UI</option>
          </select>
          <div class="field-hint">
            Smart mode: palettizes crisp UI screens to PNG-8 (smaller
            AND sharper than JPEG), but automatically falls back for
            photo-heavy pages to avoid posterization.
          </div>
        </div>

        ${
          s.quality.format === "smart"
            ? html`
              <div class="field">
                <label for="smart-fallback">
                  Smart fallback (for photo-heavy pages)
                </label>
                <select
                  id="smart-fallback"
                  .value=${s.quality.smartFallback}
                  @change=${this.#onSmartFallback}
                >
                  <option value="png">PNG-24 — lossless, larger</option>
                  <option value="jpeg">JPEG — compact, lossy</option>
                </select>
              </div>

              <div class="field">
                <label for="smart-threshold">
                  Smart color threshold
                  <output>${s.quality.smartColorThreshold}</output>
                </label>
                <input
                  type="range"
                  id="smart-threshold"
                  min="2000"
                  max="50000"
                  step="1000"
                  .value=${String(s.quality.smartColorThreshold)}
                  @input=${this.#onSmartThreshold}
                />
                <div class="field-hint">
                  If a sampled pixel scan finds more unique colors
                  than this, the image is treated as photo-heavy and
                  falls back. Default <strong>15000</strong>.
                </div>
              </div>
            `
            : null
        }

        <div class="field">
          <label for="jpeg-q">
            JPEG quality
            <output>${s.quality.jpegPercent}%</output>
          </label>
          <input
            type="range"
            id="jpeg-q"
            min="60"
            max="100"
            step="1"
            .value=${String(s.quality.jpegPercent)}
            @input=${this.#onJpegQuality}
          />
          <div class="field-hint">
            85–95% is good for screenshots.
          </div>
        </div>
      </section>

      ${this.showAutoCapture ? this.#renderAutoCaptureSection() : null}

      <section class="options-section">
        <h2>Viewport emulation</h2>
        <p class="section-hint">
          Resize the window before each capture so the image lands on
          a specific pixel size.
        </p>

        <div class="field">
          <label for="emulation-preset">Target viewport</label>
          <select
            id="emulation-preset"
            .value=${s.emulation.enabled ? s.emulation.preset : "off"}
            @change=${this.#onEmulationSelect}
          >
            ${EMULATION_OPTIONS.map(
              (opt) => html`<option value=${opt.value}>${opt.label}</option>`,
            )}
          </select>
          ${
            s.emulation.enabled
              ? html`<div class="field-hint">
                ⚠ The window will briefly resize during capture. Clamped
                to the monitor's available size if the target exceeds it.
              </div>`
              : null
          }
        </div>

        ${
          s.emulation.enabled && s.emulation.preset === "custom"
            ? html`
              <div class="field field-row">
                <div>
                  <label for="custom-width">Width (px)</label>
                  <input
                    type="number"
                    id="custom-width"
                    min="320"
                    max="4096"
                    step="1"
                    .value=${String(s.emulation.customWidth)}
                    @change=${this.#onCustomWidth}
                  />
                </div>
                <div>
                  <label for="custom-height">Height (px)</label>
                  <input
                    type="number"
                    id="custom-height"
                    min="320"
                    max="4096"
                    step="1"
                    .value=${String(s.emulation.customHeight)}
                    @change=${this.#onCustomHeight}
                  />
                </div>
              </div>
            `
            : null
        }
      </section>

      <div class="options-footer">
        <button type="button" class="btn" @click=${this.#onReset}>
          Reset to defaults
        </button>
        <span class="footer-spacer"></span>
      </div>
    `;
  }

  // ---- Field handlers ──────────────────────────────────────────
  //
  // Each handler reads the input value, builds a Settings patch
  // limited to the changed slot, hands it to `#emit`, which merges
  // against `DEFAULT_SETTINGS`, updates `this.settings`, and fires
  // `settings-changed`. The host listens for that event and
  // persists.

  #onOverlayMode(e: Event): void {
    const v = (e.target as HTMLSelectElement).value as OverlayMode;
    this.#emit({ overlays: { ...this.settings.overlays, mode: v } });
  }

  #onKeepFirstSegment(e: Event): void {
    const v = (e.target as HTMLInputElement).checked;
    this.#emit({
      overlays: { ...this.settings.overlays, keepFirstSegment: v },
    });
  }

  #onPreservedSelectors(e: Event): void {
    const v = (e.target as HTMLTextAreaElement).value;
    this.#emit({
      overlays: { ...this.settings.overlays, preservedSelectors: v },
    });
  }

  #onScrollbarsHide(e: Event): void {
    const v = (e.target as HTMLInputElement).checked;
    this.#emit({ scrollbars: { hide: v } });
  }

  #onScrollSettle(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    this.#emit({ timing: { ...this.settings.timing, scrollSettleMs: v } });
  }

  #onClickSettle(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    this.#emit({ timing: { ...this.settings.timing, clickSettleMs: v } });
  }

  #onHotkeySettle(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    this.#emit({ timing: { ...this.settings.timing, hotkeySettleMs: v } });
  }

  #onInterSegment(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    this.#emit({ timing: { ...this.settings.timing, interSegmentMs: v } });
  }

  #onImageFormat(e: Event): void {
    const v = (e.target as HTMLSelectElement).value as ImageFormat;
    this.#emit({ quality: { ...this.settings.quality, format: v } });
  }

  #onSmartFallback(e: Event): void {
    const v = (e.target as HTMLSelectElement).value as "png" | "jpeg";
    this.#emit({ quality: { ...this.settings.quality, smartFallback: v } });
  }

  #onSmartThreshold(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    this.#emit({
      quality: { ...this.settings.quality, smartColorThreshold: v },
    });
  }

  #onJpegQuality(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    this.#emit({ quality: { ...this.settings.quality, jpegPercent: v } });
  }

  /** Combined emulation select. Stores translate `"off"` to
   *  `enabled: false` and any other value to `enabled: true` +
   *  `preset: <value>`. */
  #onEmulationSelect(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    if (v === "off") {
      this.#emit({ emulation: { ...this.settings.emulation, enabled: false } });
      return;
    }
    this.#emit({
      emulation: {
        ...this.settings.emulation,
        enabled: true,
        preset: v as EmulationPreset,
      },
    });
  }

  #onCustomWidth(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    this.#emit({ emulation: { ...this.settings.emulation, customWidth: v } });
  }

  #onCustomHeight(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    this.#emit({
      emulation: { ...this.settings.emulation, customHeight: v },
    });
  }

  // ---- Auto Capture handlers ───────────────────────────────────

  #onAutoInterval(e: Event): void {
    const v = (e.target as HTMLSelectElement).value as CaptureIntervalPreset;
    this.#emitAuto({ ...this.autoCaptureOptions, interval: v });
  }

  #onAutoSensitivity(e: Event): void {
    const v = (e.target as HTMLSelectElement).value as ChangeSensitivityPreset;
    this.#emitAuto({ ...this.autoCaptureOptions, sensitivity: v });
  }

  #onAutoStableWait(e: Event): void {
    const v = (e.target as HTMLSelectElement).value as StableWaitPreset;
    this.#emitAuto({ ...this.autoCaptureOptions, stableWait: v });
  }

  #onAutoIgnoreCursor(e: Event): void {
    const v = (e.target as HTMLInputElement).checked;
    this.#emitAuto({ ...this.autoCaptureOptions, ignoreCursorOnlyChanges: v });
  }

  #emitAuto(next: AutoCaptureOptions): void {
    this.autoCaptureOptions = next;
    this.dispatchEvent(
      new CustomEvent<AutoCaptureOptionsChangeDetail>("auto-capture-options-changed", {
        detail: { options: next },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #onReset(): void {
    this.settings = DEFAULT_SETTINGS;
    this.autoCaptureOptions = DEFAULT_AUTO_CAPTURE_OPTIONS;
    this.dispatchEvent(
      new CustomEvent<CaptureSettingsChangeDetail>("settings-changed", {
        detail: { settings: DEFAULT_SETTINGS },
        bubbles: true,
        composed: true,
      }),
    );
    this.dispatchEvent(
      new CustomEvent<AutoCaptureOptionsChangeDetail>("auto-capture-options-changed", {
        detail: { options: DEFAULT_AUTO_CAPTURE_OPTIONS },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Render the Auto Capture options block. Same select/checkbox
   *  shape the Web app's `<annot-capture-screen-dialog>` uses for
   *  the same options, so users see one consistent UX whether they
   *  open Settings or the dialog. */
  #renderAutoCaptureSection(): unknown {
    const a = this.autoCaptureOptions;
    return html`
      <section class="options-section">
        <h2>Auto Capture</h2>
        <p class="section-hint">
          How the extension's Auto Capture mode decides when to fire
          a frame as the page changes.
        </p>

        <div class="field">
          <label for="auto-interval">Capture interval</label>
          <select
            id="auto-interval"
            .value=${a.interval}
            @change=${this.#onAutoInterval}
          >
            ${INTERVAL_OPTIONS.map(
              (preset) => html`
                <option value=${preset}>${CAPTURE_INTERVAL_LABEL[preset]}</option>
              `,
            )}
          </select>
          <div class="field-hint">
            Minimum time between captures during a session.
          </div>
        </div>

        <div class="field">
          <label for="auto-sensitivity">Change sensitivity</label>
          <select
            id="auto-sensitivity"
            .value=${a.sensitivity}
            @change=${this.#onAutoSensitivity}
          >
            ${SENSITIVITY_OPTIONS.map(
              (preset) => html`
                <option value=${preset}>
                  ${CHANGE_SENSITIVITY_LABEL[preset]}
                </option>
              `,
            )}
          </select>
          <div class="field-hint">
            How aggressive Auto Capture should be when deciding that
            a DOM change is worth capturing.
          </div>
        </div>

        <div class="field">
          <label for="auto-stable-wait">Stable wait</label>
          <select
            id="auto-stable-wait"
            .value=${a.stableWait}
            @change=${this.#onAutoStableWait}
          >
            ${STABLE_WAIT_OPTIONS.map(
              (preset) => html`
                <option value=${preset}>${STABLE_WAIT_LABEL[preset]}</option>
              `,
            )}
          </select>
          <div class="field-hint">
            Wait this long after DOM mutations stop before capturing
            — avoids snapping mid-animation.
          </div>
        </div>

        <div class="field checkbox-row">
          <label class="checkbox">
            <input
              type="checkbox"
              ?checked=${a.ignoreCursorOnlyChanges}
              @change=${this.#onAutoIgnoreCursor}
            />
            <span>Ignore cursor-only changes</span>
          </label>
          <div class="field-hint">
            Drop frames whose only change is cursor movement /
            hover-state styling.
          </div>
        </div>
      </section>
    `;
  }

  /** Apply a partial `Settings` patch over the current value, run
   *  it through `mergeSettings` for validation + defaults, and
   *  emit a typed `settings-changed` event. The host listener
   *  persists the validated value. */
  #emit(patch: Partial<Settings>): void {
    const merged = mergeSettings({ ...this.settings, ...patch });
    this.settings = merged;
    this.dispatchEvent(
      new CustomEvent<CaptureSettingsChangeDetail>("settings-changed", {
        detail: { settings: merged },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

if (!customElements.get("annot-capture-settings")) {
  customElements.define("annot-capture-settings", AnnotCaptureSettingsElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-capture-settings": AnnotCaptureSettingsElement;
  }
  interface HTMLElementEventMap {
    "settings-changed": CustomEvent<CaptureSettingsChangeDetail>;
    "auto-capture-options-changed": CustomEvent<AutoCaptureOptionsChangeDetail>;
  }
}
