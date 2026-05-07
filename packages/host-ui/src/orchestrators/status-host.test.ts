/**
 * @vitest-environment happy-dom
 *
 * StatusHost is a thin orchestrator around `<annot-editor-statusbar>`:
 * `build()` mounts the Lit element, `setActiveTool()` proxies the
 * call onto it. The behavioural surface is small but it sits on the
 * editor session's per-image lifecycle (called once per open + on
 * every active-tool change), so an idempotent `build()` and a
 * pre-build `setActiveTool()` no-op matter for callers that don't
 * order the two perfectly.
 */

import type { CanvasManager } from "@ingcreators/annot-editor";
import { describe, expect, it } from "vitest";
import { StatusHost } from "./status-host.js";

function fakeCanvas(): CanvasManager {
  // The statusbar element only reads .imageWidth / .imageHeight from
  // canvas; nothing else is touched at construction time. The host
  // itself just forwards the reference.
  return { imageWidth: 800, imageHeight: 600 } as unknown as CanvasManager;
}

function makeHost(): HTMLDivElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

describe("StatusHost", () => {
  it("constructor does not mount any DOM yet", () => {
    const host = makeHost();
    new StatusHost(host);
    expect(host.children.length).toBe(0);
  });

  it("build() mounts <annot-editor-statusbar> with the supplied canvas + dimensions", () => {
    const host = makeHost();
    const sh = new StatusHost(host);
    const canvas = fakeCanvas();
    sh.build(canvas, 1024, 768);
    expect(host.children.length).toBe(1);
    const el = host.firstElementChild as HTMLElement;
    expect(el.tagName.toLowerCase()).toBe("annot-editor-statusbar");
    expect((el as unknown as { canvas: unknown }).canvas).toBe(canvas);
    expect((el as unknown as { width: number }).width).toBe(1024);
    expect((el as unknown as { height: number }).height).toBe(768);
  });

  it("build() is idempotent — calling again clears the previous element + mounts a fresh one", () => {
    const host = makeHost();
    const sh = new StatusHost(host);
    const c1 = fakeCanvas();
    const c2 = fakeCanvas();
    sh.build(c1, 100, 100);
    const first = host.firstElementChild;
    sh.build(c2, 200, 200);
    expect(host.children.length).toBe(1);
    expect(host.firstElementChild).not.toBe(first);
    expect((host.firstElementChild as unknown as { canvas: unknown }).canvas).toBe(c2);
  });

  it("setActiveTool() forwards to the mounted element", () => {
    const host = makeHost();
    const sh = new StatusHost(host);
    sh.build(fakeCanvas(), 100, 100);
    const el = host.firstElementChild as unknown as { currentToolName?: string };
    sh.setActiveTool("Arrow");
    expect(el.currentToolName).toBe("Arrow");
  });

  it("setActiveTool() before build() is a safe no-op", () => {
    const host = makeHost();
    const sh = new StatusHost(host);
    expect(() => sh.setActiveTool("Arrow")).not.toThrow();
    expect(host.children.length).toBe(0);
  });
});
