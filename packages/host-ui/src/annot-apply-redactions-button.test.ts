/**
 * @vitest-environment happy-dom
 *
 * Tests for `<annot-apply-redactions-button>` (Phase 3 of
 * `docs/plans/_done/redact-burn-into-image.md`).
 *
 * The component delegates the modal to
 * `showConfirmDialog` from `./ui/dialog.js`; we mock that helper
 * via `vi.mock` so each test can drive the confirm result
 * deterministically without driving the dialog's own DOM.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dialogMocks = vi.hoisted(() => ({
  showConfirmDialog: vi.fn(),
}));

vi.mock("./ui/dialog.js", () => ({
  showConfirmDialog: dialogMocks.showConfirmDialog,
}));

const { showConfirmDialog } = dialogMocks;

import "./annot-apply-redactions-button.js";
import type {
  AnnotApplyRedactionsButtonElement,
  ApplyRedactionsAppliedDetail,
} from "./annot-apply-redactions-button.js";

function mountButton(
  count: number,
  onApply: (() => Promise<{ count: number }>) | null,
): AnnotApplyRedactionsButtonElement {
  const el = document.createElement(
    "annot-apply-redactions-button",
  ) as AnnotApplyRedactionsButtonElement;
  el.count = count;
  el.onApply = onApply;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  showConfirmDialog.mockReset();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("<annot-apply-redactions-button>", () => {
  it("renders a disabled button when count is 0", async () => {
    const el = mountButton(0, async () => ({ count: 0 }));
    await el.updateComplete;
    const btn = el.querySelector("button");
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(true);
    expect(btn?.getAttribute("title")).toBe("No redactions to apply");
    expect(btn?.classList.contains("annot-apply-redactions-btn")).toBe(true);
  });

  it("renders a disabled button when onApply is null", async () => {
    const el = mountButton(3, null);
    await el.updateComplete;
    expect(el.querySelector("button")?.disabled).toBe(true);
  });

  it("renders an enabled button when count > 0 and onApply is set", async () => {
    const el = mountButton(2, async () => ({ count: 2 }));
    await el.updateComplete;
    const btn = el.querySelector("button");
    expect(btn?.disabled).toBe(false);
    expect(btn?.getAttribute("title")).toBe("Apply 2 redaction(s) to image");
    expect(btn?.getAttribute("aria-label")).toBe("Apply redactions to image");
    expect(btn?.classList.contains("annot-apply-redactions-btn")).toBe(true);
  });

  it("renders a visible label inside the button", async () => {
    const el = mountButton(2, async () => ({ count: 2 }));
    await el.updateComplete;
    const label = el.querySelector(".annot-apply-redactions-label");
    expect(label).not.toBeNull();
    expect(label?.textContent).toContain("Apply redactions to image");
  });

  it("opens confirm dialog with the plan's body text on click", async () => {
    const onApply = vi.fn(async () => ({ count: 3 }));
    showConfirmDialog.mockResolvedValueOnce(false);
    const el = mountButton(3, onApply);
    await el.updateComplete;
    el.querySelector("button")?.click();
    // Wait for async click handler to settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(showConfirmDialog).toHaveBeenCalledTimes(1);
    const opts = showConfirmDialog.mock.calls[0]?.[0] as {
      title: string;
      message: string;
      okLabel: string;
      cancelLabel: string;
      danger: boolean;
    };
    expect(opts.title).toBe("Apply redactions to image?");
    expect(opts.message).toContain("3 redaction(s)");
    expect(opts.message).toContain("permanently baked");
    expect(opts.okLabel).toBe("Apply");
    expect(opts.cancelLabel).toBe("Cancel");
    expect(opts.danger).toBe(true);
    // Cancel path → onApply MUST NOT run.
    expect(onApply).not.toHaveBeenCalled();
  });

  it("calls onApply and dispatches `applied` event when confirmed", async () => {
    const onApply = vi.fn(async () => ({ count: 5 }));
    showConfirmDialog.mockResolvedValueOnce(true);
    const el = mountButton(5, onApply);
    await el.updateComplete;
    const appliedHandler = vi.fn();
    el.addEventListener("applied", appliedHandler as EventListener);

    el.querySelector("button")?.click();
    // Two microtask flushes: one for showConfirmDialog resolution,
    // one for onApply().
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(appliedHandler).toHaveBeenCalledTimes(1);
    const evt = appliedHandler.mock.calls[0]?.[0] as CustomEvent<ApplyRedactionsAppliedDetail>;
    expect(evt.detail.count).toBe(5);
  });

  it("rejects double-click while busy (dialog still open)", async () => {
    const onApply = vi.fn(async () => ({ count: 2 }));
    // First click → block on the dialog promise; second click is a
    // no-op because `#busy` is true.
    let resolveDialog!: (v: boolean) => void;
    showConfirmDialog.mockImplementationOnce(
      () =>
        new Promise<boolean>((r) => {
          resolveDialog = r;
        }),
    );
    const el = mountButton(2, onApply);
    await el.updateComplete;
    const btn = el.querySelector("button") as HTMLButtonElement;
    btn.click();
    await el.updateComplete;
    // While busy, the button is disabled — clicking has no effect.
    btn.click();
    await el.updateComplete;
    // Resolve the first dialog with cancel so onApply doesn't run.
    resolveDialog(false);
    await Promise.resolve();
    await Promise.resolve();
    // Only the first click reached showConfirmDialog. Second click
    // saw `#busy === true` AND a disabled button → no-op.
    expect(showConfirmDialog).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("does not fire `applied` event when confirm dialog is cancelled", async () => {
    const onApply = vi.fn(async () => ({ count: 1 }));
    showConfirmDialog.mockResolvedValueOnce(false);
    const el = mountButton(1, onApply);
    await el.updateComplete;
    const appliedHandler = vi.fn();
    el.addEventListener("applied", appliedHandler as EventListener);
    el.querySelector("button")?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(onApply).not.toHaveBeenCalled();
    expect(appliedHandler).not.toHaveBeenCalled();
  });
});
