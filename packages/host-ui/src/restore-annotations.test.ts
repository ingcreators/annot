/// <reference lib="dom" />
// @vitest-environment happy-dom
//
// Unit tests for `restoreAnnotations` — the SVG-string → live-canvas
// adoption path used by `EditorShell.mountFromRecord`.
//
// Regression coverage for the user-reported bug: a mosaic / blur
// redaction drawn but NOT yet "Apply"-burned was silently dropped on
// reopen. `exportAnnotationsSvgForIdb` flattens the `<g
// id="annotations">` wrapper before serialising to IDB, so mosaic /
// blur redactions (which are `<image>` elements) become top-level
// children of the saved SVG — and the original "skip top-level
// `<image>` because it's the base bitmap" rule then erased them on
// reopen. The fix discriminates on `data-redact-style`: base bitmaps
// never carry it, so the skip stays for them and lifts for redacts.

import { describe, expect, it } from "vitest";
import { restoreAnnotations } from "./restore-annotations.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Build the minimal CanvasManager-shaped object `restoreAnnotations`
 *  reads from — only the `annotations` group is touched. */
function makeStubCanvas(): {
  canvas: { annotations: SVGGElement };
  annotations: SVGGElement;
} {
  const ann = document.createElementNS(SVG_NS, "g") as SVGGElement;
  ann.id = "annotations";
  return {
    canvas: { annotations: ann },
    annotations: ann,
  };
}

describe("restoreAnnotations — top-level redact <image> survives reload", () => {
  it("adopts a top-level <image data-redact-style=\"mosaic\"> as an annotation", () => {
    const stub = makeStubCanvas();
    // Mirrors what `exportAnnotationsSvgForIdb` produces after the
    // user draws a mosaic redact and the autosave debounce fires:
    // `<g id="annotations">` is flattened away, so the redact
    // `<image>` becomes a top-level child of the SVG root.
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="320" height="240" data-annot-version="1">
  <defs/>
  <image href="data:image/png;base64,AAAA" x="60" y="60" width="140" height="100" data-redact-style="mosaic"/>
</svg>`;

    restoreAnnotations(stub.canvas as never, svg);

    const adopted = stub.annotations.querySelectorAll("[data-redact-style]");
    expect(adopted).toHaveLength(1);
    expect(adopted[0]?.tagName).toBe("image");
    expect(adopted[0]?.getAttribute("data-redact-style")).toBe("mosaic");
  });

  it("adopts a top-level <image data-redact-style=\"blur\"> as an annotation", () => {
    const stub = makeStubCanvas();
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="320" height="240" data-annot-version="1">
  <defs/>
  <image href="data:image/png;base64,AAAA" x="10" y="10" width="80" height="40" data-redact-style="blur"/>
</svg>`;

    restoreAnnotations(stub.canvas as never, svg);

    const adopted = stub.annotations.querySelectorAll("[data-redact-style]");
    expect(adopted).toHaveLength(1);
    expect(adopted[0]?.getAttribute("data-redact-style")).toBe("blur");
  });

  it("still skips a top-level <image> with NO data-redact-style (the base bitmap)", () => {
    const stub = makeStubCanvas();
    // Defensive: when callers pass a full SVG (e.g. legacy paths),
    // the base bitmap at the top of the document MUST NOT leak into
    // the annotations group. Discriminator: `data-redact-style` is
    // present on every redact `<image>` and absent from the base.
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="320" height="240" data-annot-version="1">
  <defs/>
  <image href="data:image/png;base64,AAAA" x="0" y="0" width="320" height="240"/>
  <rect x="10" y="10" width="40" height="20" fill="red"/>
</svg>`;

    restoreAnnotations(stub.canvas as never, svg);

    // Only the `<rect>` should make it into annotations — the base
    // `<image>` stays out.
    expect(stub.annotations.querySelectorAll("image")).toHaveLength(0);
    expect(stub.annotations.querySelectorAll("rect")).toHaveLength(1);
  });

  it("adopts a mix of solid (rect) + mosaic (image) + blur (image) redacts", () => {
    const stub = makeStubCanvas();
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240" width="320" height="240" data-annot-version="1">
  <defs/>
  <rect x="230" y="20" width="60" height="30" fill="#000" data-redact-style="solid"/>
  <image href="data:image/png;base64,AAAA" x="60" y="60" width="140" height="100" data-redact-style="mosaic"/>
  <image href="data:image/png;base64,AAAA" x="10" y="180" width="60" height="40" data-redact-style="blur"/>
</svg>`;

    restoreAnnotations(stub.canvas as never, svg);

    const adopted = stub.annotations.querySelectorAll("[data-redact-style]");
    expect(adopted).toHaveLength(3);
    const styles = [...adopted].map((el) => el.getAttribute("data-redact-style"));
    expect(styles).toEqual(["solid", "mosaic", "blur"]);
  });
});
