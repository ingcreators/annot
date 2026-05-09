/**
 * @vitest-environment happy-dom
 *
 * SVG id-rewrite helper. Locks in the contract that
 * `freshenInternalIds` regenerates every descendant `id` and
 * rewrites every same-subtree `url(#id)` / `href` / `xlink:href`
 * reference to the new id, while leaving outside-subtree references
 * untouched.
 */

import { describe, expect, it } from "vitest";
import { freshenInternalIds } from "./svg-id-utils.js";

const SVG_NS = "http://www.w3.org/2000/svg";

describe("freshenInternalIds", () => {
  it("no-op when the subtree carries no ids", () => {
    const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
    const r = document.createElementNS(SVG_NS, "rect");
    r.setAttribute("x", "0");
    g.appendChild(r);
    expect(() => freshenInternalIds(g as unknown as SVGElement)).not.toThrow();
    expect(r.hasAttribute("id")).toBe(false);
  });

  it("renames a descendant clipPath id and rewrites the sibling text's url(#id)", () => {
    const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
    const clip = document.createElementNS(SVG_NS, "clipPath");
    clip.id = "clip-textshape-abc";
    g.appendChild(clip);
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("clip-path", "url(#clip-textshape-abc)");
    g.appendChild(text);

    freshenInternalIds(g as unknown as SVGElement);

    const newId = clip.id;
    expect(newId).not.toBe("clip-textshape-abc");
    expect(newId.startsWith("clip-textshape-abc-")).toBe(true);
    expect(text.getAttribute("clip-path")).toBe(`url(#${newId})`);
  });

  it("does NOT rename the root element itself", () => {
    const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
    g.id = "wrapper-keepme";
    const clip = document.createElementNS(SVG_NS, "clipPath");
    clip.id = "inner";
    g.appendChild(clip);

    freshenInternalIds(g as unknown as SVGElement);

    expect(g.id).toBe("wrapper-keepme");
    expect(clip.id).not.toBe("inner");
  });

  it("rewrites multiple references to the SAME old id to the SAME new id", () => {
    const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
    const grad = document.createElementNS(SVG_NS, "linearGradient");
    grad.id = "grad-x";
    g.appendChild(grad);
    const r1 = document.createElementNS(SVG_NS, "rect");
    r1.setAttribute("fill", "url(#grad-x)");
    g.appendChild(r1);
    const r2 = document.createElementNS(SVG_NS, "rect");
    r2.setAttribute("stroke", "url(#grad-x)");
    g.appendChild(r2);

    freshenInternalIds(g as unknown as SVGElement);

    const newId = grad.id;
    expect(r1.getAttribute("fill")).toBe(`url(#${newId})`);
    expect(r2.getAttribute("stroke")).toBe(`url(#${newId})`);
  });

  it("rewrites href / xlink:href bare-anchor references", () => {
    const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
    const target = document.createElementNS(SVG_NS, "rect");
    target.id = "target";
    g.appendChild(target);
    const useEl = document.createElementNS(SVG_NS, "use");
    useEl.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#target");
    g.appendChild(useEl);
    const useEl2 = document.createElementNS(SVG_NS, "use");
    useEl2.setAttribute("href", "#target");
    g.appendChild(useEl2);

    freshenInternalIds(g as unknown as SVGElement);

    const newId = target.id;
    expect(useEl.getAttribute("xlink:href") || useEl.getAttribute("href")).toBe(`#${newId}`);
    expect(useEl2.getAttribute("href")).toBe(`#${newId}`);
  });

  it("leaves out-of-subtree url(#id) references intact (no map entry → no rewrite)", () => {
    const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
    // No clip element inside g, but the text references one elsewhere.
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("clip-path", "url(#external-clip)");
    g.appendChild(text);

    freshenInternalIds(g as unknown as SVGElement);

    expect(text.getAttribute("clip-path")).toBe("url(#external-clip)");
  });

  it("rewrites references that contain MULTIPLE url(#...) tokens in one attribute", () => {
    // Defensive: SVG `filter` chains can carry multiple refs.
    const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
    const a = document.createElementNS(SVG_NS, "filter");
    a.id = "fx-a";
    g.appendChild(a);
    const b = document.createElementNS(SVG_NS, "filter");
    b.id = "fx-b";
    g.appendChild(b);
    const r = document.createElementNS(SVG_NS, "rect");
    r.setAttribute("data-stack", "url(#fx-a) url(#fx-b)");
    g.appendChild(r);

    freshenInternalIds(g as unknown as SVGElement);

    const stack = r.getAttribute("data-stack")!;
    expect(stack).toContain(`url(#${a.id})`);
    expect(stack).toContain(`url(#${b.id})`);
    expect(stack).not.toContain("fx-a)");
    expect(stack).not.toContain("fx-b)");
  });

  it("two consecutive runs produce two DIFFERENT id sets (so two pastes don't collide)", () => {
    const make = () => {
      const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
      const c = document.createElementNS(SVG_NS, "clipPath");
      c.id = "clip-X";
      g.appendChild(c);
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("clip-path", "url(#clip-X)");
      g.appendChild(t);
      return { g, c, t };
    };
    const a = make();
    const b = make();
    freshenInternalIds(a.g as unknown as SVGElement);
    freshenInternalIds(b.g as unknown as SVGElement);
    expect(a.c.id).not.toBe(b.c.id);
    expect(a.t.getAttribute("clip-path")).toBe(`url(#${a.c.id})`);
    expect(b.t.getAttribute("clip-path")).toBe(`url(#${b.c.id})`);
  });
});
