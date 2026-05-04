// @vitest-environment happy-dom
//
// Phase 6 of `docs/plans/_done/vscode-extension-host.md` — CI
// invariant for guardrail #10 in CLAUDE.md.
//
// Asserts that the editor-shell surface NEVER reaches into a
// PWA-shell DOM id at module-load time or via the documented
// shell API. The shell mounts into a host-supplied container;
// any `document.getElementById("svg-root")` /
// `getElementById("canvas-container")` / etc. call is a host
// concern that belongs in the consumer (PWA's `EditorSession`
// etc.), not in editor-shell itself.
//
// How this works:
//
//   1. Wrap `document.getElementById` with a spy that records
//      every id queried.
//   2. Import the editor-shell surface (root + every documented
//      subpath that the PWA + VSCode consume).
//   3. Construct an `EditorShell` against a synthetic container
//      and exercise its public methods.
//   4. Assert that no recorded id matches the forbidden set.
//
// Adding a new PWA-shell DOM id reach into editor-shell breaks
// this test. Two correct fixes:
//   - Inject the value as a host parameter (preferred).
//   - Leave the call in the consumer (PWA's `EditorSession` etc.)
//     and have the shell expose a primitive that the consumer
//     drives.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import { EditorShell } from "./index.js";

const FORBIDDEN_IDS = new Set([
  // PWA index.html shell DOM ids — see
  // `packages/web/src/app.ts` + `packages/web/src/app/editor-session.ts`.
  "svg-root",
  "canvas-container",
  "statusbar",
  "file-manager",
  "editor-sidebar",
  // Tauri desktop's parallel ids (`packages/desktop/index.html`).
  "toolbar",
]);

const PNG_PIXEL =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function makeRecord(): ImageRecord {
  const now = new Date("2026-05-04T00:00:00Z").toISOString();
  return {
    path: "/test.annot.svg",
    folderPath: "/",
    width: 1,
    height: 1,
    originalDataUrl: PNG_PIXEL,
    annotationsSvg: "",
    sourceUrl: "",
    tags: {},
    createdAt: now,
    updatedAt: now,
  } as ImageRecord;
}

function makeStorage(record: ImageRecord = makeRecord()): StorageProvider {
  return {
    getImage: vi.fn(async () => record),
    updateImage: vi.fn(async () => {}),
  } as unknown as StorageProvider;
}

describe("editor-shell host-boundary invariant", () => {
  let originalGet: typeof document.getElementById;
  let queriedIds: string[];

  beforeEach(() => {
    queriedIds = [];
    originalGet = document.getElementById.bind(document);
    document.getElementById = (id: string) => {
      queriedIds.push(id);
      return originalGet(id);
    };
  });

  afterEach(() => {
    document.getElementById = originalGet;
  });

  it("constructing + opening + saving + destroying never queries a PWA-shell DOM id", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const shell = new EditorShell({
      container,
      storage: makeStorage(),
    });
    await shell.open("/test.annot.svg");
    await shell.saveNow();
    shell.destroy();

    const violations = queriedIds.filter((id) => FORBIDDEN_IDS.has(id));
    expect(
      violations,
      `editor-shell queried PWA-shell DOM id(s): ${violations.join(", ")}. ` +
        `These are host concerns; lift the call into the consumer or inject ` +
        `the value via the EditorShellHost contract. See CLAUDE.md guardrail #10.`,
    ).toEqual([]);
  });

  it("loading every documented subpath never queries a PWA-shell DOM id at module-load", async () => {
    // Importing each subpath triggers all its top-level side
    // effects (`customElements.define(...)`, etc.). Those side
    // effects must not reach into a PWA-shell DOM id.
    queriedIds = [];

    await import("./index.js");
    await import("./editor-shell.js");
    await import("./keyboard-help.js");
    await import("./ui-section.js");
    await import("./annot-icon.js");
    await import("./annot-icon-imperative.js");
    await import("./annot-tag-editor.js");
    await import("./annot-file-details-drawer.js");
    await import("./right-panel.js");
    await import("./toolbar.js");
    await import("./annot-toolbar.js");
    await import("./annot-tool-flyout.js");
    await import("./annot-save-menu.js");
    await import("./annot-scratchpad-section.js");
    await import("./scratchpad-paste-tool.js");
    await import("./scratchpad-utils.js");
    await import("./scratchpad-types.js");
    await import("./restore-annotations.js");
    await import("./editor-statusbar.js");

    const violations = queriedIds.filter((id) => FORBIDDEN_IDS.has(id));
    expect(
      violations,
      `editor-shell module-load reached PWA-shell DOM id(s): ${violations.join(", ")}.`,
    ).toEqual([]);
  });
});
