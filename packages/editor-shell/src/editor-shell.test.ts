// Phase 1 surface test for `@ingcreators/annot-editor-shell`.
// Runs under the default `node` environment — the constructor must
// not reach for `document` / `window` at import time, even though
// the eventual implementation is Tier C and needs a real browser
// to do anything useful.
//
// What this asserts:
//
//   1. The package loads cleanly from the documented entry path.
//   2. The exported `EditorShell` class accepts an
//      `EditorShellHost` shape that matches the documented
//      contract (compile-time check via the `host` literal below).
//   3. The Phase 1 stub methods throw / no-op as documented so
//      callers can't accidentally rely on them before Phase 3
//      lands the real bodies.

import { describe, expect, it } from "vitest";
import { EditorShell, type EditorShellHost } from "./index.js";

describe("@ingcreators/annot-editor-shell — Phase 1 stub", () => {
  it("constructs against a minimal host without throwing", () => {
    // We're under `node` so `document.createElement` is unavailable
    // — fake a container with the bare HTMLElement shape the
    // contract documents. The Phase 1 constructor never touches
    // it; Phase 3 will, at which point this test moves to
    // happy-dom.
    const host: EditorShellHost = {
      container: {} as HTMLElement,
      // Cast through unknown so the `node` env doesn't drag in the
      // full StorageProvider implementation just to typecheck the
      // shape. The contract test in core / web exercises real
      // backends.
      storage: {} as unknown as EditorShellHost["storage"],
    };
    const shell = new EditorShell(host);
    expect(shell).toBeInstanceOf(EditorShell);
  });

  it("open() rejects with a Phase 1 stub message", async () => {
    const shell = new EditorShell({
      container: {} as HTMLElement,
      storage: {} as unknown as EditorShellHost["storage"],
    });
    await expect(shell.open("/foo.annot.svg")).rejects.toThrow(/Phase 1 stub/);
  });

  it("saveNow() rejects with a Phase 1 stub message", async () => {
    const shell = new EditorShell({
      container: {} as HTMLElement,
      storage: {} as unknown as EditorShellHost["storage"],
    });
    await expect(shell.saveNow()).rejects.toThrow(/Phase 1 stub/);
  });

  it("getCurrentPageMetadata() returns null in the stub", () => {
    const shell = new EditorShell({
      container: {} as HTMLElement,
      storage: {} as unknown as EditorShellHost["storage"],
    });
    expect(shell.getCurrentPageMetadata()).toBeNull();
  });

  it("destroy() and on() are no-ops in the stub", () => {
    const shell = new EditorShell({
      container: {} as HTMLElement,
      storage: {} as unknown as EditorShellHost["storage"],
    });
    const dispose = shell.on("dirty", () => {});
    expect(typeof dispose).toBe("function");
    dispose();
    shell.destroy();
  });
});
