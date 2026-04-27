/**
 * `<annot-split-editor>` — full-screen page-break editor for Scroll
 * Capture and per-page Capture sessions.
 *
 * The session's frames are stacked vertically (perPage: N natural
 * frames; scroll: 1 tall stitched frame) into a virtual continuous
 * page. The user can:
 *   - drag an existing page-break line to move it
 *   - click in an empty region of the stack to add a new line there
 *   - shift-click or right-click a line (or press Delete while it's
 *     focused) to remove it
 *   - press Apply to re-slice all frames to the new boundaries
 *     and save
 *
 * Lit completion Phase 3 — replaces the imperative `SplitEditor`
 * class. The host (`split-editor-host.ts`) creates the element via
 * `document.createElement`, sets `.records` / `.onApply` /
 * `.onCancel`, calls `await el.mount()` for the async image-loading
 * step, and `el.remove()` to tear down. `unmount()` stays as a
 * method alias for parity with the pre-Lit shape.
 *
 * Light DOM (Hybrid CSS) keeps the existing `.split-editor` /
 * `.split-editor-handle` / `.split-editor-frame` rules in `app.css`
 * matching unchanged.
 */

import type { ImageRecord } from "@ingcreators/annot-core/storage";
import { html, LitElement } from "../lit.js";

export interface SplitEditorSlice {
  /** Base64 data URL (PNG) for the re-sliced frame. */
  dataUrl: string;
  width: number;
  height: number;
}

const MIN_SLICE_PX = 40; // smallest allowed slice height in natural pixels
const CLICK_TOLERANCE_PX = 3; // mouse movement under this = click (not drag)

export class AnnotSplitEditorElement extends LitElement {
  static override properties = {
    records: { attribute: false },
    onApply: { attribute: false },
    onCancel: { attribute: false },
    boundaries: { state: true },
    applying: { state: true },
    ready: { state: true },
  };

  declare records: ImageRecord[];
  declare onApply: ((slices: SplitEditorSlice[]) => Promise<void> | void) | null;
  declare onCancel: (() => void) | null;
  declare boundaries: number[];
  declare applying: boolean;
  declare ready: boolean;

  #images: HTMLImageElement[] = [];
  #heights: number[] = [];
  #offsets: number[] = [];
  #totalHeight = 0;
  #width = 0;
  #displayScale = 1;

  #dragging: {
    boundaryValue: number;
    handleEl: HTMLElement;
    offsetWithinHandle: number;
    startClientY: number;
    moved: boolean;
  } | null = null;
  #onMouseMove: ((e: MouseEvent) => void) | null = null;
  #onMouseUp: ((e: MouseEvent) => void) | null = null;
  #onResize: (() => void) | null = null;

  constructor() {
    super();
    this.records = [];
    this.onApply = null;
    this.onCancel = null;
    this.boundaries = [];
    this.applying = false;
    this.ready = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /**
   * Load all frame images and seed the initial boundary set (one
   * per joint between adjacent frames). Called by the host after
   * appending the element so failures surface as a thrown error
   * the host can show in a dialog.
   */
  async mount(): Promise<void> {
    if (this.records.length === 0) {
      throw new Error("AnnotSplitEditor requires at least 1 frame");
    }

    for (let i = 0; i < this.records.length; i++) {
      const r = this.records[i]!;
      if (!r.originalDataUrl?.startsWith("data:")) {
        throw new Error(
          `Frame ${i + 1}/${this.records.length} has no image data (path="${r.path}"). The session may not have fully transferred yet — try reloading.`,
        );
      }
    }

    try {
      this.#images = await Promise.all(
        this.records.map((r, i) =>
          loadImage(r.originalDataUrl).catch((e: Error) => {
            const size = r.originalDataUrl?.length ?? 0;
            throw new Error(
              `Frame ${i + 1}: failed to decode image (size=${(size / 1024).toFixed(0)} KB, path="${r.path}"). ${e?.message || ""}`,
            );
          }),
        ),
      );
    } catch (e) {
      console.error("[split-editor] image load failed:", e);
      throw e;
    }

    if (this.#images.length === 0 || !this.#images[0]) {
      throw new Error("No frames loaded");
    }
    this.#width = this.#images[0].naturalWidth;
    if (this.#width === 0) {
      throw new Error("Frame 1 decoded with 0 width — the captured image is corrupt");
    }
    for (const img of this.#images) {
      if (img.naturalWidth !== this.#width) {
        console.warn("[split-editor] frames have inconsistent widths — using frame 0's width");
        break;
      }
    }

    this.#heights = this.#images.map((img) => img.naturalHeight);
    this.#offsets = [];
    let acc = 0;
    for (const h of this.#heights) {
      this.#offsets.push(acc);
      acc += h;
    }
    this.#totalHeight = acc;

    // Initial boundaries: one at every frame joint (none for a
    // single-frame scroll capture).
    const initial: number[] = [];
    for (let i = 0; i < this.#heights.length - 1; i++) {
      initial.push(this.#offsets[i + 1]!);
    }
    this.boundaries = initial;
    this.ready = true;

    document.body.classList.add("split-editor-active");
    this.#onResize = () => this.#recomputeScale();
    window.addEventListener("resize", this.#onResize);
    await this.updateComplete;
    this.#recomputeScale();
    // Force a second update so the Lit-rendered handles pick up
    // the freshly computed scale via #displayScale.
    this.requestUpdate();
  }

  /** Pre-Lit API parity: `editor.unmount()` still works.
   *  Internally just `this.remove()`; cleanup happens in
   *  `disconnectedCallback`. */
  unmount(): void {
    this.remove();
  }

  override disconnectedCallback(): void {
    if (this.#onResize) {
      window.removeEventListener("resize", this.#onResize);
      this.#onResize = null;
    }
    this.#detachDragListeners();
    document.body.classList.remove("split-editor-active");
    super.disconnectedCallback();
  }

  override render() {
    if (!this.ready) {
      // The shell is rendered eagerly so manual styling / tests can
      // assert presence; the body waits for `mount()` to seed state.
      return html`<div class="split-editor" role="dialog" aria-modal="true" aria-label="Split editor"></div>`;
    }
    const outCount = this.boundaries.length + 1;
    const countText = `${this.boundaries.length} split${this.boundaries.length === 1 ? "" : "s"} · ${outCount} image${outCount === 1 ? "" : "s"}`;
    const stackWidth = this.#width * this.#displayScale;
    const stackHeight = this.#totalHeight * this.#displayScale;
    const sortedBoundaries = [...this.boundaries].sort((a, b) => a - b);

    return html`
      <div class="split-editor" role="dialog" aria-modal="true" aria-label="Split editor">
        <div class="split-editor-header">
          <div class="split-editor-title-row">
            <div class="split-editor-title">Split editor</div>
            <div class="split-editor-count">${countText}</div>
          </div>
          <div class="split-editor-hint">
            Drag a line to move. Click empty space to add. Shift-click or right-click a line to
            remove. Annotations will be discarded when you apply.
          </div>
          <div class="split-editor-actions">
            <button
              type="button"
              class="split-editor-btn split-editor-cancel"
              @click=${this.#onCancelClick}
            >
              Cancel
            </button>
            <button
              type="button"
              class="split-editor-btn split-editor-apply"
              ?disabled=${this.applying}
              @click=${this.#onApplyClick}
            >
              ${this.applying ? "Applying…" : "Apply"}
            </button>
          </div>
        </div>
        <div class="split-editor-scroll" @scroll=${() => this.requestUpdate()}>
          <div
            class="split-editor-stack"
            style=${`position:relative;width:${stackWidth}px;height:${stackHeight}px;`}
            @click=${this.#onStackClick}
          >
            ${this.#images.map(
              (img) =>
                html`<img class="split-editor-frame" .src=${img.src} draggable="false" />`,
            )}
            <div
              class="split-editor-handles"
              style="position:absolute;inset:0;pointer-events:none;"
            >
              ${this.boundaries.map((value) => this.#renderHandle(value, sortedBoundaries))}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  #renderHandle(value: number, sortedBoundaries: number[]) {
    const top = value * this.#displayScale;
    const idx = sortedBoundaries.indexOf(value);
    const prev = idx > 0 ? sortedBoundaries[idx - 1]! : 0;
    const next = idx < sortedBoundaries.length - 1 ? sortedBoundaries[idx + 1]! : this.#totalHeight;
    const heightAbove = value - prev;
    const heightBelow = next - value;
    const aboveLabel = `Page ${idx + 1} · ${this.#width}×${Math.round(heightAbove)}`;
    const belowLabel = `Page ${idx + 2} · ${this.#width}×${Math.round(heightBelow)}`;
    return html`
      <div
        class="split-editor-handle"
        role="slider"
        aria-label=${`Page break at ${Math.round(value)} px`}
        data-value=${String(value)}
        tabindex="0"
        style=${`pointer-events:auto;top:${top}px;`}
        @mousedown=${(e: MouseEvent) => this.#onHandleMouseDown(e, value)}
        @contextmenu=${(e: Event) => this.#onHandleContextMenu(e, value)}
        @keydown=${(e: KeyboardEvent) => this.#onHandleKeydown(e, value)}
      >
        <div class="split-editor-handle-bar"></div>
        <div class="split-editor-handle-size split-editor-handle-size-above">${aboveLabel}</div>
        <div class="split-editor-handle-size split-editor-handle-size-below">${belowLabel}</div>
        <button
          type="button"
          class="split-editor-handle-remove"
          aria-label="Remove this split"
          data-tooltip="Remove split"
          @click=${(e: Event) => this.#onHandleRemoveClick(e, value)}
        >
          ×
        </button>
      </div>
    `;
  }

  #recomputeScale(): void {
    const scrollEl = this.querySelector<HTMLElement>(".split-editor-scroll");
    if (!scrollEl) return;
    const viewportWidth = scrollEl.clientWidth - 48; // leave padding room
    if (viewportWidth <= 0 || this.#width <= 0) return;
    const next = Math.min(1, viewportWidth / this.#width);
    if (next !== this.#displayScale) {
      this.#displayScale = next;
      this.requestUpdate();
    }
  }

  #onCancelClick = (): void => {
    this.onCancel?.();
  };

  #onApplyClick = (): void => {
    void this.#applyAndNotify();
  };

  #onStackClick = (e: MouseEvent): void => {
    if (this.#dragging) return;
    const t = e.target as HTMLElement;
    if (t.closest(".split-editor-handle")) return;
    const stack = this.querySelector<HTMLElement>(".split-editor-stack");
    if (!stack) return;
    const rect = stack.getBoundingClientRect();
    const localY = e.clientY - rect.top;
    const naturalY = localY / this.#displayScale;
    this.#addBoundary(naturalY);
  };

  #onHandleRemoveClick = (e: Event, value: number): void => {
    e.stopPropagation();
    this.#removeBoundary(value);
  };

  #onHandleContextMenu = (e: Event, value: number): void => {
    e.preventDefault();
    this.#removeBoundary(value);
  };

  #onHandleKeydown = (e: KeyboardEvent, value: number): void => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      this.#moveBoundary(value, value - step);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      this.#moveBoundary(value, value + step);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      this.#removeBoundary(value);
    }
  };

  #onHandleMouseDown = (e: MouseEvent, value: number): void => {
    if (e.button !== 0) return;
    if (e.shiftKey) {
      e.preventDefault();
      this.#removeBoundary(value);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.#beginDrag(e.currentTarget as HTMLElement, e, value);
  };

  // ---- Mutation ----

  #addBoundary(desiredY: number): void {
    const clamped = this.#clampForNewBoundary(desiredY);
    if (clamped == null) return;
    this.boundaries = [...this.boundaries, clamped].sort((a, b) => a - b);
  }

  #removeBoundary(value: number): void {
    const idx = this.boundaries.indexOf(value);
    if (idx < 0) return;
    const next = [...this.boundaries];
    next.splice(idx, 1);
    this.boundaries = next;
  }

  #moveBoundary(oldValue: number, desiredY: number): number | null {
    const sorted = [...this.boundaries].sort((a, b) => a - b);
    const idx = sorted.indexOf(oldValue);
    if (idx < 0) return null;
    const prev = idx > 0 ? sorted[idx - 1]! : 0;
    const next = idx < sorted.length - 1 ? sorted[idx + 1]! : this.#totalHeight;
    const min = prev + MIN_SLICE_PX;
    const max = next - MIN_SLICE_PX;
    const clamped = Math.round(Math.max(min, Math.min(max, desiredY)));
    if (clamped === oldValue) return clamped;
    sorted[idx] = clamped;
    this.boundaries = sorted;
    return clamped;
  }

  #clampForNewBoundary(desiredY: number): number | null {
    const rounded = Math.round(desiredY);
    const sorted = [...this.boundaries].sort((a, b) => a - b);
    let prev = 0;
    let next = this.#totalHeight;
    for (const b of sorted) {
      if (b < rounded) prev = b;
      else {
        next = b;
        break;
      }
    }
    const min = prev + MIN_SLICE_PX;
    const max = next - MIN_SLICE_PX;
    if (max < min) return null;
    if (sorted.some((b) => Math.abs(b - rounded) < 1)) return null;
    return Math.round(Math.max(min, Math.min(max, rounded)));
  }

  // ---- Drag ----

  #beginDrag(handle: HTMLElement, downEvent: MouseEvent, boundaryValue: number): void {
    const rect = handle.getBoundingClientRect();
    const offsetWithinHandle = downEvent.clientY - rect.top;
    this.#dragging = {
      boundaryValue,
      handleEl: handle,
      offsetWithinHandle,
      startClientY: downEvent.clientY,
      moved: false,
    };

    this.#onMouseMove = (e: MouseEvent) => {
      if (!this.#dragging) return;
      const stack = this.querySelector<HTMLElement>(".split-editor-stack");
      if (!stack) return;
      if (Math.abs(e.clientY - this.#dragging.startClientY) > CLICK_TOLERANCE_PX) {
        this.#dragging.moved = true;
      }
      const stackRect = stack.getBoundingClientRect();
      const localY =
        e.clientY -
        stackRect.top -
        this.#dragging.offsetWithinHandle +
        this.#dragging.handleEl.offsetHeight / 2;
      const naturalY = localY / this.#displayScale;
      const newVal = this.#moveBoundary(this.#dragging.boundaryValue, naturalY);
      if (newVal != null) this.#dragging.boundaryValue = newVal;
    };
    this.#onMouseUp = () => this.#endDrag();

    document.addEventListener("mousemove", this.#onMouseMove);
    document.addEventListener("mouseup", this.#onMouseUp);
    handle.classList.add("dragging");
  }

  #endDrag(): void {
    this.#dragging?.handleEl.classList.remove("dragging");
    this.#dragging = null;
    this.#detachDragListeners();
  }

  #detachDragListeners(): void {
    if (this.#onMouseMove) document.removeEventListener("mousemove", this.#onMouseMove);
    if (this.#onMouseUp) document.removeEventListener("mouseup", this.#onMouseUp);
    this.#onMouseMove = null;
    this.#onMouseUp = null;
  }

  // ---- Apply ----

  async #applyAndNotify(): Promise<void> {
    if (!this.onApply) return;
    this.applying = true;
    try {
      const slices = this.#computeSlices();
      await this.onApply(slices);
    } catch (e) {
      console.error("[split-editor] apply failed:", e);
      this.applying = false;
    }
  }

  #computeSlices(): SplitEditorSlice[] {
    const boundaries = [...this.boundaries].sort((a, b) => a - b);
    const newTops = [0, ...boundaries];
    const newBots = [...boundaries, this.#totalHeight];
    const slices: SplitEditorSlice[] = [];

    for (let i = 0; i < newTops.length; i++) {
      const newTop = newTops[i]!;
      const newBot = newBots[i]!;
      const sliceHeight = newBot - newTop;
      if (sliceHeight <= 0) continue;

      const canvas = document.createElement("canvas");
      canvas.width = this.#width;
      canvas.height = sliceHeight;
      // happy-dom (used by unit tests) may return null for 2d
      // contexts; production browsers never do. Skip the draw step
      // gracefully so tests can verify the slice plan flows to
      // onApply without depending on canvas rasterisation.
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        for (let j = 0; j < this.records.length; j++) {
          const frameTop = this.#offsets[j]!;
          const frameBot = frameTop + this.#heights[j]!;
          const overlapStart = Math.max(newTop, frameTop);
          const overlapEnd = Math.min(newBot, frameBot);
          if (overlapEnd <= overlapStart) continue;
          const srcY = overlapStart - frameTop;
          const dstY = overlapStart - newTop;
          const h = overlapEnd - overlapStart;
          ctx.drawImage(this.#images[j]!, 0, srcY, this.#width, h, 0, dstY, this.#width, h);
        }
      }

      slices.push({
        dataUrl: canvas.toDataURL("image/png"),
        width: this.#width,
        height: sliceHeight,
      });
    }

    return slices;
  }

  // ---- Test hooks ----

  /** Test-only: read the natural total height computed by `mount()`.
   *  Real consumers don't need this. */
  _testTotalHeight(): number {
    return this.#totalHeight;
  }

  /** Test-only: feed pre-loaded images into the element without
   *  going through the data-URL decode path (lets unit tests hit
   *  the boundary-mutation logic without spinning up `<img>` decode). */
  _testSeed(opts: { width: number; heights: number[] }): void {
    const { width, heights } = opts;
    this.#width = width;
    this.#heights = heights;
    this.#offsets = [];
    let acc = 0;
    for (const h of heights) {
      this.#offsets.push(acc);
      acc += h;
    }
    this.#totalHeight = acc;
    this.#images = heights.map((h) => {
      const img = new Image();
      img.width = width;
      img.height = h;
      return img;
    });
    const initial: number[] = [];
    for (let i = 0; i < heights.length - 1; i++) {
      initial.push(this.#offsets[i + 1]!);
    }
    this.boundaries = initial;
    this.ready = true;
  }

  /** Test-only: read the current slice plan without touching canvas. */
  _testComputeSliceHeights(): number[] {
    const boundaries = [...this.boundaries].sort((a, b) => a - b);
    const newTops = [0, ...boundaries];
    const newBots = [...boundaries, this.#totalHeight];
    return newTops.map((top, i) => newBots[i]! - top);
  }
}

if (!customElements.get("annot-split-editor")) {
  customElements.define("annot-split-editor", AnnotSplitEditorElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-split-editor": AnnotSplitEditorElement;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load frame image"));
    img.src = src;
  });
}
