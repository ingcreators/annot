/**
 * @vitest-environment happy-dom
 *
 * `<annot-doc-empty-state>` tests — Phase 4 of
 * `docs/plans/annot-html-document-ux-polish.md`.
 */

import { beforeEach, describe, expect, it } from "vitest";
import "./annot-doc-empty-state.js";
import type {
  AnnotDocEmptyStateElement,
  EmptyStateAction,
  EmptyStateActionDetail,
} from "./annot-doc-empty-state.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

async function mount(): Promise<AnnotDocEmptyStateElement> {
  const el = document.createElement("annot-doc-empty-state") as AnnotDocEmptyStateElement;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("annot-doc-empty-state", () => {
  it("renders the four onboarding cards in order", async () => {
    const el = await mount();
    const cards = el.querySelectorAll<HTMLButtonElement>(".annot-doc-empty-state-card");
    expect(cards).toHaveLength(4);
    expect(cards[0]?.getAttribute("data-empty-action")).toBe("startWithHeading");
    expect(cards[1]?.getAttribute("data-empty-action")).toBe("insertImage");
    expect(cards[2]?.getAttribute("data-empty-action")).toBe("useTemplate");
    expect(cards[3]?.getAttribute("data-empty-action")).toBe("pasteHint");
  });

  it("dispatches empty-state-action with the right action on each card click", async () => {
    const el = await mount();
    const seen: EmptyStateAction[] = [];
    el.addEventListener("empty-state-action", (e) => {
      seen.push((e as CustomEvent<EmptyStateActionDetail>).detail.action);
    });
    const cards = el.querySelectorAll<HTMLButtonElement>(".annot-doc-empty-state-card");
    cards.forEach((c) => c.click());
    expect(seen).toEqual(["startWithHeading", "insertImage", "useTemplate", "pasteHint"]);
  });

  it("cards bubble + compose so a host can listen on a parent", async () => {
    const wrapper = document.createElement("div");
    document.body.appendChild(wrapper);
    const el = document.createElement("annot-doc-empty-state") as AnnotDocEmptyStateElement;
    wrapper.appendChild(el);
    await el.updateComplete;
    const seen: EmptyStateActionDetail[] = [];
    wrapper.addEventListener("empty-state-action", (e) => {
      seen.push((e as CustomEvent<EmptyStateActionDetail>).detail);
    });
    (el.querySelector('[data-empty-action="useTemplate"]') as HTMLButtonElement).click();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.action).toBe("useTemplate");
  });

  it("each card has an accessible label", async () => {
    const el = await mount();
    const cards = el.querySelectorAll<HTMLButtonElement>(".annot-doc-empty-state-card");
    for (const c of cards) {
      const title = c.querySelector(".annot-doc-empty-state-card-title");
      expect(title?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });
});
