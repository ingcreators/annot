/**
 * @vitest-environment happy-dom
 *
 * OverlayTool tests — Phase 4d of
 * `docs/plans/living-spec-authoring-roadmap.md`.
 *
 * Coverage:
 *   - `buildProposal` derives match keys from role/name and
 *     auto-assigns number = max(existing) + 1.
 *   - `handlePick` resolves through the injected
 *     `openIntentDialog` and forwards the confirmed entry to
 *     `onCommit`; cancel path does NOT call onCommit.
 *   - `onActivate` mounts the picker via the injected factory
 *     and subscribes to `overlay-region-pick`.
 *   - `onDeactivate` tears the picker down and removes its
 *     listener.
 *   - DOM event flow: dispatching `overlay-region-pick` on the
 *     mounted picker reaches `handlePick`.
 *   - `setContext` while active re-mounts the picker with the
 *     new tree.
 */

import type { OverlayRegionPickDetail } from "@ingcreators/annot-core/editor";
import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";
import type { ElementTree } from "@ingcreators/annot-core/element-tree";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasManager } from "../canvas-manager.js";
import type { History } from "../history.js";
import {
  type OverlayEntry,
  type OverlayProposal,
  OverlayTool,
  type OverlayToolContext,
  type SnapshotPickerHandle,
} from "./overlay-tool.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function makeCanvas(): CanvasManager {
  const annotations = document.createElementNS(SVG_NS, "g") as SVGGElement;
  return { annotations } as unknown as CanvasManager;
}

function makeHistory(): History {
  return { save: vi.fn() } as unknown as History;
}

function makeOptions(): ToolOptions {
  return {} as ToolOptions;
}

function makeTree(): ElementTree {
  return {
    version: 1,
    source: { kind: "playwright", capturedAt: "2026-05-23T10:00:00Z" },
    viewport: { width: 800, height: 600, scale: 1 },
    root: {
      ref: "e1",
      role: "main",
      bbox: { x: 0, y: 0, width: 800, height: 600 },
      children: [
        {
          ref: "e2",
          role: "textbox",
          name: "Email",
          bbox: { x: 100, y: 200, width: 300, height: 40 },
        },
      ],
    },
  };
}

interface TestHarness {
  tool: OverlayTool;
  container: HTMLElement;
  mountedPickers: HTMLElement[];
  unmountSpy: ReturnType<typeof vi.fn>;
  openIntentDialog: ReturnType<typeof vi.fn>;
  onCommit: ReturnType<typeof vi.fn>;
  dialogResolver: { resolve: (entry: OverlayEntry | null) => void } | null;
}

/**
 * Build an OverlayTool with a stubbed mountSnapshotPicker that
 * creates a bare `<div>` and tracks unmount calls. The dialog
 * stub queues a single deferred Promise so individual tests can
 * resolve it on their schedule.
 */
function makeHarness(
  opts: {
    elementTree?: ElementTree | undefined;
    existingOverlays?: readonly OverlayEntry[];
    dialogResult?: OverlayEntry | null;
  } = {},
): TestHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const mountedPickers: HTMLElement[] = [];
  const unmountSpy = vi.fn();
  const dialogStub = vi.fn<(p: OverlayProposal) => Promise<OverlayEntry | null>>(async (p) => {
    if ("dialogResult" in opts) return opts.dialogResult ?? null;
    return {
      id: `o${p.proposedNumber}`,
      kind: "numberedBadge",
      match: p.proposedMatch,
      intent: "required",
      number: p.proposedNumber,
    };
  });
  const commitStub = vi.fn();
  const context: OverlayToolContext = {
    overlayContainer: container,
    elementTree: opts.elementTree,
    existingOverlays: opts.existingOverlays ?? [],
    mountSnapshotPicker: (c, _tree): SnapshotPickerHandle => {
      const element = document.createElement("div");
      element.dataset.testid = "overlay-picker";
      c.appendChild(element);
      mountedPickers.push(element);
      return {
        element,
        unmount: () => {
          unmountSpy();
          element.remove();
        },
      };
    },
    openIntentDialog: dialogStub,
    onCommit: commitStub,
  };

  const tool = new OverlayTool(makeCanvas(), makeHistory(), makeOptions());
  tool.setContext(context);

  return {
    tool,
    container,
    mountedPickers,
    unmountSpy,
    openIntentDialog: dialogStub,
    onCommit: commitStub,
    dialogResolver: null,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("OverlayTool.buildProposal", () => {
  it("auto-assigns number = 1 when no existing overlays", () => {
    const h = makeHarness({ existingOverlays: [] });
    const proposal = h.tool.buildProposal({
      ref: "e2",
      role: "textbox",
      name: "Email",
      bbox: { x: 100, y: 200, width: 300, height: 40 },
    });
    expect(proposal.proposedNumber).toBe(1);
  });

  it("auto-assigns number = max(existing) + 1", () => {
    const h = makeHarness({
      existingOverlays: [
        {
          id: "o1",
          kind: "numberedBadge",
          match: { role: "textbox", name: "Email" },
          number: 1,
        },
        {
          id: "o2",
          kind: "numberedBadge",
          match: { role: "textbox", name: "Password" },
          number: 7,
        },
      ],
    });
    const proposal = h.tool.buildProposal({
      ref: "e5",
      role: "button",
      name: "Sign in",
      bbox: { x: 100, y: 340, width: 100, height: 36 },
    });
    expect(proposal.proposedNumber).toBe(8);
  });

  it("derives match key from role + name", () => {
    const h = makeHarness();
    const proposal = h.tool.buildProposal({
      ref: "e2",
      role: "textbox",
      name: "Email",
      bbox: { x: 100, y: 200, width: 300, height: 40 },
    });
    expect(proposal.proposedMatch).toEqual({ role: "textbox", name: "Email" });
  });

  it("omits match.name when the picked node has no accessible name", () => {
    const h = makeHarness();
    const proposal = h.tool.buildProposal({
      ref: "e3",
      role: "generic",
      bbox: { x: 10, y: 10, width: 50, height: 50 },
    });
    expect(proposal.proposedMatch).toEqual({ role: "generic" });
    expect(proposal.name).toBeUndefined();
  });

  it("throws when called before setContext", () => {
    const tool = new OverlayTool(makeCanvas(), makeHistory(), makeOptions());
    expect(() =>
      tool.buildProposal({
        ref: "e1",
        role: "main",
        bbox: { x: 0, y: 0, width: 10, height: 10 },
      }),
    ).toThrow(/setContext/);
  });
});

describe("OverlayTool.handlePick", () => {
  const DETAIL: OverlayRegionPickDetail = {
    ref: "e2",
    role: "textbox",
    name: "Email",
    bbox: { x: 100, y: 200, width: 300, height: 40 },
  };

  it("forwards the confirmed entry to onCommit", async () => {
    const h = makeHarness();
    await h.tool.handlePick(DETAIL);
    expect(h.openIntentDialog).toHaveBeenCalledTimes(1);
    expect(h.onCommit).toHaveBeenCalledTimes(1);
    const committed = h.onCommit.mock.calls[0]?.[0] as OverlayEntry;
    expect(committed).toEqual({
      id: "o1",
      kind: "numberedBadge",
      match: { role: "textbox", name: "Email" },
      intent: "required",
      number: 1,
    });
  });

  it("does not call onCommit when the dialog returns null (cancel)", async () => {
    const h = makeHarness({ dialogResult: null });
    await h.tool.handlePick(DETAIL);
    expect(h.openIntentDialog).toHaveBeenCalledTimes(1);
    expect(h.onCommit).not.toHaveBeenCalled();
  });

  it("awaits onCommit before resolving (the shell can persist before next pick)", async () => {
    const order: string[] = [];
    const container = document.createElement("div");
    const tool = new OverlayTool(makeCanvas(), makeHistory(), makeOptions());
    tool.setContext({
      overlayContainer: container,
      elementTree: undefined,
      existingOverlays: [],
      mountSnapshotPicker: () => ({ element: document.createElement("div"), unmount: () => {} }),
      openIntentDialog: async (p) => {
        order.push("dialog-resolved");
        return {
          id: `o${p.proposedNumber}`,
          kind: "numberedBadge",
          match: p.proposedMatch,
          number: p.proposedNumber,
        };
      },
      onCommit: async () => {
        order.push("commit-start");
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("commit-done");
      },
    });
    await tool.handlePick(DETAIL);
    expect(order).toEqual(["dialog-resolved", "commit-start", "commit-done"]);
  });
});

describe("OverlayTool activation lifecycle", () => {
  it("onActivate mounts the picker into overlayContainer", () => {
    const h = makeHarness();
    h.tool.onActivate();
    expect(h.mountedPickers).toHaveLength(1);
    expect(h.container.contains(h.mountedPickers[0]!)).toBe(true);
  });

  it("onDeactivate unmounts the picker", () => {
    const h = makeHarness();
    h.tool.onActivate();
    h.tool.onDeactivate();
    expect(h.unmountSpy).toHaveBeenCalledTimes(1);
    expect(h.mountedPickers[0]?.isConnected).toBe(false);
  });

  it("dispatching overlay-region-pick on the mounted picker triggers handlePick", async () => {
    const h = makeHarness();
    h.tool.onActivate();
    const picker = h.mountedPickers[0]!;
    picker.dispatchEvent(
      new CustomEvent<OverlayRegionPickDetail>("overlay-region-pick", {
        detail: {
          ref: "e2",
          role: "textbox",
          name: "Email",
          bbox: { x: 100, y: 200, width: 300, height: 40 },
        },
        bubbles: true,
        composed: true,
      }),
    );
    // Event handler kicks off a Promise chain via `void handlePick(detail)`;
    // give the microtask queue a chance to drain before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.openIntentDialog).toHaveBeenCalledTimes(1);
    expect(h.onCommit).toHaveBeenCalledTimes(1);
  });

  it("setContext while active re-mounts the picker", () => {
    const h = makeHarness({ elementTree: makeTree() });
    h.tool.onActivate();
    expect(h.mountedPickers).toHaveLength(1);
    expect(h.unmountSpy).not.toHaveBeenCalled();
    // Provide a fresh context — pickers re-mount.
    const newContext: OverlayToolContext = {
      overlayContainer: h.container,
      elementTree: undefined,
      existingOverlays: [],
      mountSnapshotPicker: (c) => {
        const el = document.createElement("div");
        c.appendChild(el);
        h.mountedPickers.push(el);
        return { element: el, unmount: () => h.unmountSpy() };
      },
      openIntentDialog: h.openIntentDialog,
      onCommit: h.onCommit,
    };
    h.tool.setContext(newContext);
    expect(h.unmountSpy).toHaveBeenCalledTimes(1);
    expect(h.mountedPickers).toHaveLength(2);
  });
});
