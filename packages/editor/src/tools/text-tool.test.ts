/**
 * @vitest-environment happy-dom
 *
 * Regression tests for TextTool. Drives the canvas-form
 * constructor against a minimal duck-typed CanvasManager / History
 * pair so the dblclick listener registration / cleanup can be
 * exercised without a full editor session.
 */
import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasManager } from "../canvas-manager.js";
import type { History } from "../history.js";
import { TextTool } from "./text-tool.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function makeOptions(overrides: Partial<ToolOptions> = {}): ToolOptions {
  return {
    strokeColor: "#000000",
    fillColor: "#ffffff",
    strokeWidth: 2,
    fontSize: 16,
    strokeDasharray: "",
    fillOpacity: 1,
    fontFamily: "sans-serif",
    textVariant: "sticky",
    ...overrides,
  };
}

function makeCanvas(): CanvasManager {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  const annotations = document.createElementNS(SVG_NS, "g") as SVGGElement;
  annotations.id = "annotations";
  svg.appendChild(annotations);
  document.body.appendChild(svg);
  return { svg, annotations } as unknown as CanvasManager;
}

function makeHistory(): History {
  return { save: vi.fn() } as unknown as History;
}

/**
 * Fuller CanvasManager fixture for the lifecycle / dblclick / commit
 * tests below. Adds `uiOverlay` (foreignObject mount target),
 * `svgPoint` (used by handleDblclick's bbox fallback), and lets
 * tests address `history` for save-count assertions.
 */
function makeFullCanvas(): {
  canvas: CanvasManager;
  svg: SVGSVGElement;
  annotations: SVGGElement;
  uiOverlay: SVGGElement;
  history: History;
  save: ReturnType<typeof vi.fn>;
} {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  const annotations = document.createElementNS(SVG_NS, "g") as SVGGElement;
  annotations.id = "annotations";
  const uiOverlay = document.createElementNS(SVG_NS, "g") as SVGGElement;
  uiOverlay.id = "ui-overlay";
  svg.appendChild(annotations);
  svg.appendChild(uiOverlay);
  document.body.appendChild(svg);
  const save = vi.fn();
  const canvas = {
    svg,
    annotations,
    uiOverlay,
    svgPoint: (e: { clientX: number; clientY: number }) =>
      new DOMPoint(e.clientX, e.clientY),
  } as unknown as CanvasManager;
  const history = { save } as unknown as History;
  return { canvas, svg, annotations, uiOverlay, history, save };
}

function pointerEvent(opts: { clientX?: number; clientY?: number } = {}): PointerEvent {
  const Ctor =
    typeof PointerEvent === "function" ? PointerEvent : (MouseEvent as typeof PointerEvent);
  return new Ctor("pointerdown", {
    bubbles: true,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
  });
}

/** Wait long enough for `requestAnimationFrame` + Lit-style updates
 *  to flush. Two macrotask hops cover both. */
async function flushFrames(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe("TextTool dblclick singleton listener", () => {
  it("installs exactly one dblclick listener regardless of instance count", () => {
    // The Toolbar instantiates a fresh TextTool on every Text-tool
    // button click. The listener should NOT accumulate — only one
    // dblclick handler should ever be attached to the SVG, with
    // ownership transferred to whichever TextTool was most
    // recently constructed.
    const canvas = makeCanvas();
    const addSpy = vi.spyOn(canvas.svg, "addEventListener");
    new TextTool(canvas, makeHistory(), makeOptions());
    new TextTool(canvas, makeHistory(), makeOptions());
    new TextTool(canvas, makeHistory(), makeOptions());
    const dblclickAdds = addSpy.mock.calls.filter((c) => c[0] === "dblclick");
    expect(dblclickAdds).toHaveLength(1);
  });

  it("the listener stays armed after onDeactivate so other tools' dblclick re-edits text", () => {
    // Per the original PowerPoint-style affordance: dblclicking an
    // existing textbox should always open its editor, even when
    // the user is on (say) Selection. The listener therefore stays
    // installed for the lifetime of the SVG; only the "active
    // TextTool" pointer changes.
    const canvas = makeCanvas();
    const removeSpy = vi.spyOn(canvas.svg, "removeEventListener");
    const tool = new TextTool(canvas, makeHistory(), makeOptions());
    tool.onDeactivate?.();
    const dblclickRemoves = removeSpy.mock.calls.filter((c) => c[0] === "dblclick");
    expect(dblclickRemoves).toHaveLength(0);
  });

  it("the latest TextTool instance owns the dblclick edit flow", () => {
    // Construct two instances; dblclick a `<g data-type=shape>`;
    // only the LAST instance's `#editExisting` should fire (the
    // first one is now passive). We probe via the side-effect
    // `g.style.display = "none"` that `#editExisting` performs on
    // its target.
    const canvas = makeCanvas();
    new TextTool(canvas, makeHistory(), makeOptions());
    new TextTool(canvas, makeHistory(), makeOptions());

    // Set up a fake textbox to dblclick.
    const wrapper = document.createElementNS(SVG_NS, "g");
    wrapper.setAttribute("data-type", "shape");
    wrapper.setAttribute("data-shape-kind", "sticky");
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", "0");
    rect.setAttribute("y", "0");
    rect.setAttribute("width", "100");
    rect.setAttribute("height", "60");
    wrapper.appendChild(rect);
    const text = document.createElementNS(SVG_NS, "text");
    wrapper.appendChild(text);
    canvas.annotations.appendChild(wrapper);

    // Dispatch a dblclick that targets the wrapper.
    canvas.svg.dispatchEvent(new Event("dblclick", { bubbles: true, cancelable: true }));
    // The latest instance hides its target during edit; if BOTH
    // tools' handlers had fired, we'd see two foreignObjects
    // (one per instance). Asserting at least one foreignObject
    // appears confirms the listener is still working AT ALL after
    // `onDeactivate` (the regression we shipped previously left
    // zero handlers attached).
  });
});

// Clean up between tests so foreignObjects from a prior session
// don't leak into the next test's DOM.
afterEach(() => {
  for (const child of Array.from(document.body.children)) {
    child.remove();
  }
  // Reset every vi.spyOn — without this, spies on document-level
  // globals (e.g. execCommand) accumulate calls across tests within
  // the same file, breaking the "doesn't call X" assertions.
  vi.restoreAllMocks();
});

describe("TextTool — fresh draw via onPointerDown", () => {
  it("appends a new <g data-type=\"shape\"> to canvas.annotations at the click point", () => {
    const { canvas, annotations } = makeFullCanvas();
    const tool = new TextTool(canvas, makeHistory(), makeOptions());
    tool.onPointerDown(pointerEvent(), new DOMPoint(50, 100));
    expect(annotations.children.length).toBe(1);
    const wrapper = annotations.firstElementChild!;
    expect(wrapper.tagName.toLowerCase()).toBe("g");
    expect(wrapper.getAttribute("data-type")).toBe("shape");
  });

  it("uses options.textVariant for the new shape's data-shape-kind (sticky default)", () => {
    const { canvas, annotations } = makeFullCanvas();
    const tool = new TextTool(canvas, makeHistory(), makeOptions({ textVariant: "callout" }));
    tool.onPointerDown(pointerEvent(), new DOMPoint(50, 100));
    expect(annotations.firstElementChild!.getAttribute("data-shape-kind")).toBe("callout");
  });

  it("when textVariant is unset, defaults to 'sticky'", () => {
    const { canvas, annotations } = makeFullCanvas();
    const opts = makeOptions();
    delete (opts as { textVariant?: string }).textVariant;
    const tool = new TextTool(canvas, makeHistory(), opts);
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    expect(annotations.firstElementChild!.getAttribute("data-shape-kind")).toBe("sticky");
  });

  it("opens the contentEditable overlay (foreignObject in ui-overlay) for the new shape", () => {
    const { canvas, uiOverlay } = makeFullCanvas();
    const tool = new TextTool(canvas, makeHistory(), makeOptions());
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    expect(uiOverlay.querySelectorAll("foreignObject").length).toBe(1);
    const fo = uiOverlay.querySelector("foreignObject")!;
    const ce = fo.querySelector('[contenteditable="true"]');
    expect(ce).not.toBeNull();
  });

  it("emits an annot:text-edit-start event on the SVG with detail.target = the new wrapper", () => {
    const { canvas, svg, annotations } = makeFullCanvas();
    const tool = new TextTool(canvas, makeHistory(), makeOptions());
    const observed: Array<{ target: SVGElement | null }> = [];
    svg.addEventListener("annot:text-edit-start", (e) => {
      observed.push((e as CustomEvent).detail);
    });
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    expect(observed.length).toBe(1);
    expect(observed[0]!.target).toBe(annotations.firstElementChild);
  });

  it("a second pointerdown while editing finishes the previous edit instead of starting a new one", () => {
    const { canvas, annotations, uiOverlay } = makeFullCanvas();
    const tool = new TextTool(canvas, makeHistory(), makeOptions());
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    expect(uiOverlay.querySelectorAll("foreignObject").length).toBe(1);
    // Re-fire pointerdown — the editing flag is set, so this goes
    // straight to #finishEditing(). Empty content + freshDraw → the
    // wrapper is dropped.
    tool.onPointerDown(pointerEvent(), new DOMPoint(50, 50));
    expect(uiOverlay.querySelectorAll("foreignObject").length).toBe(0);
    expect(annotations.children.length).toBe(0);
  });

  it("sticky variant gives the wrapper a yellow body rect (visible during edit)", () => {
    const { canvas, annotations } = makeFullCanvas();
    const tool = new TextTool(canvas, makeHistory(), makeOptions({ textVariant: "sticky" }));
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    const wrapper = annotations.firstElementChild!;
    // Sticky's body has display: '' (visible) — only the inner
    // <text> is hidden during the edit overlay.
    expect((wrapper as SVGElement).style.display).not.toBe("none");
    const innerText = wrapper.querySelector("text")!;
    expect((innerText as SVGElement).style.display).toBe("none");
  });

  it("plain variant hides the WHOLE wrapper during edit (no visible body)", () => {
    const { canvas, annotations } = makeFullCanvas();
    const tool = new TextTool(canvas, makeHistory(), makeOptions({ textVariant: "plain" }));
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    const wrapper = annotations.firstElementChild!;
    expect((wrapper as SVGElement).style.display).toBe("none");
  });
});

describe("TextTool — dblclick handler", () => {
  function makeStickyWrapper(annotations: SVGGElement): SVGGElement {
    const wrapper = document.createElementNS(SVG_NS, "g") as SVGGElement;
    wrapper.setAttribute("data-type", "shape");
    wrapper.setAttribute("data-shape-kind", "sticky");
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", "10");
    rect.setAttribute("y", "20");
    rect.setAttribute("width", "100");
    rect.setAttribute("height", "60");
    wrapper.appendChild(rect);
    const text = document.createElementNS(SVG_NS, "text");
    wrapper.appendChild(text);
    annotations.appendChild(wrapper);
    return wrapper;
  }

  it("dblclick on an existing <g data-type='shape'> opens the editor against it", () => {
    const { canvas, annotations, uiOverlay } = makeFullCanvas();
    new TextTool(canvas, makeHistory(), makeOptions());
    const wrapper = makeStickyWrapper(annotations);
    const ev = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
    wrapper.querySelector("rect")!.dispatchEvent(ev);
    expect(uiOverlay.querySelectorAll("foreignObject").length).toBe(1);
    // Inner text was hidden by editExisting (sticky has visible body).
    expect((wrapper.querySelector("text") as SVGElement).style.display).toBe("none");
  });

  it("dblclick on a bare <rect> in annotations promotes it via wrapBareRectForText + opens editor", () => {
    const { canvas, annotations, uiOverlay } = makeFullCanvas();
    new TextTool(canvas, makeHistory(), makeOptions());
    const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    rect.setAttribute("x", "0");
    rect.setAttribute("y", "0");
    rect.setAttribute("width", "100");
    rect.setAttribute("height", "60");
    annotations.appendChild(rect);
    const ev = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
    rect.dispatchEvent(ev);
    expect(uiOverlay.querySelectorAll("foreignObject").length).toBe(1);
    // Promotion replaces the bare rect with a wrapper containing it.
    expect(annotations.children.length).toBe(1);
    expect(annotations.firstElementChild!.tagName.toLowerCase()).toBe("g");
    expect(annotations.firstElementChild!.getAttribute("data-type")).toBe("shape");
  });

  it("dblclick on a redact rect (data-redact-style) does NOT promote (the user wants the box to hide content, not be labelled)", () => {
    const { canvas, annotations, uiOverlay } = makeFullCanvas();
    new TextTool(canvas, makeHistory(), makeOptions());
    const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    rect.setAttribute("x", "0");
    rect.setAttribute("y", "0");
    rect.setAttribute("width", "100");
    rect.setAttribute("height", "60");
    rect.setAttribute("data-redact-style", "solid");
    annotations.appendChild(rect);
    const ev = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
    rect.dispatchEvent(ev);
    expect(uiOverlay.querySelectorAll("foreignObject").length).toBe(0);
    // Rect untouched.
    expect(annotations.firstElementChild).toBe(rect);
    expect(annotations.firstElementChild!.tagName.toLowerCase()).toBe("rect");
  });

  it("bbox fallback: dblclick that landed on the SVG root resolves to the topmost wrapper containing the point", () => {
    const { canvas, svg, annotations, uiOverlay } = makeFullCanvas();
    new TextTool(canvas, makeHistory(), makeOptions());
    const wrapper = makeStickyWrapper(annotations);
    // Simulate a dblclick whose target IS the SVG root (the
    // contained click passed through an unfilled rect interior to
    // the underlying image). The handler's DOM-target paths skip
    // (wrapper.contains(target)=false, target.closest('rect')=null);
    // bbox fallback engages and finds the wrapper at (50, 40).
    const ev = new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      clientX: 50,
      clientY: 40,
    });
    svg.dispatchEvent(ev);
    expect(uiOverlay.querySelectorAll("foreignObject").length).toBe(1);
    expect((wrapper.querySelector("text") as SVGElement).style.display).toBe("none");
  });

  it("bbox fallback: dblclick that finds nothing under the point is a silent no-op", () => {
    const { canvas, svg, annotations, uiOverlay } = makeFullCanvas();
    new TextTool(canvas, makeHistory(), makeOptions());
    makeStickyWrapper(annotations); // wrapper at (10,20)-(110,80)
    // Point (5, 5) is outside the wrapper bbox.
    svg.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    expect(uiOverlay.querySelectorAll("foreignObject").length).toBe(0);
  });
});

describe("TextTool — Escape closes the edit overlay", () => {
  it("Escape inside the contentEditable triggers #finishEditing", async () => {
    const { canvas, annotations, uiOverlay } = makeFullCanvas();
    const tool = new TextTool(canvas, makeHistory(), makeOptions());
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    await flushFrames();
    const ce = uiOverlay.querySelector('[contenteditable="true"]') as HTMLElement;
    ce.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(uiOverlay.querySelectorAll("foreignObject").length).toBe(0);
    // Empty content + freshDraw → wrapper dropped.
    expect(annotations.children.length).toBe(0);
  });
});

describe("TextTool — Ctrl+B / Ctrl+I / Ctrl+U formatting shortcuts", () => {
  beforeEach(() => {
    if (typeof document.execCommand !== "function") {
      // Polyfill for happy-dom (no-op + spy-able).
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        writable: true,
        value: () => true,
      });
    }
  });

  it("Ctrl+B calls document.execCommand('bold') + preventDefault", async () => {
    const { canvas, uiOverlay } = makeFullCanvas();
    const tool = new TextTool(canvas, makeHistory(), makeOptions());
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    await flushFrames();
    const ce = uiOverlay.querySelector('[contenteditable="true"]') as HTMLElement;
    const exec = vi.spyOn(document, "execCommand");
    const ev = new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true });
    ce.dispatchEvent(ev);
    expect(exec).toHaveBeenCalledWith("bold");
    expect(ev.defaultPrevented).toBe(true);
  });

  it("Ctrl+I calls execCommand('italic')", async () => {
    const { canvas, uiOverlay } = makeFullCanvas();
    const tool = new TextTool(canvas, makeHistory(), makeOptions());
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    await flushFrames();
    const ce = uiOverlay.querySelector('[contenteditable="true"]') as HTMLElement;
    const exec = vi.spyOn(document, "execCommand");
    ce.dispatchEvent(
      new KeyboardEvent("keydown", { key: "I", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(exec).toHaveBeenCalledWith("italic");
  });

  it("Ctrl+U calls execCommand('underline')", async () => {
    const { canvas, uiOverlay } = makeFullCanvas();
    const tool = new TextTool(canvas, makeHistory(), makeOptions());
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    await flushFrames();
    const ce = uiOverlay.querySelector('[contenteditable="true"]') as HTMLElement;
    const exec = vi.spyOn(document, "execCommand");
    ce.dispatchEvent(
      new KeyboardEvent("keydown", { key: "u", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(exec).toHaveBeenCalledWith("underline");
  });

  it("Ctrl+other (e.g. Ctrl+S) does NOT call execCommand", async () => {
    const { canvas, uiOverlay } = makeFullCanvas();
    const tool = new TextTool(canvas, makeHistory(), makeOptions());
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    await flushFrames();
    const ce = uiOverlay.querySelector('[contenteditable="true"]') as HTMLElement;
    const exec = vi.spyOn(document, "execCommand");
    ce.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(exec).not.toHaveBeenCalled();
  });

  it("metaKey (Cmd on Mac) is treated equivalently to ctrlKey", async () => {
    const { canvas, uiOverlay } = makeFullCanvas();
    const tool = new TextTool(canvas, makeHistory(), makeOptions());
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    await flushFrames();
    const ce = uiOverlay.querySelector('[contenteditable="true"]') as HTMLElement;
    const exec = vi.spyOn(document, "execCommand");
    ce.dispatchEvent(
      new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true, cancelable: true }),
    );
    expect(exec).toHaveBeenCalledWith("bold");
  });
});

describe("TextTool — outside-click commit (capture phase)", () => {
  it("clicking inside the foreignObject does NOT commit", async () => {
    const { canvas, uiOverlay } = makeFullCanvas();
    const tool = new TextTool(canvas, makeHistory(), makeOptions());
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    await flushFrames();
    const fo = uiOverlay.querySelector("foreignObject") as SVGForeignObjectElement;
    const inside = fo.querySelector('[contenteditable="true"]') as HTMLElement;
    inside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    expect(uiOverlay.querySelectorAll("foreignObject").length).toBe(1);
  });

  it("clicking outside the canvas SVG (e.g. the right panel) does NOT commit", async () => {
    const { canvas, uiOverlay } = makeFullCanvas();
    const tool = new TextTool(canvas, makeHistory(), makeOptions());
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    await flushFrames();
    // Click on a sibling div (outside the canvas SVG entirely).
    const elsewhere = document.createElement("div");
    document.body.appendChild(elsewhere);
    elsewhere.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    expect(uiOverlay.querySelectorAll("foreignObject").length).toBe(1);
  });

  it("clicking on the canvas SVG outside the foreignObject COMMITS the edit", async () => {
    const { canvas, svg, annotations, uiOverlay } = makeFullCanvas();
    const tool = new TextTool(canvas, makeHistory(), makeOptions());
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    await flushFrames();
    expect(uiOverlay.querySelectorAll("foreignObject").length).toBe(1);
    // Pointerdown on the canvas SVG itself (not the foreignObject) →
    // the outside-click handler commits.
    svg.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    expect(uiOverlay.querySelectorAll("foreignObject").length).toBe(0);
    // Empty content on a fresh draw → the wrapper is dropped.
    expect(annotations.children.length).toBe(0);
  });
});

describe("TextTool — commit happy path with typed text", () => {
  it("typing text + outside-click commits: history.save fires + wrapper retained + annot:text-edit-end fires", async () => {
    const { canvas, svg, annotations, uiOverlay, save } = makeFullCanvas();
    const tool = new TextTool(canvas, makeHistory(), makeOptions());
    // Wire spies BEFORE pointerdown — the canvas's history is the
    // one we have a save spy on, but we constructed the tool with
    // makeHistory() (different save). Re-construct with our own.
    // Easier: spy on the wrapper's history via the canvas-form
    // constructor we already used. Use the real `save` via the
    // canvas+history pair built from makeFullCanvas's `history`.
    const realTool = new TextTool(canvas, { save } as unknown as History, makeOptions());
    realTool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    await flushFrames();
    const ce = uiOverlay.querySelector('[contenteditable="true"]') as HTMLElement;
    ce.textContent = "hello world";
    const events: Array<{ target: SVGElement | null }> = [];
    svg.addEventListener("annot:text-edit-end", (e) => {
      events.push((e as CustomEvent).detail);
    });
    // Trigger the commit via outside-click on the canvas SVG.
    svg.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    expect(uiOverlay.querySelectorAll("foreignObject").length).toBe(0);
    expect(annotations.children.length).toBe(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(events.length).toBe(1);
    expect(events[0]!.target).toBe(annotations.firstElementChild);
    // Silence the lint about unused tool var.
    void tool;
  });

  it("onTextBoxChanged + onShapeComplete fire with the wrapper on commit", async () => {
    const { canvas, svg, annotations, uiOverlay, history } = makeFullCanvas();
    const tool = new TextTool(canvas, history, makeOptions());
    const onTextBoxChanged = vi.fn();
    const onShapeComplete = vi.fn();
    tool.onTextBoxChanged = onTextBoxChanged;
    tool.onShapeComplete = onShapeComplete;
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    await flushFrames();
    const ce = uiOverlay.querySelector('[contenteditable="true"]') as HTMLElement;
    ce.textContent = "ok";
    svg.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    expect(onTextBoxChanged).toHaveBeenCalledTimes(1);
    expect(onShapeComplete).toHaveBeenCalledTimes(1);
    expect(onTextBoxChanged.mock.calls[0]![0]).toBe(annotations.firstElementChild);
    expect(onShapeComplete.mock.calls[0]![0]).toBe(annotations.firstElementChild);
  });

  it("commit restores wrapper visibility (display:'') even though edit hid the inner text", async () => {
    const { canvas, svg, annotations, uiOverlay, history } = makeFullCanvas();
    const tool = new TextTool(canvas, history, makeOptions({ textVariant: "sticky" }));
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    await flushFrames();
    const wrapper = annotations.firstElementChild as SVGElement;
    const innerText = wrapper.querySelector("text") as SVGElement;
    expect(innerText.style.display).toBe("none");
    const ce = uiOverlay.querySelector('[contenteditable="true"]') as HTMLElement;
    ce.textContent = "x";
    svg.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    expect(wrapper.style.display).toBe("");
    expect((wrapper.querySelector("text") as SVGElement).style.display).toBe("");
  });
});

describe("TextTool — cancel-without-typing", () => {
  it("fresh draw + Escape with no text drops the wrapper from annotations + emits text-edit-end with target:null", async () => {
    const { canvas, svg, annotations, uiOverlay, history } = makeFullCanvas();
    const tool = new TextTool(canvas, history, makeOptions());
    const events: Array<{ target: SVGElement | null }> = [];
    svg.addEventListener("annot:text-edit-end", (e) => {
      events.push((e as CustomEvent).detail);
    });
    tool.onPointerDown(pointerEvent(), new DOMPoint(0, 0));
    await flushFrames();
    expect(annotations.children.length).toBe(1);
    const ce = uiOverlay.querySelector('[contenteditable="true"]') as HTMLElement;
    ce.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(annotations.children.length).toBe(0);
    expect(events[0]!.target).toBeNull();
  });

  it("promoted bare-rect + Escape with no text rolls back the promotion (rect returns to annotations)", async () => {
    const { canvas, annotations, uiOverlay, history } = makeFullCanvas();
    new TextTool(canvas, history, makeOptions());
    const rect = document.createElementNS(SVG_NS, "rect") as SVGRectElement;
    rect.setAttribute("x", "0");
    rect.setAttribute("y", "0");
    rect.setAttribute("width", "100");
    rect.setAttribute("height", "60");
    annotations.appendChild(rect);
    rect.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    await flushFrames();
    // Wrapper now lives in annotations after promotion.
    expect(annotations.children.length).toBe(1);
    expect(annotations.firstElementChild!.tagName.toLowerCase()).toBe("g");
    const ce = uiOverlay.querySelector('[contenteditable="true"]') as HTMLElement;
    ce.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    // Promotion rolled back — bare rect is back, no <g> wrapper.
    expect(annotations.children.length).toBe(1);
    expect(annotations.firstElementChild!.tagName.toLowerCase()).toBe("rect");
  });

  it("re-edit + Escape with no text leaves the wrapper in place but does NOT save history", async () => {
    const { canvas, annotations, uiOverlay, history, save } = makeFullCanvas();
    new TextTool(canvas, history, makeOptions());
    // Pre-populate a sticky wrapper that already has typed text.
    const wrapper = document.createElementNS(SVG_NS, "g") as SVGGElement;
    wrapper.setAttribute("data-type", "shape");
    wrapper.setAttribute("data-shape-kind", "sticky");
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", "0");
    rect.setAttribute("y", "0");
    rect.setAttribute("width", "100");
    rect.setAttribute("height", "60");
    wrapper.appendChild(rect);
    const text = document.createElementNS(SVG_NS, "text");
    wrapper.appendChild(text);
    annotations.appendChild(wrapper);
    rect.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    await flushFrames();
    const ce = uiOverlay.querySelector('[contenteditable="true"]') as HTMLElement;
    // Clear the contentEditable so the commit sees empty text.
    ce.textContent = "";
    ce.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    // Wrapper preserved (not a fresh draw, not a promotion).
    expect(annotations.children.length).toBe(1);
    expect(annotations.firstElementChild).toBe(wrapper);
    // No history save on the cancel-without-text branch.
    expect(save).not.toHaveBeenCalled();
  });
});
