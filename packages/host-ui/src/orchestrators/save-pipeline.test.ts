/**
 * @vitest-environment happy-dom
 *
 * SavePipeline owns the debounce + concurrency-gate state machine
 * around `storage.updateImage`. The valuable test surface is:
 *
 *   - The error classifier (401 / 403 / 404 / offline / generic)
 *     drives the banner copy. Hosts wire `onSaveError` to whatever
 *     UI they ship, so the message strings ARE the contract.
 *   - The concurrency gate: a second `writeAnnotations()` while one
 *     is in flight queues a catch-up save instead of stacking.
 *   - The save-status indicator transitions saving → saved on
 *     success, saving → error on throw.
 *   - `flushPending()` resolves cleanly with nothing pending and
 *     drains both timers + the in-flight save when there is.
 *
 * `writeThumbnail` and the thumbnail debounce path are intentionally
 * out of scope here — they go through `getPngDataUrl(canvas)` which
 * raster-encodes via `<canvas>`, a happy-dom blind spot.
 */

import type { StorageProvider } from "@ingcreators/annot-core/storage";
import type { CanvasManager } from "@ingcreators/annot-editor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotSaveStatusElement } from "../save-status-indicator.js";
import { SavePipeline, type SavePipelineDeps } from "./save-pipeline.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Minimal CanvasManager substitute: `exportAnnotationsSvgForIdb` is
 * the only editor primitive `writeAnnotations` calls and it just
 * clones `canvas.svg` + reads `imageWidth` / `imageHeight`.
 */
function fakeCanvas(): CanvasManager {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  return { svg, imageWidth: 800, imageHeight: 600 } as unknown as CanvasManager;
}

interface DepsState {
  canvas: CanvasManager | null;
  storage: StorageProvider | null;
  path: string | null;
  tags: Record<string, string>;
  status: AnnotSaveStatusElement | null;
  errorCalls: Array<{ message: string; retry?: () => void }>;
  successCalls: number;
  beforeSaveCalls: Array<{ path: string; tags: Record<string, string> }>;
  afterSaveCalls: string[];
  beforeSaveImpl: () => Promise<void>;
}

function buildDeps(state: Partial<DepsState> = {}): {
  deps: SavePipelineDeps;
  state: DepsState;
} {
  // `??` collapses null and undefined together; tests for the
  // "path missing" / "canvas missing" branches need to pass an
  // explicit null override, so we use `in` checks instead so the
  // value is taken verbatim when the key is present.
  const s: DepsState = {
    canvas: "canvas" in state ? (state.canvas as DepsState["canvas"]) : fakeCanvas(),
    storage: "storage" in state ? (state.storage as DepsState["storage"]) : null,
    path: "path" in state ? (state.path as DepsState["path"]) : "Inbox/test.annot.svg",
    tags: state.tags ?? {},
    status: "status" in state ? (state.status as DepsState["status"]) : null,
    errorCalls: [],
    successCalls: 0,
    beforeSaveCalls: [],
    afterSaveCalls: [],
    beforeSaveImpl: state.beforeSaveImpl ?? (async () => {}),
  };
  const deps: SavePipelineDeps = {
    getStorage: () => s.storage,
    getCanvas: () => s.canvas,
    getCurrentImagePath: () => s.path,
    getCurrentTags: () => s.tags,
    getStatusIndicator: () => s.status,
    getThumbnailManager: () => null,
    notifyBeforeSave: async (path, tags) => {
      s.beforeSaveCalls.push({ path, tags });
      await s.beforeSaveImpl();
    },
    onAfterSave: (path) => {
      s.afterSaveCalls.push(path);
    },
    onSaveError: (message, retry) => {
      s.errorCalls.push({ message, retry });
    },
    onSaveSuccess: () => {
      s.successCalls += 1;
    },
  };
  return { deps, state: s };
}

/** Build a `StorageProvider`-shaped stub with a controllable
 *  `updateImage`. Only `updateImage` is touched by `writeAnnotations`. */
function fakeStorage(updateImage: StorageProvider["updateImage"]): StorageProvider {
  return { updateImage } as unknown as StorageProvider;
}

function fakeStatusIndicator(): AnnotSaveStatusElement {
  return { status: "saved" } as unknown as AnnotSaveStatusElement;
}

describe("SavePipeline.hasPendingWork", () => {
  it("starts false on a fresh pipeline", () => {
    const { deps } = buildDeps();
    const sp = new SavePipeline(deps);
    expect(sp.hasPendingWork()).toBe(false);
  });
});

describe("SavePipeline.scheduleAnnotationSave (debounce)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flips hasPendingWork() true while the debounce timer is armed", () => {
    const { deps } = buildDeps();
    const sp = new SavePipeline(deps);
    sp.scheduleAnnotationSave(500);
    expect(sp.hasPendingWork()).toBe(true);
  });

  it("coalesces consecutive scheduleAnnotationSave calls into one save", async () => {
    const updateImage = vi.fn().mockResolvedValue(undefined);
    const { deps, state } = buildDeps({ storage: fakeStorage(updateImage) });
    const sp = new SavePipeline(deps);
    sp.scheduleAnnotationSave(500);
    sp.scheduleAnnotationSave(500);
    sp.scheduleAnnotationSave(500);
    await vi.advanceTimersByTimeAsync(600);
    expect(updateImage).toHaveBeenCalledTimes(1);
    expect(state.successCalls).toBe(1);
  });
});

describe("SavePipeline.cancelAutoSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops the pending debounce timer without firing the save", async () => {
    // The redact-burn-into-image fix path: applyAllRedactions cancels
    // any armed autosave so its own `storage.updateImage(BURNED)` is
    // the only call that lands. Without this gate, on slow backends
    // (Drive) the debounce timer fires DURING the apply's PATCH, the
    // debounced save reads a stale `originalDataUrl` from the cache,
    // and PATCHes pre-burn bytes — which can land AFTER apply's
    // PATCH on the wire and overwrite the burned bitmap.
    const updateImage = vi.fn().mockResolvedValue(undefined);
    const { deps } = buildDeps({ storage: fakeStorage(updateImage) });
    const sp = new SavePipeline(deps);
    sp.scheduleAnnotationSave(500);
    expect(sp.hasPendingWork()).toBe(true);
    sp.cancelAutoSave();
    expect(sp.hasPendingWork()).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(updateImage).not.toHaveBeenCalled();
  });

  it("is a no-op when no timer is armed", () => {
    const { deps } = buildDeps();
    const sp = new SavePipeline(deps);
    expect(() => sp.cancelAutoSave()).not.toThrow();
    expect(sp.hasPendingWork()).toBe(false);
  });

  it("can be re-armed after cancellation (cancel doesn't poison the pipeline)", async () => {
    const updateImage = vi.fn().mockResolvedValue(undefined);
    const { deps } = buildDeps({ storage: fakeStorage(updateImage) });
    const sp = new SavePipeline(deps);
    sp.scheduleAnnotationSave(500);
    sp.cancelAutoSave();
    sp.scheduleAnnotationSave(500);
    await vi.advanceTimersByTimeAsync(600);
    expect(updateImage).toHaveBeenCalledTimes(1);
  });
});

describe("SavePipeline.writeAnnotations — happy path", () => {
  it("returns early when storage is missing (no save attempt)", async () => {
    const updateImage = vi.fn();
    const { deps } = buildDeps({ storage: null });
    const sp = new SavePipeline(deps);
    await sp.writeAnnotations();
    expect(updateImage).not.toHaveBeenCalled();
  });

  it("returns early when canvas is missing", async () => {
    const updateImage = vi.fn();
    const { deps } = buildDeps({ canvas: null, storage: fakeStorage(updateImage) });
    const sp = new SavePipeline(deps);
    await sp.writeAnnotations();
    expect(updateImage).not.toHaveBeenCalled();
  });

  it("returns early when current path is missing", async () => {
    const updateImage = vi.fn();
    const { deps } = buildDeps({ path: null, storage: fakeStorage(updateImage) });
    const sp = new SavePipeline(deps);
    await sp.writeAnnotations();
    expect(updateImage).not.toHaveBeenCalled();
  });

  it("calls storage.updateImage with annotationsSvg + tags + the current path", async () => {
    const updateImage = vi.fn().mockResolvedValue(undefined);
    const tags = { project: "demo", note: "hi" };
    const { deps } = buildDeps({ storage: fakeStorage(updateImage), tags });
    const sp = new SavePipeline(deps);
    await sp.writeAnnotations();
    expect(updateImage).toHaveBeenCalledTimes(1);
    const [path, updates] = updateImage.mock.calls[0]!;
    expect(path).toBe("Inbox/test.annot.svg");
    expect(updates).toMatchObject({ tags });
    expect(typeof updates.annotationsSvg).toBe("string");
    expect(updates.annotationsSvg).toContain("<svg");
  });

  it("drives the save-status indicator through saving → saved", async () => {
    const updateImage = vi.fn().mockResolvedValue(undefined);
    const observed: string[] = [];
    const status = new Proxy({ status: "saved" } as { status: string }, {
      set(t, k, v) {
        if (k === "status") observed.push(String(v));
        Reflect.set(t, k, v);
        return true;
      },
    }) as unknown as AnnotSaveStatusElement;
    const { deps } = buildDeps({ storage: fakeStorage(updateImage), status });
    const sp = new SavePipeline(deps);
    await sp.writeAnnotations();
    expect(observed).toEqual(["saving", "saved"]);
  });

  it("calls onSaveSuccess + onAfterSave with the path on success", async () => {
    const updateImage = vi.fn().mockResolvedValue(undefined);
    const { deps, state } = buildDeps({ storage: fakeStorage(updateImage) });
    const sp = new SavePipeline(deps);
    await sp.writeAnnotations();
    expect(state.successCalls).toBe(1);
    expect(state.afterSaveCalls).toEqual(["Inbox/test.annot.svg"]);
  });

  it("calls notifyBeforeSave first; a rejection routes through onSaveError instead of updateImage", async () => {
    const updateImage = vi.fn().mockResolvedValue(undefined);
    const { deps, state } = buildDeps({
      storage: fakeStorage(updateImage),
      beforeSaveImpl: async () => {
        throw new Error("plugin veto");
      },
    });
    const sp = new SavePipeline(deps);
    await sp.writeAnnotations();
    expect(updateImage).not.toHaveBeenCalled();
    expect(state.errorCalls.length).toBe(1);
    expect(state.errorCalls[0]!.message).toContain("plugin veto");
  });
});

describe("SavePipeline.writeAnnotations — error classification", () => {
  it("401 surfaces the 'session expired' message + retry callback", async () => {
    const err = Object.assign(new Error("auth expired"), { status: 401 });
    const updateImage = vi.fn().mockRejectedValue(err);
    const { deps, state } = buildDeps({ storage: fakeStorage(updateImage) });
    const sp = new SavePipeline(deps);
    await sp.writeAnnotations();
    expect(state.errorCalls.length).toBe(1);
    expect(state.errorCalls[0]!.message).toMatch(/session expired/i);
    expect(typeof state.errorCalls[0]!.retry).toBe("function");
  });

  it("403 surfaces 'Permission denied' (no retry — it won't help)", async () => {
    const err = Object.assign(new Error("forbidden"), { status: 403 });
    const updateImage = vi.fn().mockRejectedValue(err);
    const { deps, state } = buildDeps({ storage: fakeStorage(updateImage) });
    const sp = new SavePipeline(deps);
    await sp.writeAnnotations();
    expect(state.errorCalls[0]!.message).toMatch(/Permission denied/i);
    expect(state.errorCalls[0]!.retry).toBeUndefined();
  });

  it("404 surfaces 'not found'", async () => {
    const err = Object.assign(new Error("missing"), { status: 404 });
    const updateImage = vi.fn().mockRejectedValue(err);
    const { deps, state } = buildDeps({ storage: fakeStorage(updateImage) });
    const sp = new SavePipeline(deps);
    await sp.writeAnnotations();
    expect(state.errorCalls[0]!.message).toMatch(/not found/i);
  });

  it("offline surfaces 'You are offline' with a retry", async () => {
    const updateImage = vi.fn().mockRejectedValue(new Error("net"));
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => false,
    });
    const { deps, state } = buildDeps({ storage: fakeStorage(updateImage) });
    const sp = new SavePipeline(deps);
    try {
      await sp.writeAnnotations();
    } finally {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => true,
      });
    }
    expect(state.errorCalls[0]!.message).toMatch(/offline/i);
    expect(typeof state.errorCalls[0]!.retry).toBe("function");
  });

  it("generic error surfaces 'Save failed: <message>' with a retry", async () => {
    const updateImage = vi.fn().mockRejectedValue(new Error("Boom"));
    const { deps, state } = buildDeps({ storage: fakeStorage(updateImage) });
    const sp = new SavePipeline(deps);
    await sp.writeAnnotations();
    expect(state.errorCalls[0]!.message).toBe("Save failed: Boom");
    expect(typeof state.errorCalls[0]!.retry).toBe("function");
  });

  it("flips status indicator to error on throw", async () => {
    const updateImage = vi.fn().mockRejectedValue(new Error("nope"));
    const status = fakeStatusIndicator();
    const { deps } = buildDeps({ storage: fakeStorage(updateImage), status });
    const sp = new SavePipeline(deps);
    await sp.writeAnnotations();
    expect(status.status).toBe("error");
  });
});

describe("SavePipeline concurrency gate", () => {
  it("second writeAnnotations during the first sets savePending; both saves complete", async () => {
    let release1: (() => void) | null = null;
    const slow1 = new Promise<void>((res) => {
      release1 = res;
    });
    const updateImage = vi
      .fn<StorageProvider["updateImage"]>()
      .mockReturnValueOnce(slow1)
      .mockResolvedValueOnce(undefined);
    const { deps, state } = buildDeps({ storage: fakeStorage(updateImage) });
    const sp = new SavePipeline(deps);

    const first = sp.writeAnnotations();
    // Let the first call progress past `await notifyBeforeSave` so it
    // reaches `await storage.updateImage(...)` and `updateImage` is
    // actually invoked. Two microtask flushes cover the worst-case
    // queue depth (notifyBeforeSave + the `try` enter).
    await Promise.resolve();
    await Promise.resolve();
    // Second call lands while #saveInFlight is true → marks #savePending
    // and returns immediately without invoking updateImage a second time.
    await sp.writeAnnotations();
    expect(updateImage).toHaveBeenCalledTimes(1);
    expect(sp.hasPendingWork()).toBe(true);

    // Release the first save: catch-up triggers a second updateImage call.
    release1!();
    await first;
    // Wait microtasks so the catch-up writeAnnotations can complete.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(updateImage).toHaveBeenCalledTimes(2);
    expect(state.successCalls).toBe(2);
  });
});

describe("SavePipeline.flushPending", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately when nothing is pending", async () => {
    const { deps } = buildDeps();
    const sp = new SavePipeline(deps);
    await expect(sp.flushPending()).resolves.toBeUndefined();
  });

  it("cancels the autosave timer + runs the save inline", async () => {
    const updateImage = vi.fn().mockResolvedValue(undefined);
    const { deps } = buildDeps({ storage: fakeStorage(updateImage) });
    const sp = new SavePipeline(deps);
    sp.scheduleAnnotationSave(10_000); // long-armed; won't fire on its own
    expect(updateImage).not.toHaveBeenCalled();
    const flushed = sp.flushPending();
    // Drain queued microtasks driven by the awaited writeAnnotations.
    await vi.runOnlyPendingTimersAsync();
    await flushed;
    expect(updateImage).toHaveBeenCalledTimes(1);
    expect(sp.hasPendingWork()).toBe(false);
  });
});
