/**
 * SplitEditor — page-break editor for Scroll Capture and perPage Capture
 * sessions.
 *
 * The session's frames are stacked vertically (perPage: N natural frames;
 * scroll: 1 tall stitched frame) into a virtual continuous page. The user
 * can:
 *   - drag an existing page-break line to move it
 *   - click in an empty region of the stack to add a new line there
 *   - shift-click or right-click a line (or press Delete while it's
 *     focused) to remove it
 *   - press Apply to re-slice all frames to the new boundaries and save
 *
 * No stitched image is persisted — reslicing is done in-memory from the
 * original frame bitmaps and every resulting slice is saved as its own
 * record (see App#applySlicesToStorage).
 */
import type { ImageRecord } from "@ingcreators/annot-core/storage";
import { setTooltip } from "@ingcreators/annot-core/utils";

export interface SplitEditorSlice {
  /** Base64 data URL (JPEG) for the re-sliced frame. */
  dataUrl: string;
  width: number;
  height: number;
}

export interface SplitEditorCallbacks {
  /** User pressed Apply. Host should update storage with the new slices. */
  onApply: (slices: SplitEditorSlice[]) => Promise<void> | void;
  /** User pressed Cancel. Host should restore the previous view. */
  onCancel: () => void;
}

const MIN_SLICE_PX = 40; // smallest allowed slice height in natural pixels
const CLICK_TOLERANCE_PX = 3; // mouse movement under this = click (not drag)

export class SplitEditor {
  #records: ImageRecord[];
  #callbacks: SplitEditorCallbacks;

  #root: HTMLElement | null = null;
  #stackEl: HTMLElement | null = null;
  #handlesEl: HTMLElement | null = null;
  #scrollEl: HTMLElement | null = null;
  #countEl: HTMLElement | null = null;

  #images: HTMLImageElement[] = [];
  #heights: number[] = []; // natural heights of the original frames
  #offsets: number[] = []; // natural Y of each frame's top in the stack
  #totalHeight = 0; // sum of natural heights
  #width = 0; // natural frame width (all frames share this)
  #boundaries: number[] = []; // sorted natural Y of each split
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

  constructor(records: ImageRecord[], callbacks: SplitEditorCallbacks) {
    if (records.length === 0) throw new Error("SplitEditor requires at least 1 frame");
    this.#records = records;
    this.#callbacks = callbacks;
  }

  async mount(): Promise<void> {
    // Validate every record has image data — empty / malformed data URLs
    // are the most common reason loadImage fails silently further down.
    for (let i = 0; i < this.#records.length; i++) {
      const r = this.#records[i]!;
      if (!r.originalDataUrl?.startsWith("data:")) {
        throw new Error(
          `Frame ${i + 1}/${this.#records.length} has no image data (path="${r.path}"). The session may not have fully transferred yet — try reloading.`,
        );
      }
    }

    try {
      this.#images = await Promise.all(
        this.#records.map((r, i) =>
          loadImage(r.originalDataUrl).catch((e) => {
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

    // Initial boundaries: one at every frame joint (none for a single-frame
    // scroll capture).
    this.#boundaries = [];
    for (let i = 0; i < this.#heights.length - 1; i++) {
      this.#boundaries.push(this.#offsets[i + 1]!);
    }

    this.#buildDom();
    document.body.classList.add("split-editor-active");
    this.#onResize = () => this.#recomputeScale();
    window.addEventListener("resize", this.#onResize);
    this.#recomputeScale();
    this.#renderHandles();
    this.#updateCount();
  }

  unmount(): void {
    if (this.#onResize) window.removeEventListener("resize", this.#onResize);
    this.#detachDragListeners();
    this.#root?.remove();
    this.#root = null;
    this.#stackEl = null;
    this.#handlesEl = null;
    this.#scrollEl = null;
    this.#countEl = null;
    document.body.classList.remove("split-editor-active");
  }

  // ---- DOM ----

  #buildDom(): void {
    const root = document.createElement("div");
    root.className = "split-editor";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Split editor");

    // ---- Header ----
    const header = document.createElement("div");
    header.className = "split-editor-header";

    const titleRow = document.createElement("div");
    titleRow.className = "split-editor-title-row";

    const title = document.createElement("div");
    title.className = "split-editor-title";
    title.textContent = "Split editor";
    titleRow.appendChild(title);

    const count = document.createElement("div");
    count.className = "split-editor-count";
    titleRow.appendChild(count);
    this.#countEl = count;

    header.appendChild(titleRow);

    const hint = document.createElement("div");
    hint.className = "split-editor-hint";
    hint.textContent =
      "Drag a line to move. Click empty space to add. Shift-click or right-click a line to remove. Annotations will be discarded when you apply.";
    header.appendChild(hint);

    const actions = document.createElement("div");
    actions.className = "split-editor-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "split-editor-btn split-editor-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => this.#callbacks.onCancel());
    actions.appendChild(cancelBtn);

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "split-editor-btn split-editor-apply";
    applyBtn.textContent = "Apply";
    applyBtn.addEventListener("click", () => void this.#applyAndNotify(applyBtn));
    actions.appendChild(applyBtn);

    header.appendChild(actions);
    root.appendChild(header);

    // ---- Body: scrollable stacked frames with handles overlay ----
    const scroll = document.createElement("div");
    scroll.className = "split-editor-scroll";

    const stack = document.createElement("div");
    stack.className = "split-editor-stack";
    stack.style.position = "relative";

    for (const img of this.#images) {
      const el = document.createElement("img");
      el.src = img.src;
      el.draggable = false;
      el.className = "split-editor-frame";
      stack.appendChild(el);
    }

    const handlesEl = document.createElement("div");
    handlesEl.className = "split-editor-handles";
    handlesEl.style.position = "absolute";
    handlesEl.style.inset = "0";
    handlesEl.style.pointerEvents = "none";
    stack.appendChild(handlesEl);

    // Click on empty stack area → add a split at that y position
    stack.addEventListener("click", (e) => {
      // Ignore clicks that landed on a handle (they stop propagation), or
      // on buttons.
      if (this.#dragging) return;
      const t = e.target as HTMLElement;
      if (t.closest(".split-editor-handle")) return;
      const rect = stack.getBoundingClientRect();
      const localY = e.clientY - rect.top;
      const naturalY = localY / this.#displayScale;
      this.#addBoundary(naturalY);
    });

    scroll.appendChild(stack);
    root.appendChild(scroll);

    document.body.appendChild(root);
    this.#root = root;
    this.#scrollEl = scroll;
    this.#stackEl = stack;
    this.#handlesEl = handlesEl;
  }

  #updateCount(): void {
    if (!this.#countEl) return;
    const outCount = this.#boundaries.length + 1;
    this.#countEl.textContent = `${this.#boundaries.length} split${this.#boundaries.length === 1 ? "" : "s"} · ${outCount} image${outCount === 1 ? "" : "s"}`;
  }

  // ---- Handle rendering ----

  #renderHandles(): void {
    if (!this.#handlesEl) return;
    this.#handlesEl.innerHTML = "";
    for (let i = 0; i < this.#boundaries.length; i++) {
      this.#handlesEl.appendChild(this.#buildHandle(this.#boundaries[i]!));
    }
    this.#updateAllHandleSizeLabels();
  }

  #buildHandle(value: number): HTMLElement {
    const handle = document.createElement("div");
    handle.className = "split-editor-handle";
    handle.setAttribute("role", "slider");
    handle.setAttribute("aria-label", `Page break at ${Math.round(value)} px`);
    handle.setAttribute("data-value", String(value));
    handle.style.pointerEvents = "auto";
    handle.style.top = `${value * this.#displayScale}px`;
    handle.tabIndex = 0;

    const bar = document.createElement("div");
    bar.className = "split-editor-handle-bar";
    handle.appendChild(bar);

    // Two floating labels showing the natural-pixel size of the page
    // immediately above and immediately below this split. Updated on
    // drag / add / remove via #updateAllHandleSizeLabels().
    const above = document.createElement("div");
    above.className = "split-editor-handle-size split-editor-handle-size-above";
    handle.appendChild(above);
    const below = document.createElement("div");
    below.className = "split-editor-handle-size split-editor-handle-size-below";
    handle.appendChild(below);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "split-editor-handle-remove";
    removeBtn.setAttribute("aria-label", "Remove this split");
    setTooltip(removeBtn, "Remove split");
    removeBtn.innerHTML = "×";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.#removeBoundary(Number(handle.getAttribute("data-value")));
    });
    handle.appendChild(removeBtn);

    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      // Shift+click deletes instead of dragging
      if (e.shiftKey) {
        e.preventDefault();
        this.#removeBoundary(Number(handle.getAttribute("data-value")));
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.#beginDrag(handle, e);
    });
    handle.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.#removeBoundary(Number(handle.getAttribute("data-value")));
    });
    handle.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 10 : 1;
      const current = Number(handle.getAttribute("data-value"));
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.#moveBoundary(current, current - step);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        this.#moveBoundary(current, current + step);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        this.#removeBoundary(current);
      }
    });

    return handle;
  }

  #recomputeScale(): void {
    if (!this.#scrollEl || !this.#stackEl) return;
    const viewportWidth = this.#scrollEl.clientWidth - 48; // leave padding room
    if (viewportWidth <= 0 || this.#width <= 0) return;
    this.#displayScale = Math.min(1, viewportWidth / this.#width);
    this.#stackEl.style.width = `${this.#width * this.#displayScale}px`;
    this.#stackEl.style.height = `${this.#totalHeight * this.#displayScale}px`;
    // Re-position existing handles to match the new scale.
    if (this.#handlesEl) {
      this.#handlesEl.querySelectorAll<HTMLElement>(".split-editor-handle").forEach((el) => {
        const value = Number(el.getAttribute("data-value"));
        el.style.top = `${value * this.#displayScale}px`;
      });
    }
  }

  // ---- Mutation ----

  #addBoundary(desiredY: number): void {
    const clamped = this.#clampForNewBoundary(desiredY);
    if (clamped == null) return;
    this.#boundaries.push(clamped);
    this.#boundaries.sort((a, b) => a - b);
    this.#renderHandles();
    this.#updateCount();
  }

  #removeBoundary(value: number): void {
    const idx = this.#boundaries.findIndex((v) => v === value);
    if (idx < 0) return;
    this.#boundaries.splice(idx, 1);
    this.#renderHandles();
    this.#updateCount();
  }

  /**
   * Move a boundary (identified by its current value) to a new value,
   * clamped by adjacent boundaries. Returns the new value.
   */
  #moveBoundary(oldValue: number, desiredY: number): number | null {
    const idx = this.#boundaries.findIndex((v) => v === oldValue);
    if (idx < 0) return null;
    const prev = idx > 0 ? this.#boundaries[idx - 1]! : 0;
    const next = idx < this.#boundaries.length - 1 ? this.#boundaries[idx + 1]! : this.#totalHeight;
    const min = prev + MIN_SLICE_PX;
    const max = next - MIN_SLICE_PX;
    const clamped = Math.round(Math.max(min, Math.min(max, desiredY)));
    if (clamped === oldValue) return clamped;
    this.#boundaries[idx] = clamped;

    // Update DOM handle attribute + position for the moved one
    if (this.#handlesEl) {
      const handle = this.#handlesEl.querySelector<HTMLElement>(`[data-value="${oldValue}"]`);
      if (handle) {
        handle.setAttribute("data-value", String(clamped));
        handle.setAttribute("aria-label", `Page break at ${clamped} px`);
        handle.style.top = `${clamped * this.#displayScale}px`;
      }
    }
    // Sizes of the two adjacent pages changed → refresh labels (also
    // touches the next handle if there is one, since slice i+2's height
    // didn't change but the labels at handle i and i+1 reference slices
    // that did).
    this.#updateAllHandleSizeLabels();
    return clamped;
  }

  /**
   * Refresh the "↑ N px" / "↓ N px" labels on every handle so they show
   * the current natural-pixel height of the pages immediately above and
   * below each split. Called on initial render and after every mutation.
   */
  #updateAllHandleSizeLabels(): void {
    if (!this.#handlesEl) return;
    const handles = Array.from(
      this.#handlesEl.querySelectorAll<HTMLElement>(".split-editor-handle"),
    );
    // Sort handles by their data-value so handle index === slice index
    handles.sort(
      (a, b) => Number(a.getAttribute("data-value")) - Number(b.getAttribute("data-value")),
    );
    const sortedBoundaries = [...this.#boundaries].sort((a, b) => a - b);
    const totalPages = sortedBoundaries.length + 1;
    for (let i = 0; i < handles.length; i++) {
      const handle = handles[i]!;
      const top = i === 0 ? 0 : sortedBoundaries[i - 1]!;
      const bot = sortedBoundaries[i]!;
      const next = i < sortedBoundaries.length - 1 ? sortedBoundaries[i + 1]! : this.#totalHeight;
      const heightAbove = bot - top;
      const heightBelow = next - bot;
      const above = handle.querySelector<HTMLElement>(".split-editor-handle-size-above");
      const below = handle.querySelector<HTMLElement>(".split-editor-handle-size-below");
      if (above) above.textContent = `Page ${i + 1} · ${this.#width}×${Math.round(heightAbove)}`;
      if (below) below.textContent = `Page ${i + 2} · ${this.#width}×${Math.round(heightBelow)}`;
      void totalPages;
    }
  }

  /**
   * For a new boundary at `desiredY`, clamp it to a valid spot and return
   * the final value. Returns null if there's no room (adjacent boundaries
   * too close).
   */
  #clampForNewBoundary(desiredY: number): number | null {
    // Find insertion position among existing boundaries
    const rounded = Math.round(desiredY);
    const sorted = [...this.#boundaries].sort((a, b) => a - b);
    // Find the "window" [prev, next] the new boundary falls into.
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
    if (max < min) return null; // no room
    // Reject duplicate exact values within 1px to avoid jitter.
    if (sorted.some((b) => Math.abs(b - rounded) < 1)) return null;
    return Math.round(Math.max(min, Math.min(max, rounded)));
  }

  // ---- Drag ----

  #beginDrag(handle: HTMLElement, downEvent: MouseEvent): void {
    const rect = handle.getBoundingClientRect();
    const offsetWithinHandle = downEvent.clientY - rect.top;
    const boundaryValue = Number(handle.getAttribute("data-value"));
    this.#dragging = {
      boundaryValue,
      handleEl: handle,
      offsetWithinHandle,
      startClientY: downEvent.clientY,
      moved: false,
    };

    this.#onMouseMove = (e: MouseEvent) => {
      if (!this.#dragging || !this.#stackEl) return;
      if (Math.abs(e.clientY - this.#dragging.startClientY) > CLICK_TOLERANCE_PX) {
        this.#dragging.moved = true;
      }
      const stackRect = this.#stackEl.getBoundingClientRect();
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

  async #applyAndNotify(applyBtn: HTMLButtonElement): Promise<void> {
    applyBtn.disabled = true;
    applyBtn.textContent = "Applying…";
    try {
      const slices = this.#computeSlices();
      await this.#callbacks.onApply(slices);
    } catch (e) {
      console.error("[split-editor] apply failed:", e);
      applyBtn.disabled = false;
      applyBtn.textContent = "Apply";
    }
  }

  /**
   * Compose each new slice by drawing the overlapping regions of the
   * original frames onto a fresh canvas. Boundaries are sorted so the
   * slices come out in top-to-bottom order.
   */
  #computeSlices(): SplitEditorSlice[] {
    const boundaries = [...this.#boundaries].sort((a, b) => a - b);
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
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;

      for (let j = 0; j < this.#records.length; j++) {
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

      // Emit lossless PNG; app.ts re-encodes each slice via the shared
      // encoder which applies the user's format preference (PNG-8 smart
      // fallback / PNG / JPEG).
      slices.push({
        dataUrl: canvas.toDataURL("image/png"),
        width: this.#width,
        height: sliceHeight,
      });
    }

    return slices;
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
