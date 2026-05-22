import type { ElementTree } from "@ingcreators/annot-core";
import { describe, expect, it } from "vitest";
import {
  detectDrift,
  detectDriftFromElementTree,
  detectDriftFromYaml,
  elementTreeToSnapshotEntries,
  isLintableScreen,
  lintableScreens,
  summariseDrift,
} from "./drift.js";
import type { ScreenSpec } from "./types.js";

function screenWith(overlays: ScreenSpec["overlays"]): ScreenSpec {
  return { id: "login", src: "./shots/login.png", overlays, callouts: [] };
}

describe("detectDrift", () => {
  it("emits no findings on a clean match", () => {
    const screen = screenWith([
      { match: { role: "textbox", name: "Email" }, body: "" },
      { match: { role: "button", name: "Sign in" }, body: "" },
    ]);
    const findings = detectDriftFromYaml({
      screen,
      liveSnapshotYaml: `- textbox "Email" [ref=e1]
- button "Sign in" [ref=e2]`,
    });
    expect(findings).toEqual([]);
  });

  it("reports removed elements as error", () => {
    const screen = screenWith([{ match: { role: "textbox", name: "Email" }, body: "" }]);
    const findings = detectDriftFromYaml({ screen, liveSnapshotYaml: "" });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("removed");
    expect(findings[0]?.severity).toBe("error");
  });

  it("reports renamed (same role, different name) as warning + suggestion", () => {
    const screen = screenWith([{ match: { role: "textbox", name: "Email Address" }, body: "" }]);
    const findings = detectDriftFromYaml({
      screen,
      liveSnapshotYaml: '- textbox "Email Addr" [ref=e1]',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("renamed");
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.suggestion?.name).toBe("Email Addr");
  });

  it("reports role-changed (same name, different role) as warning + suggestion", () => {
    const screen = screenWith([{ match: { role: "textbox", name: "Email" }, body: "" }]);
    const findings = detectDriftFromYaml({
      screen,
      liveSnapshotYaml: '- searchbox "Email" [ref=e1]',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("role-changed");
    expect(findings[0]?.suggestion?.role).toBe("searchbox");
  });

  it("reports duplicated as error", () => {
    const screen = screenWith([{ match: { role: "button", name: "OK" }, body: "" }]);
    const findings = detectDriftFromYaml({
      screen,
      liveSnapshotYaml: `- button "OK" [ref=e1]
- button "OK" [ref=e2]`,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("duplicated");
    expect(findings[0]?.severity).toBe("error");
  });

  it("reports added (interactive role with no overlay) as warning", () => {
    const screen = screenWith([{ match: { role: "textbox", name: "Email" }, body: "" }]);
    const findings = detectDriftFromYaml({
      screen,
      liveSnapshotYaml: `- textbox "Email" [ref=e1]
- button "Help" [ref=e2]`,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("added");
    expect(findings[0]?.suggestion?.role).toBe("button");
    expect(findings[0]?.suggestion?.name).toBe("Help");
  });

  it("ignores non-interactive roles when reporting added", () => {
    const screen = screenWith([{ match: { role: "button", name: "Continue" }, body: "" }]);
    const findings = detectDriftFromYaml({
      screen,
      liveSnapshotYaml: `- region "Main" [ref=e1]
- paragraph "Welcome message" [ref=e2]
- button "Continue" [ref=e3]`,
    });
    expect(findings).toEqual([]);
  });

  it("reports attribute drift as info", () => {
    const screen = screenWith([{ match: { role: "textbox", name: "Email" }, body: "" }]);
    const findings = detectDriftFromYaml({
      screen,
      liveSnapshotYaml: '- textbox "Email" [ref=e1]',
      storedAttributesYaml: 'textbox "Email":\n  required: true',
      freshAttributesYaml: 'textbox "Email":\n  required: false',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("attribute-drift");
    expect(findings[0]?.severity).toBe("info");
  });

  it("treats trailing-whitespace / blank-line differences in attribute YAML as no drift", () => {
    const screen = screenWith([{ match: { role: "textbox", name: "Email" }, body: "" }]);
    const findings = detectDriftFromYaml({
      screen,
      liveSnapshotYaml: '- textbox "Email" [ref=e1]',
      storedAttributesYaml: 'textbox "Email":\n  required: true\n',
      freshAttributesYaml: '\ntextbox "Email":   \n  required: true  \n\n',
    });
    expect(findings).toEqual([]);
  });
});

describe("summariseDrift", () => {
  it("counts each severity bucket", () => {
    const counts = summariseDrift([
      { severity: "error", kind: "removed", screenId: "x", message: "" },
      { severity: "error", kind: "duplicated", screenId: "x", message: "" },
      { severity: "warning", kind: "renamed", screenId: "x", message: "" },
      { severity: "info", kind: "attribute-drift", screenId: "x", message: "" },
    ]);
    expect(counts).toEqual({ errors: 2, warnings: 1, infos: 1 });
  });
});

describe("isLintableScreen / lintableScreens", () => {
  it("filters out screens with no overlays", () => {
    const screens: ScreenSpec[] = [
      { id: "a", overlays: [], callouts: [] },
      {
        id: "b",
        overlays: [{ match: { role: "button", name: "OK" }, body: "" }],
        callouts: [],
      },
    ];
    expect(lintableScreens(screens).map((s) => s.id)).toEqual(["b"]);
    expect(isLintableScreen(screens[0]!)).toBe(false);
    expect(isLintableScreen(screens[1]!)).toBe(true);
  });
});

describe("detectDrift (snapshot pre-parsed)", () => {
  it("accepts a SnapshotEntry[] directly", () => {
    const findings = detectDrift({
      screen: screenWith([{ match: { role: "button", name: "Save" }, body: "" }]),
      liveSnapshot: [{ role: "button", name: "Save", ref: "e1", depth: 0, ancestors: [] }],
    });
    expect(findings).toEqual([]);
  });
});

// Phase 1i of `docs/plans/living-spec-authoring-roadmap.md` —
// the drift detector consumes ElementTree directly via the new
// adapter, eliminating the YAML round-trip for callers that
// already have the canonical model in hand (PNG XMP readers,
// MCP tools, future in-editor drift overlays).
describe("elementTreeToSnapshotEntries", () => {
  it("flattens a tree, skipping nodes without name", () => {
    const tree: ElementTree = {
      version: 1,
      source: { kind: "extension", capturedAt: "2026-05-23T00:00:00Z" },
      viewport: { width: 100, height: 100, scale: 1 },
      root: {
        ref: "e0",
        role: "document",
        children: [
          { ref: "e1", role: "heading", name: "Sign in" },
          { ref: "e2", role: "form" }, // no name → skipped
          {
            ref: "e3",
            role: "textbox",
            name: "Email",
            children: [{ ref: "e4", role: "generic" }], // no name
          },
        ],
      },
    };
    const entries = elementTreeToSnapshotEntries(tree);
    expect(entries.map((e) => e.ref)).toEqual(["e1", "e3"]);
    expect(entries[1]).toMatchObject({ role: "textbox", name: "Email" });
  });

  it("populates ancestor chain with named ancestors only", () => {
    const tree: ElementTree = {
      version: 1,
      source: { kind: "extension", capturedAt: "2026-05-23T00:00:00Z" },
      viewport: { width: 100, height: 100, scale: 1 },
      root: {
        ref: "e0",
        role: "document",
        children: [
          {
            ref: "e1",
            role: "dialog",
            name: "Confirm",
            children: [
              { ref: "e2", role: "button", name: "OK" },
              { ref: "e3", role: "button", name: "Cancel" },
            ],
          },
        ],
      },
    };
    const entries = elementTreeToSnapshotEntries(tree);
    const ok = entries.find((e) => e.name === "OK");
    expect(ok?.ancestors).toEqual([{ role: "dialog", name: "Confirm" }]);
  });
});

describe("detectDriftFromElementTree", () => {
  function liveTree(children: Array<{ role: string; name: string; ref: string }>): ElementTree {
    return {
      version: 1,
      source: { kind: "playwright", capturedAt: "2026-05-23T00:00:00Z" },
      viewport: { width: 100, height: 100, scale: 1 },
      root: { ref: "e0", role: "document", children },
    };
  }

  it("emits no findings on a clean match", () => {
    const findings = detectDriftFromElementTree({
      screen: screenWith([
        { match: { role: "textbox", name: "Email" }, body: "" },
        { match: { role: "button", name: "Sign in" }, body: "" },
      ]),
      liveElementTree: liveTree([
        { ref: "e1", role: "textbox", name: "Email" },
        { ref: "e2", role: "button", name: "Sign in" },
      ]),
    });
    expect(findings).toEqual([]);
  });

  it("reports removed elements as error", () => {
    const findings = detectDriftFromElementTree({
      screen: screenWith([{ match: { role: "textbox", name: "Email" }, body: "" }]),
      liveElementTree: liveTree([]),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("removed");
  });

  it("produces identical findings to detectDriftFromYaml on equivalent input", () => {
    const screen = screenWith([{ match: { role: "button", name: "Save" }, body: "" }]);
    const fromYaml = detectDriftFromYaml({
      screen,
      liveSnapshotYaml: '- button "Save" [ref=e1]',
    });
    const fromTree = detectDriftFromElementTree({
      screen,
      liveElementTree: liveTree([{ ref: "e1", role: "button", name: "Save" }]),
    });
    expect(fromTree).toEqual(fromYaml);
  });
});
