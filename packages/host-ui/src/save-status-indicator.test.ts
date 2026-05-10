/**
 * @vitest-environment happy-dom
 *
 * `<annot-save-status>` tests — the indicator's own contract
 * was unmodified pre-Phase-12; Phase 12 of
 * `docs/plans/annot-html-document-ux-polish.md` added the
 * `interactive` opt-in + the on-error Retry affordance, so
 * this file pins both behaviours.
 */

import { beforeEach, describe, expect, it } from "vitest";
import "./save-status-indicator.js";
import type { AnnotSaveStatusElement, SaveStatusRetryDetail } from "./save-status-indicator.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

async function mount(
  init: Partial<{ status: AnnotSaveStatusElement["status"]; interactive: boolean }> = {},
): Promise<AnnotSaveStatusElement> {
  const el = document.createElement("annot-save-status") as AnnotSaveStatusElement;
  el.status = init.status ?? "saved";
  el.interactive = init.interactive ?? false;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("annot-save-status", () => {
  it("renders the icon + label for each status", async () => {
    for (const status of ["saved", "pending", "saving", "error"] as const) {
      const el = await mount({ status });
      const label = el.querySelector(".save-status-label")?.textContent;
      expect(label).toBeTruthy();
      // Each status owns a distinct className the host stylesheet
      // keys off — pin so a typo there breaks the test.
      expect(el.className).toContain(`save-status-${status}`);
    }
  });

  it("does NOT render the Retry button by default (non-interactive)", async () => {
    const el = await mount({ status: "error" });
    expect(el.querySelector(".save-status-retry")).toBeNull();
  });

  it("renders the Retry button only on `error` when `interactive` is true", async () => {
    const el = await mount({ status: "saved", interactive: true });
    expect(el.querySelector(".save-status-retry")).toBeNull();
    el.status = "pending";
    await el.updateComplete;
    expect(el.querySelector(".save-status-retry")).toBeNull();
    el.status = "saving";
    await el.updateComplete;
    expect(el.querySelector(".save-status-retry")).toBeNull();
    el.status = "error";
    await el.updateComplete;
    expect(el.querySelector(".save-status-retry")).not.toBeNull();
  });

  it("clicking Retry dispatches `retry-save`", async () => {
    const el = await mount({ status: "error", interactive: true });
    const seen: SaveStatusRetryDetail[] = [];
    el.addEventListener("retry-save", (e) => {
      seen.push((e as CustomEvent<SaveStatusRetryDetail>).detail);
    });
    (el.querySelector(".save-status-retry") as HTMLButtonElement).click();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.reason).toBe("user-clicked-retry");
  });
});
