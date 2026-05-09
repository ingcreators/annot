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
import { type CSSResultGroup, css, html, LitElement } from "./lit.js";

export interface CaptureSettingsChangeDetail {
  /** Validated, fully-formed Settings — always passed through
   *  `mergeSettings` so the host can persist the value as-is
   *  without re-validating. */
  settings: Settings;
}

export class AnnotCaptureSettingsElement extends LitElement {
  static override properties = {
    settings: { attribute: false },
  };

  declare settings: Settings;

  constructor() {
    super();
    this.settings = DEFAULT_SETTINGS;
  }

  static override styles: CSSResultGroup = css`
    :host {
      display: block;
      font: 13px / 1.45 system-ui, -apple-system, "Segoe UI", Roboto,
        sans-serif;
      color: #e7ecf7;
      --annot-bg-panel: #10172b;
      --annot-bg-section: #13192d;
      --annot-border: #1f2746;
      --annot-text-muted: #9fb0dc;
      --annot-accent: #7c9cff;
      --annot-input-bg: #0d1325;
    }

    .options-section {
      background: var(--annot-bg-panel);
      border: 1px solid var(--annot-border);
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
      color: var(--annot-text-muted);
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
      color: #d1d5db;
    }

    .field-hint {
      margin-top: 4px;
      font-size: 11px;
      color: var(--annot-text-muted);
      line-height: 1.4;
    }

    .checkbox-row label.checkbox {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      color: #e7ecf7;
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
      background: var(--annot-input-bg);
      color: #e7ecf7;
      border: 1px solid var(--annot-border);
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
      outline: 2px solid var(--annot-accent);
      outline-offset: -1px;
      border-color: transparent;
    }

    input[type="range"] {
      width: 100%;
      accent-color: var(--annot-accent);
    }

    output {
      float: right;
      font-variant-numeric: tabular-nums;
      color: var(--annot-text-muted);
      font-size: 12px;
    }

    details.advanced summary {
      cursor: pointer;
      font-size: 12px;
      color: var(--annot-text-muted);
      padding: 4px 0;
    }

    .options-footer {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 18px;
      padding: 12px 0 0;
      border-top: 1px solid var(--annot-border);
    }

    .btn {
      background: var(--annot-bg-section);
      color: #e7ecf7;
      border: 1px solid var(--annot-border);
      border-radius: 6px;
      padding: 6px 14px;
      font: inherit;
      cursor: pointer;
    }
    .btn:hover {
      background: #1c2444;
    }
    .footer-spacer {
      flex: 1;
    }
    .footer-saved {
      font-size: 12px;
      color: var(--annot-text-muted);
    }

    code {
      font-family: ui-monospace, SF Mono, Menlo, monospace;
      font-size: 12px;
      padding: 1px 4px;
      background: var(--annot-input-bg);
      border-radius: 3px;
    }
  `;

  override render(): unknown {
    const s = this.settings;
    return html`
      <section class="options-section">
        <h2>Overlays</h2>
        <p class="section-hint">
          Hide fixed headers, stickies, and modals that repeat across
          scroll-capture segments.
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
            Recommended. The first scroll-capture segment keeps the
            page's natural header, then the header is hidden from
            segment 2 onward so it doesn't repeat in the stitched
            image. Matches Shottr / Xnapper / CleanShot behavior.
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
        <p class="field-hint">
          Injects CSS to hide the browser's scrollbar so it doesn't
          appear in the captured image.
        </p>
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
        <p class="section-hint">
          How captured images are encoded and stored.
        </p>

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
            Used for "JPEG" format and the JPEG smart-fallback option.
            85–95% is good for screenshots.
          </div>
        </div>

        <div class="field">
          <label for="thumb-q">
            Thumbnail quality
            <output>${s.quality.thumbnailPercent}%</output>
          </label>
          <input
            type="range"
            id="thumb-q"
            min="60"
            max="95"
            step="1"
            .value=${String(s.quality.thumbnailPercent)}
            @input=${this.#onThumbnailQuality}
          />
        </div>

        <div class="field">
          <label for="thumb-w">Thumbnail resolution</label>
          <select
            id="thumb-w"
            .value=${String(s.quality.thumbnailMaxWidth)}
            @change=${this.#onThumbnailWidth}
          >
            <option value="360">360 px — smallest</option>
            <option value="480">480 px — default</option>
            <option value="640">640 px — sharper on 4K displays</option>
            <option value="960">960 px — HiDPI</option>
          </select>
        </div>
      </section>

      <section class="options-section">
        <h2>Viewport emulation</h2>
        <p class="section-hint">
          Capture at a specified output pixel size by physically
          resizing the host's window before the capture, then
          restoring it. The DPR-aware math divides the target by your
          display's device-pixel-ratio so the resulting image lands on
          the requested pixel dimensions.
        </p>

        <div class="field checkbox-row">
          <label class="checkbox">
            <input
              type="checkbox"
              ?checked=${s.emulation.enabled}
              @change=${this.#onEmulationEnabled}
            />
            <span>Enable viewport emulation</span>
          </label>
          <div class="field-hint">
            ⚠ The window will briefly resize during capture. If the
            target is larger than your monitor (after DPR
            compensation) it's clamped to what fits.
          </div>
        </div>

        ${
          s.emulation.enabled
            ? html`
              <div class="field">
                <label for="emulation-preset">Viewport preset</label>
                <select
                  id="emulation-preset"
                  .value=${s.emulation.preset}
                  @change=${this.#onEmulationPreset}
                >
                  <option value="native">Native (don't resize)</option>
                  <option value="fullhd">Full HD — 1920 × 1080</option>
                  <option value="macbook">MacBook — 1440 × 900</option>
                  <option value="iphonese">
                    iPhone SE width — 375 × 667
                  </option>
                  <option value="iphone15promax">
                    iPhone 15 Pro Max width — 430 × 932
                  </option>
                  <option value="ipad">iPad width — 1024 × 1366</option>
                  <option value="custom">Custom…</option>
                </select>
              </div>

              ${
                s.emulation.preset === "custom"
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

  #onThumbnailQuality(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    this.#emit({
      quality: { ...this.settings.quality, thumbnailPercent: v },
    });
  }

  #onThumbnailWidth(e: Event): void {
    const v = Number((e.target as HTMLSelectElement).value);
    this.#emit({
      quality: { ...this.settings.quality, thumbnailMaxWidth: v },
    });
  }

  #onEmulationEnabled(e: Event): void {
    const v = (e.target as HTMLInputElement).checked;
    this.#emit({ emulation: { ...this.settings.emulation, enabled: v } });
  }

  #onEmulationPreset(e: Event): void {
    const v = (e.target as HTMLSelectElement).value as EmulationPreset;
    this.#emit({ emulation: { ...this.settings.emulation, preset: v } });
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

  #onReset(): void {
    this.settings = DEFAULT_SETTINGS;
    this.dispatchEvent(
      new CustomEvent<CaptureSettingsChangeDetail>("settings-changed", {
        detail: { settings: DEFAULT_SETTINGS },
        bubbles: true,
        composed: true,
      }),
    );
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
  }
}
