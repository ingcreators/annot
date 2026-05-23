// @vitest-environment happy-dom
//
// EditorShell overlay-tool wiring tests — Phase 4e + 4f of
// `docs/plans/living-spec-authoring-roadmap.md`. Drives the full
// 4a→4e surface against an in-memory storage stub:
//
//   - mountFromRecord({ annotationsYamlPath }) loads the existing
//     sidecar yaml via the Phase 4b loader.
//   - getCurrentAnnotationsYaml() returns the loaded state.
//   - publishOverlay(entry) writes via the Phase 4b writer.
//   - createOverlayToolContext({...}) returns a ready-to-use
//     `OverlayToolContext` snapshotting the shell's state.
//   - The factory + tool flow: tool.setContext + tool.handlePick
//     → openIntentDialog → onCommit → publishOverlay → store.
//
// Plus the Phase 4f publishFlatPng surface: `getPngDataUrl` is
// mocked because happy-dom doesn't drive the SVG→<img>→canvas
// rasterization path; the test stubs it to assert the
// flattenEditablePng round-trip.

import type { ImageRecord, StorageProvider } from "@ingcreators/annot-core/storage";
import type { CanvasManager } from "@ingcreators/annot-editor";
import { type OverlayEntry, OverlayTool } from "@ingcreators/annot-editor/tools/overlay-tool";
import {
  type AnnotationsFile,
  parseAnnotationsYaml,
} from "@ingcreators/annot-product-docs/annotations-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const editorMocks = vi.hoisted(() => ({
  getPngDataUrl: vi.fn<(canvas: CanvasManager) => Promise<string>>(),
}));

vi.mock("@ingcreators/annot-editor", async () => {
  const actual = await vi.importActual<typeof import("@ingcreators/annot-editor")>(
    "@ingcreators/annot-editor",
  );
  return {
    ...actual,
    getPngDataUrl: editorMocks.getPngDataUrl,
  };
});

import { EditorShell } from "./editor-shell.js";

const PNG_PIXEL =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const SAMPLE_YAML = `version: 1
overlays:
  - id: o1
    kind: numberedBadge
    match:
      role: textbox
      name: Email
    intent: required
    number: 1
`;

function makeRecord(overrides: Partial<ImageRecord> = {}): ImageRecord {
  const now = new Date("2026-05-23T00:00:00Z").toISOString();
  return {
    path: "/shots/login.png",
    folderPath: "/shots",
    width: 1,
    height: 1,
    originalDataUrl: PNG_PIXEL,
    annotationsSvg: "",
    sourceUrl: "",
    tags: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ImageRecord;
}

interface YamlStoreState {
  storage: StorageProvider;
  sidecars: Map<string, string>;
}

function makeYamlStorage(
  record: ImageRecord,
  initialSidecars: Record<string, string> = {},
): YamlStoreState {
  const sidecars = new Map<string, string>(Object.entries(initialSidecars));
  const storage = {
    getImage: vi.fn(async (path: string) => (path === record.path ? record : undefined)),
    updateImage: vi.fn(async () => {}),
    saveDocument: vi.fn(async () => ""),
    getDocument: vi.fn(async () => undefined),
    listDocuments: vi.fn(async () => []),
    updateDocument: vi.fn(async () => {}),
    async getAnnotationsYaml(pngPath: string): Promise<string | undefined> {
      return sidecars.get(pngPath);
    },
    async setAnnotationsYaml(pngPath: string, content: string): Promise<void> {
      sidecars.set(pngPath, content);
    },
  } as unknown as StorageProvider;
  return { storage, sidecars };
}

function makeContainer(): HTMLElement {
  const c = document.createElement("div");
  document.body.appendChild(c);
  return c;
}

beforeEach(() => {
  document.body.innerHTML = "";
  editorMocks.getPngDataUrl.mockReset();
});

afterEach(() => {});

describe("EditorShell — Phase 4e annotations YAML wiring", () => {
  it("loads existing annotations yaml on mountFromRecord with annotationsYamlPath", async () => {
    const record = makeRecord();
    const { storage } = makeYamlStorage(record, { [record.path]: SAMPLE_YAML });
    const container = makeContainer();
    const shell = new EditorShell({ container, storage });

    shell.mountFromRecord(record.path, record, { annotationsYamlPath: record.path });
    expect(shell.getCurrentAnnotationsYaml()).toBeNull(); // still loading
    await shell.loadAnnotations();
    const loaded = shell.getCurrentAnnotationsYaml();
    expect(loaded).not.toBeNull();
    expect(loaded?.overlays).toHaveLength(1);
    expect(loaded?.overlays[0]?.id).toBe("o1");
    shell.destroy();
  });

  it("returns null when no annotationsYamlPath is supplied", async () => {
    const record = makeRecord();
    const { storage } = makeYamlStorage(record);
    const container = makeContainer();
    const shell = new EditorShell({ container, storage });
    shell.mountFromRecord(record.path, record);
    await shell.loadAnnotations();
    expect(shell.getCurrentAnnotationsYaml()).toBeNull();
    shell.destroy();
  });

  it("publishOverlay upserts the entry and persists via the writer", async () => {
    const record = makeRecord();
    const { storage, sidecars } = makeYamlStorage(record, { [record.path]: SAMPLE_YAML });
    const container = makeContainer();
    const shell = new EditorShell({ container, storage });
    shell.mountFromRecord(record.path, record, { annotationsYamlPath: record.path });
    await shell.loadAnnotations();

    const newEntry: OverlayEntry = {
      id: "o2",
      kind: "numberedBadge",
      match: { role: "textbox", name: "Password" },
      intent: "required",
      number: 2,
    };
    await shell.publishOverlay(newEntry);

    const persisted = sidecars.get(record.path);
    expect(persisted).toBeDefined();
    const parsed: AnnotationsFile = parseAnnotationsYaml(persisted!);
    expect(parsed.overlays).toHaveLength(2);
    expect(parsed.overlays[1]?.id).toBe("o2");

    // The in-memory state mirrors the persisted state.
    expect(shell.getCurrentAnnotationsYaml()?.overlays).toHaveLength(2);
    shell.destroy();
  });

  it("publishOverlay replaces an existing entry by id (idempotent upsert)", async () => {
    const record = makeRecord();
    const { storage, sidecars } = makeYamlStorage(record, { [record.path]: SAMPLE_YAML });
    const container = makeContainer();
    const shell = new EditorShell({ container, storage });
    shell.mountFromRecord(record.path, record, { annotationsYamlPath: record.path });
    await shell.loadAnnotations();

    const replacement: OverlayEntry = {
      id: "o1",
      kind: "numberedBadge",
      match: { role: "textbox", name: "Email" },
      intent: "action", // changed from "required"
      number: 1,
    };
    await shell.publishOverlay(replacement);
    const parsed = parseAnnotationsYaml(sidecars.get(record.path)!);
    expect(parsed.overlays).toHaveLength(1);
    expect(parsed.overlays[0]?.intent).toBe("action");
    shell.destroy();
  });

  it("publishOverlay throws when no annotationsYamlPath is set", async () => {
    const record = makeRecord();
    const { storage } = makeYamlStorage(record);
    const container = makeContainer();
    const shell = new EditorShell({ container, storage });
    shell.mountFromRecord(record.path, record);
    await expect(
      shell.publishOverlay({
        id: "o1",
        kind: "numberedBadge",
        match: { role: "textbox" },
        number: 1,
      }),
    ).rejects.toThrow(/annotationsYamlPath/);
    shell.destroy();
  });

  it("createOverlayToolContext returns null when no annotationsYamlPath set", async () => {
    const record = makeRecord();
    const { storage } = makeYamlStorage(record);
    const container = makeContainer();
    const shell = new EditorShell({ container, storage });
    shell.mountFromRecord(record.path, record);
    const ctx = shell.createOverlayToolContext({
      overlayContainer: container,
      openIntentDialog: async () => null,
    });
    expect(ctx).toBeNull();
    shell.destroy();
  });

  it("createOverlayToolContext snapshots existing overlays + wires onCommit to publishOverlay", async () => {
    const record = makeRecord();
    const { storage, sidecars } = makeYamlStorage(record, { [record.path]: SAMPLE_YAML });
    const container = makeContainer();
    const shell = new EditorShell({ container, storage });
    shell.mountFromRecord(record.path, record, { annotationsYamlPath: record.path });
    await shell.loadAnnotations();

    const ctx = shell.createOverlayToolContext({
      overlayContainer: container,
      openIntentDialog: async (proposal) => ({
        id: `o${proposal.proposedNumber}`,
        kind: "numberedBadge",
        match: proposal.proposedMatch,
        intent: "info",
        number: proposal.proposedNumber,
      }),
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.existingOverlays).toHaveLength(1);
    expect(ctx!.existingOverlays[0]?.id).toBe("o1");

    // Drive onCommit directly — production path is the OverlayTool's
    // handlePick chain, but the same callback runs at the end of it.
    await ctx!.onCommit({
      id: "o2",
      kind: "numberedBadge",
      match: { role: "button", name: "Sign in" },
      intent: "info",
      number: 2,
    });
    const parsed = parseAnnotationsYaml(sidecars.get(record.path)!);
    expect(parsed.overlays).toHaveLength(2);
    expect(parsed.overlays[1]?.id).toBe("o2");
    shell.destroy();
  });

  it("end-to-end: mount → OverlayTool.handlePick → publishOverlay → store", async () => {
    const record = makeRecord();
    const { storage, sidecars } = makeYamlStorage(record);
    const container = makeContainer();
    const shell = new EditorShell({ container, storage });
    shell.mountFromRecord(record.path, record, { annotationsYamlPath: record.path });
    await shell.loadAnnotations(); // initial yaml is empty (no sidecar)

    // Build the tool with a stubbed dialog that auto-confirms with
    // intent "required". The shell's createOverlayToolContext
    // supplies everything else.
    const dialogStub = vi.fn(
      async (proposal: {
        proposedMatch: { role: string; name?: string };
        proposedNumber: number;
      }) => ({
        id: `o${proposal.proposedNumber}`,
        kind: "numberedBadge" as const,
        match: proposal.proposedMatch,
        intent: "required" as const,
        number: proposal.proposedNumber,
      }),
    );
    const ctx = shell.createOverlayToolContext({
      overlayContainer: container,
      openIntentDialog: dialogStub,
    });
    expect(ctx).not.toBeNull();
    const tool = new OverlayTool({} as never, {} as never, {} as never);
    tool.setContext(ctx!);
    await tool.handlePick({
      ref: "e2",
      role: "textbox",
      name: "Email",
      bbox: { x: 100, y: 200, width: 300, height: 40 },
    });

    // The yaml sidecar has the new entry; the in-memory state too.
    expect(dialogStub).toHaveBeenCalledTimes(1);
    const parsed = parseAnnotationsYaml(sidecars.get(record.path)!);
    expect(parsed.overlays).toHaveLength(1);
    expect(parsed.overlays[0]).toMatchObject({
      id: "o1",
      kind: "numberedBadge",
      match: { role: "textbox", name: "Email" },
      intent: "required",
      number: 1,
    });
    shell.destroy();
  });
});

describe("EditorShell — Phase 4f publishFlatPng affordance", () => {
  it("returns null when no image is open", async () => {
    const { storage } = makeYamlStorage(makeRecord());
    const container = makeContainer();
    const shell = new EditorShell({ container, storage });
    const result = await shell.publishFlatPng();
    expect(result).toBeNull();
    shell.destroy();
  });

  it("renders the canvas + threads bytes through flattenEditablePng", async () => {
    // Tiny valid PNG that survives `flattenEditablePng`'s chunk walker
    // unchanged (no Adobe XMP / svGo chunks present).
    const FLAT_PNG_BASE64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    editorMocks.getPngDataUrl.mockResolvedValue(`data:image/png;base64,${FLAT_PNG_BASE64}`);

    const record = makeRecord();
    const { storage } = makeYamlStorage(record);
    const container = makeContainer();
    const shell = new EditorShell({ container, storage });
    shell.mountFromRecord(record.path, record);
    const bytes = await shell.publishFlatPng();
    expect(bytes).not.toBeNull();
    expect(bytes!.length).toBeGreaterThan(8);
    // Standard PNG magic header (8 bytes).
    expect(Array.from(bytes!.slice(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(editorMocks.getPngDataUrl).toHaveBeenCalledTimes(1);
    shell.destroy();
  });
});
