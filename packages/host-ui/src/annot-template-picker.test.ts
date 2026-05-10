/**
 * @vitest-environment happy-dom
 *
 * `<annot-template-picker>` — Phase 8c of
 * `docs/plans/annot-html-document.md`. Coverage:
 *
 *   - localStorage helpers (`readRecentTemplateIds`,
 *     `recordRecentTemplateId`, `forgetRecentTemplateId`):
 *     read / write / dedupe / cap-to-5 / quota-error
 *     resilience.
 *   - Element rendering: section headers, empty states (built-in
 *     "Coming soon" + user "No user templates yet"), card grid,
 *     loading state.
 *   - Recently-used row: appears when localStorage has IDs that
 *     resolve against a passed-in template; chips disappear when
 *     the underlying template is removed; click on chip emits the
 *     same event a card click would.
 *   - `template-selected` event payloads (user vs builtin
 *     discriminator).
 *   - Click on a card promotes the entry to recently-used.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AnnotTemplatePickerElement,
  type BuiltinTemplateEntry,
  forgetRecentTemplateId,
  readRecentTemplateIds,
  recordRecentTemplateId,
  type TemplateSelectedDetail,
  type UserTemplateEntry,
} from "./annot-template-picker.js";

const RECENT_KEY = "annot-template-picker-test-recent";

beforeEach(() => {
  globalThis.localStorage.clear();
});

afterEach(() => {
  for (const child of Array.from(document.body.children)) {
    child.remove();
  }
});

async function flush(): Promise<void> {
  // Lit's update cycle settles inside microtasks; one macrotask
  // hop is enough for the render to land.
  await new Promise((r) => setTimeout(r, 0));
}

describe("recently-used localStorage helpers", () => {
  it("readRecentTemplateIds returns empty when nothing's stored", () => {
    expect(readRecentTemplateIds(RECENT_KEY)).toEqual([]);
  });

  it("recordRecentTemplateId pushes to the front and dedupes", () => {
    recordRecentTemplateId("a", RECENT_KEY);
    recordRecentTemplateId("b", RECENT_KEY);
    recordRecentTemplateId("a", RECENT_KEY); // dedupe → moves to front
    expect(readRecentTemplateIds(RECENT_KEY)).toEqual(["a", "b"]);
  });

  it("recordRecentTemplateId caps the list at 5 entries", () => {
    for (const id of ["a", "b", "c", "d", "e", "f", "g"]) {
      recordRecentTemplateId(id, RECENT_KEY);
    }
    expect(readRecentTemplateIds(RECENT_KEY)).toEqual(["g", "f", "e", "d", "c"]);
  });

  it("forgetRecentTemplateId drops a single entry, leaving order intact", () => {
    recordRecentTemplateId("a", RECENT_KEY);
    recordRecentTemplateId("b", RECENT_KEY);
    recordRecentTemplateId("c", RECENT_KEY);
    forgetRecentTemplateId("b", RECENT_KEY);
    expect(readRecentTemplateIds(RECENT_KEY)).toEqual(["c", "a"]);
  });

  it("readRecentTemplateIds tolerates malformed JSON", () => {
    globalThis.localStorage.setItem(RECENT_KEY, "{not json");
    expect(readRecentTemplateIds(RECENT_KEY)).toEqual([]);
  });

  it("readRecentTemplateIds tolerates non-array stored value", () => {
    globalThis.localStorage.setItem(RECENT_KEY, JSON.stringify({ a: 1 }));
    expect(readRecentTemplateIds(RECENT_KEY)).toEqual([]);
  });

  it("readRecentTemplateIds filters non-string entries", () => {
    globalThis.localStorage.setItem(RECENT_KEY, JSON.stringify(["a", 42, "b", null]));
    expect(readRecentTemplateIds(RECENT_KEY)).toEqual(["a", "b"]);
  });
});

describe("<annot-template-picker> rendering", () => {
  it("registers the custom element on the global registry", () => {
    expect(customElements.get("annot-template-picker")).toBe(AnnotTemplatePickerElement);
  });

  it("renders both section headers always", async () => {
    const el = mountPicker({});
    await flush();
    const titles = Array.from(
      el.querySelectorAll<HTMLElement>(".annot-template-picker-section-title"),
    ).map((h) => h.textContent);
    expect(titles).toContain("Built-in");
    expect(titles).toContain("User templates");
  });

  it("shows the built-in 'coming soon' empty state when no built-ins", async () => {
    const el = mountPicker({});
    await flush();
    const emptyTexts = Array.from(
      el.querySelectorAll<HTMLElement>(".annot-template-picker-empty"),
    ).map((e) => e.textContent?.trim());
    expect(emptyTexts.some((t) => t?.includes("coming soon"))).toBe(true);
  });

  it("shows the user 'no user templates yet' empty state", async () => {
    const el = mountPicker({ userTemplates: [] });
    await flush();
    const emptyTexts = Array.from(
      el.querySelectorAll<HTMLElement>(".annot-template-picker-empty"),
    ).map((e) => e.textContent?.trim());
    expect(emptyTexts.some((t) => t?.includes("No user templates yet"))).toBe(true);
  });

  it("shows a loading placeholder when loadingUser=true", async () => {
    const el = mountPicker({ loadingUser: true });
    await flush();
    expect(el.querySelector(".annot-template-picker-loading")?.textContent?.trim()).toBe(
      "Loading…",
    );
    expect(el.querySelector(".annot-template-picker-empty")?.textContent?.trim()).toContain(
      "coming soon",
    );
  });

  it("renders a card per user template with title + description + tag chips", async () => {
    const userTemplates: UserTemplateEntry[] = [
      {
        path: "Templates/manual.annot.html",
        title: "Manual",
        description: "Step-by-step",
        tags: ["onboarding", "manual"],
      },
      {
        path: "Templates/feature-guide.annot.html",
        title: "Feature guide",
      },
    ];
    const el = mountPicker({ userTemplates });
    await flush();
    const cards = Array.from(el.querySelectorAll<HTMLElement>(".annot-template-picker-card"));
    expect(cards.length).toBe(2);
    const first = cards[0]!;
    expect(first.querySelector(".annot-template-picker-card-title")?.textContent).toBe("Manual");
    expect(first.querySelector(".annot-template-picker-card-desc")?.textContent).toBe(
      "Step-by-step",
    );
    const tags = Array.from(
      first.querySelectorAll<HTMLElement>(".annot-template-picker-card-tag"),
    ).map((t) => t.textContent);
    expect(tags).toEqual(["onboarding", "manual"]);
  });

  it("renders a built-in card with the 'Built-in' pill", async () => {
    const builtinTemplates: BuiltinTemplateEntry[] = [
      { id: "manual", title: "Manual", description: "Bundled starter" },
    ];
    const el = mountPicker({ builtinTemplates });
    await flush();
    const card = el.querySelector<HTMLElement>(".annot-template-picker-card-builtin")!;
    expect(card).not.toBeNull();
    expect(card.querySelector(".annot-template-picker-card-builtin-pill")?.textContent).toBe(
      "Built-in",
    );
    expect(card.querySelector(".annot-template-picker-card-title")?.textContent).toBe("Manual");
  });
});

describe("<annot-template-picker> recently-used row", () => {
  it("hides the recent row when localStorage has no entries", async () => {
    const el = mountPicker({
      userTemplates: [{ path: "Templates/x.annot.html", title: "X" }],
    });
    await flush();
    expect(el.querySelector(".annot-template-picker-recent")).toBeNull();
  });

  it("shows chips for IDs that resolve against the user list", async () => {
    recordRecentTemplateId("Templates/x.annot.html", RECENT_KEY);
    recordRecentTemplateId("Templates/y.annot.html", RECENT_KEY);
    const el = mountPicker({
      userTemplates: [
        { path: "Templates/x.annot.html", title: "X" },
        { path: "Templates/y.annot.html", title: "Y" },
      ],
    });
    await flush();
    const chips = Array.from(el.querySelectorAll<HTMLElement>(".annot-template-picker-chip"));
    // Most-recent first → y, then x.
    expect(chips.map((c) => c.textContent?.trim())).toEqual(["Y", "X"]);
  });

  it("skips chips whose underlying template is no longer present", async () => {
    recordRecentTemplateId("Templates/ghost.annot.html", RECENT_KEY);
    recordRecentTemplateId("Templates/x.annot.html", RECENT_KEY);
    const el = mountPicker({
      userTemplates: [{ path: "Templates/x.annot.html", title: "X" }],
    });
    await flush();
    const chips = Array.from(el.querySelectorAll<HTMLElement>(".annot-template-picker-chip"));
    expect(chips.map((c) => c.textContent?.trim())).toEqual(["X"]);
  });

  it("resolves chips against built-ins as well as user templates", async () => {
    recordRecentTemplateId("manual", RECENT_KEY);
    const el = mountPicker({
      builtinTemplates: [{ id: "manual", title: "Manual" }],
    });
    await flush();
    const chips = Array.from(el.querySelectorAll<HTMLElement>(".annot-template-picker-chip"));
    expect(chips.map((c) => c.textContent?.trim())).toEqual(["Manual"]);
  });
});

describe("<annot-template-picker> selection events", () => {
  it("emits user template-selected with the path on card click", async () => {
    const el = mountPicker({
      userTemplates: [{ path: "Templates/x.annot.html", title: "X" }],
    });
    await flush();
    const captured: TemplateSelectedDetail[] = [];
    el.addEventListener("template-selected", (e) =>
      captured.push((e as CustomEvent<TemplateSelectedDetail>).detail),
    );
    el.querySelector<HTMLButtonElement>(
      '.annot-template-picker-card[data-template-source="user"]',
    )!.click();
    expect(captured).toEqual([{ kind: "user", path: "Templates/x.annot.html" }]);
  });

  it("emits builtin template-selected with the id on card click", async () => {
    const el = mountPicker({
      builtinTemplates: [{ id: "manual", title: "Manual" }],
    });
    await flush();
    const captured: TemplateSelectedDetail[] = [];
    el.addEventListener("template-selected", (e) =>
      captured.push((e as CustomEvent<TemplateSelectedDetail>).detail),
    );
    el.querySelector<HTMLButtonElement>(
      '.annot-template-picker-card[data-template-source="builtin"]',
    )!.click();
    expect(captured).toEqual([{ kind: "builtin", id: "manual" }]);
  });

  it("emits the matching event on a recently-used chip click", async () => {
    recordRecentTemplateId("Templates/x.annot.html", RECENT_KEY);
    const el = mountPicker({
      userTemplates: [{ path: "Templates/x.annot.html", title: "X" }],
    });
    await flush();
    const captured: TemplateSelectedDetail[] = [];
    el.addEventListener("template-selected", (e) =>
      captured.push((e as CustomEvent<TemplateSelectedDetail>).detail),
    );
    el.querySelector<HTMLButtonElement>(".annot-template-picker-chip")!.click();
    expect(captured).toEqual([{ kind: "user", path: "Templates/x.annot.html" }]);
  });

  it("clicking a card promotes the entry to most-recently-used", async () => {
    recordRecentTemplateId("Templates/y.annot.html", RECENT_KEY);
    const el = mountPicker({
      userTemplates: [
        { path: "Templates/x.annot.html", title: "X" },
        { path: "Templates/y.annot.html", title: "Y" },
      ],
    });
    await flush();
    el.querySelector<HTMLButtonElement>(
      '.annot-template-picker-card[data-template-source="user"][data-template-id="Templates/x.annot.html"]',
    )!.click();
    expect(readRecentTemplateIds(RECENT_KEY)).toEqual([
      "Templates/x.annot.html",
      "Templates/y.annot.html",
    ]);
  });
});

// ---- helpers --------------------------------------------------------------

interface MountOptions {
  userTemplates?: readonly UserTemplateEntry[];
  builtinTemplates?: readonly BuiltinTemplateEntry[];
  loadingUser?: boolean;
}

function mountPicker(opts: MountOptions): AnnotTemplatePickerElement {
  const el = document.createElement("annot-template-picker") as AnnotTemplatePickerElement;
  el.userTemplates = opts.userTemplates ?? [];
  el.builtinTemplates = opts.builtinTemplates ?? [];
  el.loadingUser = opts.loadingUser ?? false;
  el.recentKey = RECENT_KEY;
  document.body.appendChild(el);
  return el;
}
