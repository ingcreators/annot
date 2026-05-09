/**
 * Pure-Node tests for `DocumentHistory` — no DOM dependency.
 * Phase 4a of `docs/plans/annot-html-document.md`.
 */

import type { AnnotDocument } from "@ingcreators/annot-doc";
import { describe, expect, it } from "vitest";
import { DocumentHistory } from "./annot-doc-history.js";

function makeDoc(title: string): AnnotDocument {
  return {
    version: 1,
    lang: "en",
    title,
    meta: { title },
    styleBlock: null,
    blocks: [{ kind: "paragraph", inlineHtml: title }],
  };
}

describe("DocumentHistory: basic stack semantics", () => {
  it("starts with the initial doc and no undo history", () => {
    const h = new DocumentHistory(makeDoc("a"));
    expect(h.current().title).toBe("a");
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.size()).toBe(1);
  });

  it("push grows the stack and enables undo", () => {
    const h = new DocumentHistory(makeDoc("a"));
    h.push(makeDoc("b"));
    expect(h.current().title).toBe("b");
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
    expect(h.size()).toBe(2);
  });

  it("undo / redo walk the stack correctly", () => {
    const h = new DocumentHistory(makeDoc("a"));
    h.push(makeDoc("b"));
    h.push(makeDoc("c"));
    expect(h.current().title).toBe("c");

    expect(h.undo()?.title).toBe("b");
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(true);

    expect(h.undo()?.title).toBe("a");
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(true);

    expect(h.undo()).toBeNull();
    expect(h.current().title).toBe("a");

    expect(h.redo()?.title).toBe("b");
    expect(h.redo()?.title).toBe("c");
    expect(h.redo()).toBeNull();
  });

  it("push truncates the redo tail past the cursor", () => {
    const h = new DocumentHistory(makeDoc("a"));
    h.push(makeDoc("b"));
    h.push(makeDoc("c"));
    h.undo(); // back to "b"
    h.push(makeDoc("d"));
    expect(h.current().title).toBe("d");
    expect(h.canRedo()).toBe(false);
    // Redoing past d should not return c.
    expect(h.redo()).toBeNull();
  });

  it("identical-reference push is a no-op", () => {
    const a = makeDoc("a");
    const h = new DocumentHistory(a);
    h.push(a);
    h.push(a);
    expect(h.size()).toBe(1);
    expect(h.canUndo()).toBe(false);
  });
});

describe("DocumentHistory: limit", () => {
  it("trims from the head when exceeding the configured limit", () => {
    const h = new DocumentHistory(makeDoc("0"), { limit: 3 });
    h.push(makeDoc("1"));
    h.push(makeDoc("2"));
    h.push(makeDoc("3"));
    // Limit 3 means we keep only the 3 most recent entries.
    expect(h.size()).toBe(3);
    expect(h.current().title).toBe("3");
    // Cursor stays at the latest entry.
    expect(h.cursor()).toBe(2);
    // Undo walks back to "2" / "1" but never reaches "0".
    expect(h.undo()?.title).toBe("2");
    expect(h.undo()?.title).toBe("1");
    expect(h.undo()).toBeNull();
  });
});

describe("DocumentHistory: replaceCurrent", () => {
  it("swaps the current snapshot in place without pushing", () => {
    const h = new DocumentHistory(makeDoc("a"));
    h.push(makeDoc("b"));
    h.replaceCurrent(makeDoc("b-edit"));
    expect(h.current().title).toBe("b-edit");
    expect(h.size()).toBe(2);
    // Undo still returns the original "a" — the replace wasn't a
    // new history entry.
    expect(h.undo()?.title).toBe("a");
    expect(h.redo()?.title).toBe("b-edit");
  });
});
