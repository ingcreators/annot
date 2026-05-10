/**
 * @vitest-environment happy-dom
 *
 * `<annot-doc-header>` tests — Phase 1 of
 * `docs/plans/annot-html-document-ux-polish.md`.
 */

import { beforeEach, describe, expect, it } from "vitest";
import "./annot-doc-header.js";
import type {
  AnnotDocHeaderElement,
  DocHeaderCallbacks,
  DocHeaderOverflowAction,
} from "./annot-doc-header.js";

interface CallbackLog {
  back: number;
  undo: number;
  redo: number;
  insertImage: number;
  modeChanges: ("view" | "edit")[];
  titleCommits: string[];
  overflowSelections: DocHeaderOverflowAction[];
}

function emptyLog(): CallbackLog {
  return {
    back: 0,
    undo: 0,
    redo: 0,
    insertImage: 0,
    modeChanges: [],
    titleCommits: [],
    overflowSelections: [],
  };
}

function makeCallbacks(log: CallbackLog): DocHeaderCallbacks {
  return {
    onBack: () => {
      log.back += 1;
    },
    onUndo: () => {
      log.undo += 1;
    },
    onRedo: () => {
      log.redo += 1;
    },
    onInsertImage: () => {
      log.insertImage += 1;
    },
    onModeChange: (next) => {
      log.modeChanges.push(next);
    },
    onTitleCommit: (next) => {
      log.titleCommits.push(next);
    },
    onOverflowSelect: (action) => {
      log.overflowSelections.push(action);
    },
  };
}

async function mount(
  init?: Partial<AnnotDocHeaderElement> & { log?: CallbackLog },
): Promise<{ el: AnnotDocHeaderElement; log: CallbackLog }> {
  const log = init?.log ?? emptyLog();
  const el = document.createElement("annot-doc-header") as AnnotDocHeaderElement;
  el.documentTitle = init?.documentTitle ?? "Onboarding";
  el.mode = init?.mode ?? "edit";
  el.canUndo = init?.canUndo ?? true;
  el.canRedo = init?.canRedo ?? true;
  el.showBack = init?.showBack ?? true;
  el.showSaveStatus = init?.showSaveStatus ?? true;
  el.showModeToggle = init?.showModeToggle ?? true;
  el.overflowItems = init?.overflowItems ?? [
    { id: "exportPptx", label: "Export to PowerPoint…" },
    { id: "saveAsTemplate", label: "Save as template…" },
  ];
  el.callbacks = makeCallbacks(log);
  document.body.appendChild(el);
  await el.updateComplete;
  return { el, log };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("annot-doc-header", () => {
  it("renders the title, back button, save-status, and primary actions", async () => {
    const { el } = await mount();
    expect(el.querySelector(".annot-doc-header-back")).not.toBeNull();
    expect(el.querySelector(".annot-doc-header-title")?.textContent).toBe("Onboarding");
    expect(el.querySelector("annot-save-status")).not.toBeNull();
    expect(el.querySelector('[aria-label="Undo"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="Redo"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="Insert image"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="More actions"]')).not.toBeNull();
  });

  it("hides back / save-status / mode-toggle when their `show*` knobs are false", async () => {
    const { el } = await mount({
      showBack: false,
      showSaveStatus: false,
      showModeToggle: false,
    });
    expect(el.querySelector(".annot-doc-header-back")).toBeNull();
    expect(el.querySelector("annot-save-status")).toBeNull();
    expect(el.querySelector(".annot-doc-header-mode-toggle")).toBeNull();
  });

  it("disables Undo / Redo when canUndo / canRedo are false", async () => {
    const { el } = await mount({ canUndo: false, canRedo: false });
    const undo = el.querySelector('[aria-label="Undo"]') as HTMLButtonElement;
    const redo = el.querySelector('[aria-label="Redo"]') as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);
  });

  it("dispatches the right callback on each primary action click", async () => {
    const { el, log } = await mount();
    (el.querySelector(".annot-doc-header-back") as HTMLButtonElement).click();
    (el.querySelector('[aria-label="Undo"]') as HTMLButtonElement).click();
    (el.querySelector('[aria-label="Redo"]') as HTMLButtonElement).click();
    (el.querySelector('[aria-label="Insert image"]') as HTMLButtonElement).click();
    expect(log.back).toBe(1);
    expect(log.undo).toBe(1);
    expect(log.redo).toBe(1);
    expect(log.insertImage).toBe(1);
  });

  it("toggles the View / Edit pill via aria-pressed", async () => {
    const { el, log } = await mount({ mode: "edit" });
    const buttons = el.querySelectorAll<HTMLButtonElement>(".annot-doc-header-mode-toggle button");
    expect(buttons).toHaveLength(2);
    const [viewBtn, editBtn] = [buttons[0], buttons[1]] as [HTMLButtonElement, HTMLButtonElement];
    expect(viewBtn.getAttribute("aria-pressed")).toBe("false");
    expect(editBtn.getAttribute("aria-pressed")).toBe("true");
    viewBtn.click();
    editBtn.click();
    expect(log.modeChanges).toEqual(["view", "edit"]);
  });

  it("commits title edits on blur and never fires when text is unchanged", async () => {
    const { el, log } = await mount({ documentTitle: "Original" });
    const titleEl = el.querySelector<HTMLDivElement>(".annot-doc-header-title");
    if (!titleEl) throw new Error("title element missing");
    titleEl.textContent = "  Original  ";
    titleEl.dispatchEvent(new FocusEvent("blur"));
    expect(log.titleCommits).toEqual([]);
    titleEl.textContent = "  Renamed manual  ";
    titleEl.dispatchEvent(new FocusEvent("blur"));
    expect(log.titleCommits).toEqual(["Renamed manual"]);
  });

  it("Enter blurs the title field to commit", async () => {
    const { el, log } = await mount({ documentTitle: "Original" });
    const titleEl = el.querySelector<HTMLDivElement>(".annot-doc-header-title");
    if (!titleEl) throw new Error("title element missing");
    titleEl.textContent = "Renamed";
    titleEl.focus();
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    titleEl.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    // happy-dom Element.blur dispatches a real blur event, which
    // triggers `#onTitleBlur` via the Lit @blur listener.
    expect(log.titleCommits).toEqual(["Renamed"]);
  });

  it("opens the overflow menu, dispatches the action, then closes", async () => {
    const { el, log } = await mount();
    expect(el.querySelector(".annot-doc-header-overflow-menu")).toBeNull();
    (el.querySelector('[aria-label="More actions"]') as HTMLButtonElement).click();
    await el.updateComplete;
    const menu = el.querySelector(".annot-doc-header-overflow-menu");
    expect(menu).not.toBeNull();
    const items = el.querySelectorAll<HTMLButtonElement>(".annot-doc-header-overflow-item");
    expect(items).toHaveLength(2);
    items[0]?.click();
    await el.updateComplete;
    expect(log.overflowSelections).toEqual(["exportPptx"]);
    expect(el.querySelector(".annot-doc-header-overflow-menu")).toBeNull();
  });

  it("respects the disabled flag on overflow items", async () => {
    const { el, log } = await mount({
      overflowItems: [{ id: "exportPptx", label: "Export…", disabled: true }],
    });
    (el.querySelector('[aria-label="More actions"]') as HTMLButtonElement).click();
    await el.updateComplete;
    const item = el.querySelector(".annot-doc-header-overflow-item") as HTMLButtonElement | null;
    if (!item) throw new Error("overflow item missing");
    expect(item.disabled).toBe(true);
    item.click();
    expect(log.overflowSelections).toEqual([]);
  });

  it("hides the overflow ⋯ button when there are no overflow items", async () => {
    const { el } = await mount({ overflowItems: [] });
    expect(el.querySelector('[aria-label="More actions"]')).toBeNull();
  });

  it("closes the overflow menu when clicking another header button", async () => {
    const { el, log } = await mount();
    (el.querySelector('[aria-label="More actions"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.querySelector(".annot-doc-header-overflow-menu")).not.toBeNull();
    // happy-dom doesn't auto-fire the document click on the
    // microtask boundary, so simulate the outside click after
    // the toggle's queued listener has registered.
    await new Promise<void>((r) => queueMicrotask(r));
    const insertBtn = el.querySelector('[aria-label="Insert image"]') as HTMLButtonElement;
    insertBtn.click();
    await el.updateComplete;
    expect(log.insertImage).toBe(1);
    expect(el.querySelector(".annot-doc-header-overflow-menu")).toBeNull();
  });

  it("setTitleText updates the field when not focused, preserves typing when focused", async () => {
    const { el } = await mount({ documentTitle: "Initial" });
    const titleEl = el.querySelector<HTMLDivElement>(".annot-doc-header-title");
    if (!titleEl) throw new Error("title element missing");
    el.setTitleText("Programmatic");
    expect(titleEl.textContent).toBe("Programmatic");
    titleEl.focus();
    titleEl.textContent = "Mid-edit";
    el.setTitleText("Should-not-overwrite");
    expect(titleEl.textContent).toBe("Mid-edit");
  });

  it("getSaveStatusIndicator returns the inline save-status child", async () => {
    const { el } = await mount();
    const indicator = el.getSaveStatusIndicator();
    expect(indicator).not.toBeNull();
    if (indicator) {
      indicator.status = "saving";
      await indicator.updateComplete;
      expect(indicator.classList.contains("save-status-saving")).toBe(true);
    }
  });
});
