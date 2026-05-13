// @vitest-environment happy-dom

/**
 * `<annot-capture-workspace>` — happy-dom mount tests covering the
 * paths reachable without a real `MediaStream`:
 *   - no-pending direct navigation surfaces the hint + exit button
 *   - workspace-exit propagates as a CustomEvent
 *   - a pending session that fails the `getDisplayMedia` Promise
 *     (the only case happy-dom can drive deterministically) lands
 *     in the `cancelled` state without throwing
 *
 * Live-stream paths (frame capture, track-ended) are exercised
 * during the manual verification step in
 * `docs/plans/web-capture-redesign.md`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./annot-capture-workspace.js";
import type { AnnotCaptureWorkspaceElement } from "./annot-capture-workspace.js";
import { clearCapturePendingSession, setCapturePendingSession } from "./capture-pending-session.js";

beforeEach(() => {
  clearCapturePendingSession();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearCapturePendingSession();
  document.body.querySelectorAll("annot-capture-workspace").forEach((el) => el.remove());
});

async function mountWorkspace(): Promise<AnnotCaptureWorkspaceElement> {
  const el = document.createElement("annot-capture-workspace") as AnnotCaptureWorkspaceElement;
  document.body.appendChild(el);
  // Wait two microtasks: connectedCallback awaits updateComplete +
  // then awaits the (mocked) getDisplayMedia Promise.
  await Promise.resolve();
  await el.updateComplete;
  await Promise.resolve();
  await el.updateComplete;
  return el;
}

describe("<annot-capture-workspace>", () => {
  it("renders the no-pending hint when no pending session was set", async () => {
    const el = await mountWorkspace();
    const empty = el.querySelector(".capture-workspace-empty");
    expect(empty).not.toBeNull();
    expect(empty?.textContent ?? "").toContain("No capture session in progress");
    const exitBtn = el.querySelector<HTMLButtonElement>(".capture-workspace-exit-btn");
    expect(exitBtn?.textContent ?? "").toContain("Back to gallery");
  });

  it("dispatches workspace-exit when the user clicks Back to gallery", async () => {
    const el = await mountWorkspace();
    const exited = vi.fn();
    el.addEventListener("workspace-exit", exited);
    el.querySelector<HTMLButtonElement>(".capture-workspace-empty-btn")?.click();
    expect(exited).toHaveBeenCalledTimes(1);
  });

  it("lands in the cancelled state when getDisplayMedia rejects (user dismissed picker)", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia: vi.fn().mockRejectedValue(new Error("cancelled")) },
    });
    setCapturePendingSession({ mode: "once", cursor: "always", folderPath: "Demo" });

    const el = await mountWorkspace();
    expect(el.state).toBe("cancelled");
    // Toolbar is hidden in non-sharing states.
    expect(el.querySelector("annot-capture-toolbar")).toBeNull();
    // Exit button is still reachable so the user can leave.
    const exited = vi.fn();
    el.addEventListener("workspace-exit", exited);
    el.querySelector<HTMLButtonElement>(".capture-workspace-exit-btn")?.click();
    expect(exited).toHaveBeenCalledTimes(1);
  });

  it("removing the element from the DOM doesn't throw (idempotent stop)", async () => {
    const el = await mountWorkspace();
    expect(() => el.remove()).not.toThrow();
  });
});
