// @vitest-environment happy-dom
//
// Phase 3 implementation tests for `@ingcreators/annot-editor-shell`.
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
});
