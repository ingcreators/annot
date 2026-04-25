// Pure-Node test for history-core: the snapshot model is a plain
// string, so we can drive it without any DOM at all.

import { describe, expect, it, vi } from "vitest";
import { createHistoryCore, DEFAULT_HISTORY_DEPTH } from "./history-core.js";

/**
 * Build a history core whose snapshots are read from / written to a
 * plain string ref. Returns the core, the live ref, and spies for
 * each callback so tests can assert call counts.
 */
function makeFixture(initial: string) {
  const ref = { value: initial };
  const onRestore = vi.fn();
  const onStateChange = vi.fn();
  const core = createHistoryCore({
    getSnapshot: () => ref.value,
    setSnapshot: (s) => {
      ref.value = s;
    },
    onRestore,
    onStateChange,
  });
  return { core, ref, onRestore, onStateChange };
}

describe("createHistoryCore — seeding", () => {
  it("captures the initial snapshot eagerly so the first edit can be undone", () => {
    const { core, onStateChange } = makeFixture("v0");
    // The constructor calls save() → fires onStateChange once for the seed.
    expect(onStateChange).toHaveBeenCalledTimes(1);
    expect(core.canUndo).toBe(false);
    expect(core.canRedo).toBe(false);
  });
});

describe("createHistoryCore — save", () => {
  it("makes canUndo true after the first post-seed save", () => {
    const { core, ref } = makeFixture("v0");
    ref.value = "v1";
    core.save();
    expect(core.canUndo).toBe(true);
    expect(core.canRedo).toBe(false);
  });

  it("clears the redo stack on a fresh save (the standard 'branch' behavior)", () => {
    const { core, ref } = makeFixture("v0");
    ref.value = "v1";
    core.save();
    core.undo();
    expect(core.canRedo).toBe(true);
    ref.value = "v2";
    core.save();
    expect(core.canRedo).toBe(false);
  });

  it("caps the undo stack at maxDepth", () => {
    const ref = { value: "0" };
    const core = createHistoryCore({
      getSnapshot: () => ref.value,
      setSnapshot: (s) => {
        ref.value = s;
      },
      maxDepth: 3,
    });
    // Seed (1) + saves "1", "2", "3" → total 4 → drop oldest → final 3.
    for (let i = 1; i <= 3; i++) {
      ref.value = String(i);
      core.save();
    }
    // 3 undos should walk us back through the survivors. After 2
    // undos canUndo should still be true; after the 3rd it flips false
    // because the seed (the dropped one was overwritten by FIFO so the
    // earliest surviving snapshot is actually "1").
    expect(core.undo()).toBe(true); // restores "2"
    expect(ref.value).toBe("2");
    expect(core.undo()).toBe(true); // restores "1"
    expect(ref.value).toBe("1");
    expect(core.undo()).toBe(false); // only the seed survives, guard rejects
  });

  it("defaults maxDepth to DEFAULT_HISTORY_DEPTH (100)", () => {
    const ref = { value: "0" };
    const core = createHistoryCore({
      getSnapshot: () => ref.value,
      setSnapshot: (s) => {
        ref.value = s;
      },
    });
    // Push 150 saves; we should be able to undo at most 99 times before
    // hitting the seed-guard (since maxDepth caps the total at 100).
    for (let i = 1; i <= 150; i++) {
      ref.value = String(i);
      core.save();
    }
    let undoCount = 0;
    while (core.undo()) undoCount++;
    expect(undoCount).toBe(DEFAULT_HISTORY_DEPTH - 1);
  });
});

describe("createHistoryCore — undo / redo", () => {
  it("walks back to the previous snapshot", () => {
    const { core, ref } = makeFixture("v0");
    ref.value = "v1";
    core.save();
    ref.value = "v2";
    core.save();
    expect(core.undo()).toBe(true);
    expect(ref.value).toBe("v1");
    expect(core.canUndo).toBe(true);
    expect(core.canRedo).toBe(true);
  });

  it("returns false when only the seed snapshot is left", () => {
    const { core, onRestore } = makeFixture("v0");
    expect(core.undo()).toBe(false);
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("redo returns false when the redo stack is empty", () => {
    const { core, onRestore } = makeFixture("v0");
    expect(core.redo()).toBe(false);
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("round-trip: 5 saves → 3 undos → 3 redos lands on the latest snapshot", () => {
    const { core, ref } = makeFixture("v0");
    for (let i = 1; i <= 5; i++) {
      ref.value = `v${i}`;
      core.save();
    }
    core.undo();
    core.undo();
    core.undo();
    expect(ref.value).toBe("v2");
    core.redo();
    core.redo();
    core.redo();
    expect(ref.value).toBe("v5");
  });
});

describe("createHistoryCore — callbacks", () => {
  it("onRestore fires on undo and redo, but NOT on save", () => {
    const { core, ref, onRestore } = makeFixture("v0");
    ref.value = "v1";
    core.save();
    expect(onRestore).not.toHaveBeenCalled();
    core.undo();
    expect(onRestore).toHaveBeenCalledTimes(1);
    core.redo();
    expect(onRestore).toHaveBeenCalledTimes(2);
  });

  it("onStateChange fires for every state-changing call (seed, save, undo, redo)", () => {
    const { core, ref, onStateChange } = makeFixture("v0");
    expect(onStateChange).toHaveBeenCalledTimes(1); // seed
    ref.value = "v1";
    core.save();
    expect(onStateChange).toHaveBeenCalledTimes(2);
    core.undo();
    expect(onStateChange).toHaveBeenCalledTimes(3);
    core.redo();
    expect(onStateChange).toHaveBeenCalledTimes(4);
  });

  it("onStateChange does NOT fire when undo/redo guard rejects the call", () => {
    const { core, onStateChange } = makeFixture("v0");
    const baseline = onStateChange.mock.calls.length;
    expect(core.undo()).toBe(false);
    expect(core.redo()).toBe(false);
    expect(onStateChange).toHaveBeenCalledTimes(baseline);
  });
});
