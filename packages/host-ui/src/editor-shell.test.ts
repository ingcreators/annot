// @vitest-environment happy-dom
//
// Phase 3 implementation tests for `@ingcreators/annot-host-ui`.
// happy-dom supplies the DOM + customElements registry the shell's
// internal CanvasManager / SelectionManager / History need to wire
// up listeners on a real `<svg>`.
//
// What this asserts:
//
//   1. Constructing the shell against a happy-dom container succeeds.
//   2. `open(path)` reads the image record from the host's
//      StorageProvider, mounts an `<svg>` inside the container,
//      and exposes the canvas / history / selection primitives.
//   3. `saveNow()` writes the serialized SVG back via
//      `storage.updateImage(path, { annotationsSvg, updatedAt })`.
//   4. The event bus delivers `dirty` / `saved` / `selection-change`
//      / `error` to subscribers and the disposers unsubscribe.
//   5. `destroy()` removes the shell's `<svg>` from the container
//      and renders subsequent calls to `open()` a no-op.
//   6. Tear-down on `error` keeps the shell usable for `destroy()`.

import { describe, expect, it, vi } from "vitest";
import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import { EditorShell, type EditorShellHost } from "./index.js";

const PNG_PIXEL =
  "data:image/png;base64," +
  // 1x1 transparent PNG
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function makeRecord(overrides: Partial<ImageRecord> = {}): ImageRecord {
  const now = new Date("2026-05-04T00:00:00Z").toISOString();
  return {
    path: "/test.annot.svg",
    folderPath: "/",
    width: 1,
    height: 1,
    originalDataUrl: PNG_PIXEL,
    annotationsSvg: "",
    sourceUrl: "",
    tags: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ImageRecord;
}

function makeStorage(record: ImageRecord | undefined = makeRecord()) {
  // Minimal subset of `StorageProvider` the shell touches in this
  // test. The cast through `unknown` keeps TypeScript happy without
  // forcing every consumer-facing method to exist.
  const updateImage = vi.fn(async () => {});
  const storage = {
    getImage: vi.fn(async () => record),
    updateImage,
  } as unknown as StorageProvider;
  return { storage, updateImage };
}

function makeContainer(): HTMLElement {
  const c = document.createElement("div");
  document.body.appendChild(c);
  return c;
}

describe("EditorShell — Phase 3 implementation", () => {
  it("opens an image and exposes canvas / history / selection", async () => {
    const container = makeContainer();
    const { storage } = makeStorage();
    const shell = new EditorShell({ container, storage });

    await shell.open("/test.annot.svg");
    expect(shell.getCanvas()).not.toBeNull();
    expect(shell.getHistory()).not.toBeNull();
    expect(shell.getSelection()).not.toBeNull();
    expect(container.querySelector("svg[data-annot-shell-root]")).not.toBeNull();
    shell.destroy();
  });

  it("rejects + emits error when the image is missing", async () => {
    const container = makeContainer();
    const storage = {
      getImage: vi.fn(async () => undefined),
      updateImage: vi.fn(async () => {}),
    } as unknown as StorageProvider;
    const shell = new EditorShell({ container, storage });
    const errorHandler = vi.fn();
    shell.on("error", errorHandler);

    await expect(shell.open("/missing.annot.svg")).rejects.toThrow(/no image at path/);
    expect(errorHandler).toHaveBeenCalledTimes(1);
    shell.destroy();
  });

  it("saveNow writes serialized SVG back via updateImage", async () => {
    const container = makeContainer();
    const { storage, updateImage } = makeStorage();
    const shell = new EditorShell({ container, storage });
    const savedHandler = vi.fn();
    shell.on("saved", savedHandler);

    await shell.open("/test.annot.svg");
    await shell.saveNow();

    expect(updateImage).toHaveBeenCalledTimes(1);
    const call = updateImage.mock.calls[0] as unknown as [string, { annotationsSvg: string }];
    expect(call[0]).toBe("/test.annot.svg");
    expect(call[1].annotationsSvg).toContain("<svg");
    expect(savedHandler).toHaveBeenCalledWith("/test.annot.svg");
    shell.destroy();
  });

  it("saveNow no-ops when no image is open", async () => {
    const container = makeContainer();
    const { storage, updateImage } = makeStorage();
    const shell = new EditorShell({ container, storage });
    await shell.saveNow();
    expect(updateImage).not.toHaveBeenCalled();
    shell.destroy();
  });

  it("event subscription + disposer", async () => {
    const container = makeContainer();
    const { storage } = makeStorage();
    const shell = new EditorShell({ container, storage });
    const handler = vi.fn();
    const dispose = shell.on("dirty", handler);

    await shell.open("/test.annot.svg");
    // Trigger a dirty by saving the history (snapshot increment)
    shell.getHistory()?.save();
    expect(handler).toHaveBeenCalledTimes(1);

    dispose();
    shell.getHistory()?.save();
    expect(handler).toHaveBeenCalledTimes(1);
    shell.destroy();
  });

  it("setPageMetadata + getCurrentPageMetadata round-trip", () => {
    const container = makeContainer();
    const { storage } = makeStorage();
    const shell = new EditorShell({ container, storage });
    expect(shell.getCurrentPageMetadata()).toBeNull();
    shell.setPageMetadata({ elements: [] } as unknown as Parameters<typeof shell.setPageMetadata>[0]);
    expect(shell.getCurrentPageMetadata()).toEqual({ elements: [] });
    shell.setPageMetadata(null);
    expect(shell.getCurrentPageMetadata()).toBeNull();
    shell.destroy();
  });

  it("destroy removes the shell's <svg> and disables open()", async () => {
    const container = makeContainer();
    const { storage } = makeStorage();
    const shell = new EditorShell({ container, storage });
    await shell.open("/test.annot.svg");
    expect(container.querySelector("svg[data-annot-shell-root]")).not.toBeNull();
    shell.destroy();
    expect(container.querySelector("svg[data-annot-shell-root]")).toBeNull();
    await expect(shell.open("/test.annot.svg")).rejects.toThrow(/already destroyed/);
  });

  it("themeOverrides are applied as CSS custom properties", () => {
    const container = makeContainer();
    const { storage } = makeStorage();
    new EditorShell({
      container,
      storage,
      themeOverrides: { "--annot-accent": "#ff00aa" },
    });
    expect(container.style.getPropertyValue("--annot-accent")).toBe("#ff00aa");
  });

  // Phase 3 of `docs/plans/editor-session-shell-switchover.md` —
  // `mountFromRecord` now restores the persisted annotation tree
  // when the record carries `annotationsSvg`, instead of the host
  // having to call `restoreAnnotations` itself. Verifies the
  // annotation children land on `canvas.annotations` AND that the
  // seed `history.save()` runs before `history.onStateChange` is
  // wired (so opening an annotated file does NOT immediately fire
  // a `dirty` event that would commit a no-op autosave).
  it("mountFromRecord restores annotationsSvg without firing dirty", async () => {
    const container = makeContainer();
    const annotationsSvg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1">
  <g id="annotations">
    <rect data-test="restored" x="10" y="10" width="50" height="50" fill="red"/>
    <circle data-test="restored" cx="80" cy="80" r="20" fill="blue"/>
  </g>
</svg>`;
    const { storage } = makeStorage(makeRecord({ annotationsSvg }));
    const shell = new EditorShell({ container, storage });
    const dirtyHandler = vi.fn();
    shell.on("dirty", dirtyHandler);

    await shell.open("/test.annot.svg");

    const canvas = shell.getCanvas();
    expect(canvas).not.toBeNull();
    const restored = canvas?.annotations.querySelectorAll('[data-test="restored"]');
    expect(restored?.length).toBe(2);

    // The seed history.save() ran before history.onStateChange was
    // wired. No dirty event reaches the host on open.
    expect(dirtyHandler).not.toHaveBeenCalled();

    shell.destroy();
  });

  // Phase 2 of `docs/plans/editor-session-shell-switchover.md` —
  // the host can pre-supply an `<svg>` and the shell adopts it
  // instead of creating an anonymous one. The PWA's index.html
  // ships `<svg id="svg-root">` so first-render CSS hits the
  // styled element before JS boots; this knob lets the shell
  // mount into that element while preserving its id-based
  // selectors.
  describe("svgRoot host knob", () => {
    function makeSvgRoot(): SVGSVGElement {
      const svg = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      ) as SVGSVGElement;
      svg.id = "svg-root";
      return svg;
    }

    it("adopts a host-supplied SVG, tags it, and leaves it in place on destroy", async () => {
      const container = makeContainer();
      const supplied = makeSvgRoot();
      // Host owns the placement: SVG sits next to (or inside) the
      // container in the host's layout. The shell must not move it.
      container.appendChild(supplied);
      const { storage } = makeStorage();
      const shell = new EditorShell({ container, storage, svgRoot: supplied });

      await shell.open("/test.annot.svg");

      // Shell mounted the canvas inside the supplied SVG, not a
      // new anonymous root.
      expect(shell.getCanvas()?.svg).toBe(supplied);
      // Tagged for the attribute-keyed CSS rule, while keeping its
      // existing id (so legacy `#svg-root` rules still match).
      expect(supplied.dataset.annotShellRoot).toBe("1");
      expect(supplied.id).toBe("svg-root");
      // No second SVG created — the count stays at 1.
      expect(container.querySelectorAll("svg").length).toBe(1);

      shell.destroy();

      // The shell removed listeners + cleared children, but did
      // NOT remove the host-owned SVG from the DOM.
      expect(supplied.parentElement).toBe(container);
      expect(supplied.children.length).toBe(0);
    });

    it("clears the supplied SVG between reopens — no orphan listeners", async () => {
      const container = makeContainer();
      const supplied = makeSvgRoot();
      container.appendChild(supplied);
      const { storage } = makeStorage();
      const shell = new EditorShell({ container, storage, svgRoot: supplied });

      await shell.open("/test.annot.svg");
      const firstCanvas = shell.getCanvas();
      const firstSelection = shell.getSelection();
      const firstChildCount = supplied.children.length;
      expect(firstCanvas).not.toBeNull();
      expect(firstSelection).not.toBeNull();
      expect(firstChildCount).toBeGreaterThan(0);

      // Re-open the same image — same shell, same supplied SVG.
      // The shell must dispose the previous CanvasManager /
      // SelectionManager (matching `disposePreviousEditor` from
      // the legacy PWA boot path) and reuse the SVG element with
      // a fresh set of listeners.
      await shell.open("/test.annot.svg");
      const secondCanvas = shell.getCanvas();
      const secondSelection = shell.getSelection();
      expect(secondCanvas).not.toBe(firstCanvas);
      expect(secondSelection).not.toBe(firstSelection);
      expect(secondCanvas?.svg).toBe(supplied);
      // Still exactly one SVG inside the container.
      expect(container.querySelectorAll("svg").length).toBe(1);

      shell.destroy();
      expect(supplied.parentElement).toBe(container);
    });

    it("falls back to an anonymous SVG when svgRoot is omitted (legacy behaviour)", async () => {
      const container = makeContainer();
      const { storage } = makeStorage();
      const shell = new EditorShell({ container, storage });

      await shell.open("/test.annot.svg");
      const created = container.querySelector("svg[data-annot-shell-root]");
      expect(created).not.toBeNull();
      expect(created?.id).toBe("");

      shell.destroy();
      // Anonymous SVG goes away on destroy.
      expect(container.querySelector("svg[data-annot-shell-root]")).toBeNull();
    });
  });

  // Phase 2 of `docs/plans/_done/redact-burn-into-image.md` — the host-
  // orchestration half of the privacy-driven "make redaction
  // permanent" action. Phase 1 added the Tier C-render helper
  // (`burnRedactionsIntoBitmap`); this phase wires the shell so a
  // host call to `applyAllRedactions()` snapshots the redact
  // element list, drives the renderer, and swaps the resulting
  // bytes into the live canvas + the in-memory `ImageRecord`.
  //
  // happy-dom's `<canvas>` doesn't actually rasterise — we stub
  // `HTMLCanvasElement.prototype.getContext` + `.toBlob` and the
  // `HTMLImageElement` `src` setter so the orchestration code path
  // resolves without hitting a real raster pipeline. The pixel-
  // level burn fidelity is exercised in Phase 4 (rotation parity
  // test) and in the manual smoke check at the end of Phase 3.
  describe("applyAllRedactions — Phase 2", () => {
    interface CanvasStubBag {
      blob: Blob;
      drawImageCalls: Array<{ src: string; x: number; y: number }>;
      restore: () => void;
    }

    function stubCanvasAndImage(): CanvasStubBag {
      const blob = new Blob(["mock-burned-png"], { type: "image/png" });
      const drawImageCalls: Array<{ src: string; x: number; y: number }> = [];
      const ctxStub = {
        drawImage: (img: CanvasImageSource, x: number, y: number) => {
          const src = (img as HTMLImageElement).src ?? "";
          drawImageCalls.push({ src, x, y });
        },
        fillRect: () => {},
        save: () => {},
        restore: () => {},
        fillStyle: "" as string,
      };
      const canvasProto = HTMLCanvasElement.prototype as unknown as {
        getContext: (kind: string) => unknown;
        toBlob: (cb: (b: Blob | null) => void, type?: string) => void;
      };
      const origGetContext = canvasProto.getContext;
      const origToBlob = canvasProto.toBlob;
      canvasProto.getContext = () => ctxStub;
      canvasProto.toBlob = (cb) => {
        queueMicrotask(() => cb(blob));
      };

      // HTMLImageElement.src setter: fire onload after the next
      // microtask so the helper's `await loadImage(...)` resolves
      // without needing real network / data-URL decoding. Set
      // synthetic naturalWidth / naturalHeight so the renderer's
      // dimension check passes (it rejects 0×0 bases).
      const imgProto = HTMLImageElement.prototype;
      const origSrcDescriptor = Object.getOwnPropertyDescriptor(imgProto, "src");
      Object.defineProperty(imgProto, "src", {
        configurable: true,
        set(this: HTMLImageElement & { _src?: string }, value: string) {
          this._src = value;
          // Force the natural dimensions to be non-zero so the
          // renderer accepts the base image.
          Object.defineProperty(this, "naturalWidth", {
            value: 100,
            configurable: true,
          });
          Object.defineProperty(this, "naturalHeight", {
            value: 100,
            configurable: true,
          });
          queueMicrotask(() => {
            this.onload?.(new Event("load"));
          });
        },
        get(this: HTMLImageElement & { _src?: string }) {
          return this._src ?? "";
        },
      });

      return {
        blob,
        drawImageCalls,
        restore: () => {
          canvasProto.getContext = origGetContext;
          canvasProto.toBlob = origToBlob;
          if (origSrcDescriptor) {
            Object.defineProperty(imgProto, "src", origSrcDescriptor);
          } else {
            delete (imgProto as unknown as { src?: string }).src;
          }
        },
      };
    }

    function recordWithSolidRedact(): ImageRecord {
      // A persisted document carrying one solid-bar redact inside
      // the `<g id="annotations">` element, the shape
      // `restoreAnnotations` rebuilds onto `canvas.annotations`.
      const annotationsSvg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1">
  <g id="annotations">
    <rect data-redact-style="solid" x="10" y="20" width="30" height="40" fill="#000000"/>
  </g>
</svg>`;
      return makeRecord({ annotationsSvg });
    }

    it("burns redactions, removes them, swaps imageEl.href, persists, and fires dirty", async () => {
      const stub = stubCanvasAndImage();
      try {
        const container = makeContainer();
        const { storage, updateImage } = makeStorage(recordWithSolidRedact());
        const shell = new EditorShell({ container, storage });
        await shell.open("/test.annot.svg");

        // Sanity: the redact element is present BEFORE the burn.
        const canvas = shell.getCanvas();
        expect(
          canvas?.annotations.querySelectorAll("[data-redact-style]").length,
        ).toBe(1);
        const hrefBefore = canvas?.imageEl.getAttribute("href");

        // Wire dirty + saved AFTER the seed history.save() the
        // `mountFromRecord` flow already ran (per the existing
        // restore-annotations-without-firing-dirty test) so we only
        // see the events the burn itself emits.
        const dirtyHandler = vi.fn();
        const savedHandler = vi.fn();
        shell.on("dirty", dirtyHandler);
        shell.on("saved", savedHandler);
        // Reset updateImage so we only see the burn's persistence
        // call (not any happen-to-fire saves from earlier setup).
        updateImage.mockClear();

        const result = await shell.applyAllRedactions();
        expect(result.count).toBe(1);

        // Redact element removed from the annotations group.
        expect(
          canvas?.annotations.querySelectorAll("[data-redact-style]").length,
        ).toBe(0);

        // Live canvas's imageEl.href swapped to the new bytes.
        const hrefAfter = canvas?.imageEl.getAttribute("href");
        expect(hrefAfter).not.toBe(hrefBefore);
        expect(hrefAfter).toMatch(/^data:image\/png/);

        // Persistence: storage.updateImage MUST be called with the
        // new bitmap AND the redact-free annotations SVG. Without
        // this, the host's debounced annotation-save would write
        // only annotationsSvg + tags, leaving the original bitmap
        // on disk — defeating the privacy contract. (Reported by
        // the user after Phase 7 archived the plan.)
        expect(updateImage).toHaveBeenCalledTimes(1);
        const call = updateImage.mock.calls[0] as unknown as [
          string,
          { annotationsSvg: string; originalDataUrl: string; updatedAt: string },
        ];
        expect(call[0]).toBe("/test.annot.svg");
        expect(call[1].originalDataUrl).toBe(hrefAfter);
        expect(call[1].annotationsSvg).toContain("<svg");
        // The redact-free SVG should NOT carry the redact element.
        expect(call[1].annotationsSvg).not.toContain("data-redact-style");
        expect(call[1].updatedAt).toBeTypeOf("string");
        expect(savedHandler).toHaveBeenCalledWith("/test.annot.svg");

        // History snapshot fired → host receives a dirty event.
        expect(dirtyHandler).toHaveBeenCalled();

        shell.destroy();
      } finally {
        stub.restore();
      }
    });

    it("re-throws + emits error when storage.updateImage rejects (so the host can surface a banner)", async () => {
      const stub = stubCanvasAndImage();
      try {
        const container = makeContainer();
        const updateImage = vi.fn(async () => {
          throw new Error("storage offline");
        });
        const storage = {
          getImage: vi.fn(async () => recordWithSolidRedact()),
          updateImage,
        } as unknown as StorageProvider;
        const shell = new EditorShell({ container, storage });
        await shell.open("/test.annot.svg");

        const errorHandler = vi.fn();
        shell.on("error", errorHandler);

        await expect(shell.applyAllRedactions()).rejects.toThrow(/storage offline/);
        expect(errorHandler).toHaveBeenCalled();

        shell.destroy();
      } finally {
        stub.restore();
      }
    });

    it("returns count: 0 + no-op when the document has no redactions", async () => {
      const stub = stubCanvasAndImage();
      try {
        const container = makeContainer();
        // makeRecord() ships an empty annotationsSvg, so no redacts.
        const { storage } = makeStorage();
        const shell = new EditorShell({ container, storage });
        await shell.open("/test.annot.svg");

        const canvas = shell.getCanvas();
        const hrefBefore = canvas?.imageEl.getAttribute("href");

        const dirtyHandler = vi.fn();
        shell.on("dirty", dirtyHandler);

        const result = await shell.applyAllRedactions();
        expect(result.count).toBe(0);
        // imageEl.href unchanged — no burn happened.
        expect(canvas?.imageEl.getAttribute("href")).toBe(hrefBefore);
        // No history snapshot, no dirty.
        expect(dirtyHandler).not.toHaveBeenCalled();

        shell.destroy();
      } finally {
        stub.restore();
      }
    });

    it("returns count: 0 when called before any image is open", async () => {
      const container = makeContainer();
      const { storage } = makeStorage();
      const shell = new EditorShell({ container, storage });
      // No `open()` call.
      const result = await shell.applyAllRedactions();
      expect(result.count).toBe(0);
      shell.destroy();
    });

    it("returns count: 0 after destroy()", async () => {
      const container = makeContainer();
      const { storage } = makeStorage(recordWithSolidRedact());
      const shell = new EditorShell({ container, storage });
      await shell.open("/test.annot.svg");
      shell.destroy();
      const result = await shell.applyAllRedactions();
      expect(result.count).toBe(0);
    });
  });
});
