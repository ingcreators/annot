import type { ElementTree } from "@ingcreators/annot-core";
import { describe, expect, it } from "vitest";
import type { AnnotationSpec } from "./annotations-yaml.js";
import {
  collectMatchKeysFromAnnotation,
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

// Phase 2c of `docs/plans/living-spec-authoring-roadmap.md`:
// yaml-driven overlays + description cross-ref findings.
describe("detectDrift — yamlOverlays (Phase 2c)", () => {
  const liveSnapshot = [
    { role: "textbox", name: "Email", ref: "e1", depth: 0, ancestors: [] },
    { role: "button", name: "Sign in", ref: "e2", depth: 0, ancestors: [] },
  ];

  it("uses yaml overlays for the match-cycle instead of inline `<Overlay>`", () => {
    const screen: ScreenSpec = {
      id: "login",
      src: "./shots/login.png",
      overlays: [], // legacy path empty
      callouts: [
        { for: "o1", body: "**Email**" },
        { for: "o2", body: "Sign in" },
      ],
      annotations: "./login.annotations.yaml",
    };
    const findings = detectDrift({
      screen,
      liveSnapshot,
      yamlOverlays: [
        {
          id: "o1",
          kind: "numberedBadge",
          match: { role: "textbox", name: "Email" },
          number: 1,
        },
        {
          id: "o2",
          kind: "numberedBadge",
          match: { role: "button", name: "Sign in" },
          number: 2,
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it("emits `description-missing` for a yaml id with no AnnotCallout", () => {
    const screen: ScreenSpec = {
      id: "login",
      src: "./shots/login.png",
      overlays: [],
      callouts: [{ for: "o1", body: "Email" }],
      annotations: "./login.annotations.yaml",
    };
    const findings = detectDrift({
      screen,
      liveSnapshot,
      yamlOverlays: [
        {
          id: "o1",
          kind: "numberedBadge",
          match: { role: "textbox", name: "Email" },
          number: 1,
        },
        {
          id: "o2",
          kind: "numberedBadge",
          match: { role: "button", name: "Sign in" },
          number: 2,
        },
      ],
    });
    expect(findings.map((f) => f.kind)).toEqual(["description-missing"]);
    expect(findings[0]?.severity).toBe("warning");
    expect(findings[0]?.message).toMatch(/o2/);
  });

  it("emits `description-orphan` (error) for a stale `<AnnotCallout for>`", () => {
    const screen: ScreenSpec = {
      id: "login",
      src: "./shots/login.png",
      overlays: [],
      callouts: [
        { for: "o1", body: "Email" },
        { for: "o2", body: "Sign in" },
        { for: "o3", body: "ghost" },
      ],
      annotations: "./login.annotations.yaml",
    };
    const findings = detectDrift({
      screen,
      liveSnapshot,
      yamlOverlays: [
        {
          id: "o1",
          kind: "numberedBadge",
          match: { role: "textbox", name: "Email" },
          number: 1,
        },
        {
          id: "o2",
          kind: "numberedBadge",
          match: { role: "button", name: "Sign in" },
          number: 2,
        },
      ],
    });
    expect(findings.map((f) => f.kind)).toEqual(["description-orphan"]);
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.message).toMatch(/o3/);
  });

  it("legacy `screen.overlays` stays inert when yamlOverlays is set", () => {
    const screen: ScreenSpec = {
      id: "login",
      src: "./shots/login.png",
      // Stale inline overlay — would normally trigger a `removed`
      // finding, but yaml overlays take over the match-cycle.
      overlays: [{ match: { role: "link", name: "Forgot password" }, body: "" }],
      callouts: [{ for: "o1", body: "Email" }],
      annotations: "./login.annotations.yaml",
    };
    const findings = detectDrift({
      screen,
      liveSnapshot,
      yamlOverlays: [
        {
          id: "o1",
          kind: "numberedBadge",
          match: { role: "textbox", name: "Email" },
          number: 1,
        },
      ],
    });
    // No `removed` from the stale legacy overlay — only `added`
    // for "Sign in" which has no yaml entry.
    expect(findings.map((f) => f.kind).sort()).toEqual(["added"]);
  });

  it("isLintableScreen treats yaml-form screens as lintable", () => {
    const yamlScreen: ScreenSpec = {
      id: "y",
      src: "./y.png",
      overlays: [],
      callouts: [{ for: "o1", body: "" }],
      annotations: "./y.yaml",
    };
    expect(isLintableScreen(yamlScreen)).toBe(true);

    const annotationsOnlyScreen: ScreenSpec = {
      id: "a",
      overlays: [],
      callouts: [],
      annotations: "./a.yaml",
    };
    expect(isLintableScreen(annotationsOnlyScreen)).toBe(true);
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

// ─── Phase 3d — annotations[] drift ────────────────────────────

describe("collectMatchKeysFromAnnotation (Phase 3d)", () => {
  it("rect: returns single match when match-anchored", () => {
    const spec: AnnotationSpec = {
      id: "a1",
      kind: "rect",
      match: { role: "textbox", name: "Email" },
    };
    expect(collectMatchKeysFromAnnotation(spec)).toEqual([{ role: "textbox", name: "Email" }]);
  });

  it("rect: returns coversElements when set", () => {
    const spec: AnnotationSpec = {
      id: "a1",
      kind: "rect",
      coversElements: [
        { role: "textbox", name: "Email" },
        { role: "textbox", name: "Password" },
      ],
    };
    expect(collectMatchKeysFromAnnotation(spec)).toHaveLength(2);
  });

  it("rect (bbox), freehand, free-coord arrow contribute zero keys", () => {
    const rect: AnnotationSpec = {
      id: "a1",
      kind: "rect",
      bbox: { x: 0, y: 0, width: 10, height: 10 },
    };
    const free: AnnotationSpec = { id: "a2", kind: "freehand", path: "M0,0 L1,1" };
    const arrow: AnnotationSpec = {
      id: "a3",
      kind: "arrow",
      from: { point: { x: 0, y: 0 } },
      to: { point: { x: 10, y: 10 } },
    };
    expect(collectMatchKeysFromAnnotation(rect)).toEqual([]);
    expect(collectMatchKeysFromAnnotation(free)).toEqual([]);
    expect(collectMatchKeysFromAnnotation(arrow)).toEqual([]);
  });

  it("arrow: returns from + to match keys when both are match-anchored", () => {
    const spec: AnnotationSpec = {
      id: "a1",
      kind: "arrow",
      from: { match: { role: "textbox", name: "Email" } },
      to: { match: { role: "button", name: "Sign in" } },
    };
    expect(collectMatchKeysFromAnnotation(spec)).toEqual([
      { role: "textbox", name: "Email" },
      { role: "button", name: "Sign in" },
    ]);
  });

  it("arrow: mixed match + point only returns the match endpoint", () => {
    const spec: AnnotationSpec = {
      id: "a1",
      kind: "arrow",
      from: { point: { x: 0, y: 0 } },
      to: { match: { role: "button", name: "Sign in" } },
    };
    expect(collectMatchKeysFromAnnotation(spec)).toEqual([{ role: "button", name: "Sign in" }]);
  });

  it("text: returns anchor.match when set, empty for free-coord at", () => {
    const anchored: AnnotationSpec = {
      id: "a1",
      kind: "text",
      text: "x",
      anchor: { match: { role: "heading", name: "Sign in" } },
    };
    const free: AnnotationSpec = {
      id: "a2",
      kind: "text",
      text: "x",
      at: { x: 0, y: 0 },
    };
    expect(collectMatchKeysFromAnnotation(anchored)).toEqual([
      { role: "heading", name: "Sign in" },
    ]);
    expect(collectMatchKeysFromAnnotation(free)).toEqual([]);
  });

  it("callout: returns target.match when match-anchored, empty when bbox-anchored", () => {
    const matched: AnnotationSpec = {
      id: "a1",
      kind: "callout",
      text: "x",
      target: { match: { role: "button", name: "Sign in" } },
      at: { x: 0, y: 0 },
    };
    const free: AnnotationSpec = {
      id: "a2",
      kind: "callout",
      text: "x",
      target: { bbox: { x: 0, y: 0, width: 10, height: 10 } },
      at: { x: 0, y: 0 },
    };
    expect(collectMatchKeysFromAnnotation(matched)).toEqual([{ role: "button", name: "Sign in" }]);
    expect(collectMatchKeysFromAnnotation(free)).toEqual([]);
  });

  it("redact + focusMask follow the same match-vs-bbox logic", () => {
    const matchRedact: AnnotationSpec = {
      id: "a1",
      kind: "redact",
      match: { role: "textbox", name: "Email" },
    };
    const matchFocus: AnnotationSpec = {
      id: "a2",
      kind: "focusMask",
      cutout: { match: { role: "button", name: "Sign in" } },
    };
    const bboxRedact: AnnotationSpec = {
      id: "a3",
      kind: "redact",
      bbox: { x: 0, y: 0, width: 10, height: 10 },
    };
    const bboxFocus: AnnotationSpec = {
      id: "a4",
      kind: "focusMask",
      cutout: { bbox: { x: 0, y: 0, width: 10, height: 10 } },
    };
    expect(collectMatchKeysFromAnnotation(matchRedact)).toHaveLength(1);
    expect(collectMatchKeysFromAnnotation(matchFocus)).toHaveLength(1);
    expect(collectMatchKeysFromAnnotation(bboxRedact)).toEqual([]);
    expect(collectMatchKeysFromAnnotation(bboxFocus)).toEqual([]);
  });

  it("circle: returns match when set, empty for free-coord center", () => {
    const matched: AnnotationSpec = {
      id: "a1",
      kind: "circle",
      match: { role: "button", name: "Sign in" },
    };
    const free: AnnotationSpec = {
      id: "a2",
      kind: "circle",
      center: { x: 0, y: 0 },
      radius: 5,
    };
    expect(collectMatchKeysFromAnnotation(matched)).toHaveLength(1);
    expect(collectMatchKeysFromAnnotation(free)).toEqual([]);
  });
});

describe("detectDrift — yamlAnnotations (Phase 3d)", () => {
  const liveSnapshot = [
    { role: "textbox", name: "Email", ref: "e1", depth: 0, ancestors: [] },
    { role: "button", name: "Sign in", ref: "e2", depth: 0, ancestors: [] },
  ];
  function bareScreen(annotations: string | undefined = "./login.annotations.yaml"): ScreenSpec {
    return {
      id: "login",
      src: "./shots/login.png",
      overlays: [],
      callouts: [],
      annotations,
    };
  }

  /**
   * Helper: filter out the "added" findings the overlay-side
   * detector generates for interactive elements with no overlay.
   * Phase 3d's annotations[] match-cycle is orthogonal — annotation
   * coverage does NOT suppress "added", because only overlays
   * count as "documented". Tests in this block scope to non-added
   * kinds so the focus stays on the annotation cycle.
   */
  function annotationFindings(findings: ReturnType<typeof detectDrift>) {
    return findings.filter((f) => f.kind !== "added");
  }

  it("emits no findings (other than `added` from the orthogonal overlay cycle) when every match-anchored annotation resolves", () => {
    const findings = annotationFindings(
      detectDrift({
        screen: bareScreen(),
        liveSnapshot,
        yamlAnnotations: [
          {
            id: "a1",
            kind: "rect",
            match: { role: "textbox", name: "Email" },
          },
          {
            id: "a2",
            kind: "arrow",
            from: { match: { role: "textbox", name: "Email" } },
            to: { match: { role: "button", name: "Sign in" } },
          },
        ],
      }),
    );
    expect(findings).toEqual([]);
  });

  it("emits `removed` (error) when an annotation match doesn't resolve", () => {
    const findings = annotationFindings(
      detectDrift({
        screen: bareScreen(),
        liveSnapshot,
        yamlAnnotations: [
          {
            id: "a1",
            kind: "rect",
            match: { role: "textbox", name: "Ghost" },
          },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("removed");
    expect(findings[0]?.severity).toBe("error");
    expect(findings[0]?.message).toMatch(/a1/);
    expect(findings[0]?.message).toMatch(/Ghost/);
  });

  it("emits `role-changed` (warning + suggestion) for annotation match-cycle too", () => {
    const findings = annotationFindings(
      detectDrift({
        screen: bareScreen(),
        liveSnapshot: [{ role: "searchbox", name: "Email", ref: "e1", depth: 0, ancestors: [] }],
        yamlAnnotations: [
          {
            id: "a1",
            kind: "rect",
            match: { role: "textbox", name: "Email" },
          },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("role-changed");
    expect(findings[0]?.suggestion).toEqual({ role: "searchbox" });
    expect(findings[0]?.message).toMatch(/a1/);
  });

  it("emits `renamed` (warning + suggestion) for an annotation match's closest name", () => {
    const findings = annotationFindings(
      detectDrift({
        screen: bareScreen(),
        liveSnapshot: [
          { role: "textbox", name: "Email Address", ref: "e1", depth: 0, ancestors: [] },
        ],
        yamlAnnotations: [
          {
            id: "a1",
            kind: "rect",
            match: { role: "textbox", name: "Email Adress" },
          },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("renamed");
    expect(findings[0]?.suggestion?.name).toBe("Email Address");
  });

  it("emits `duplicated` (error) when an annotation match resolves to multiple elements", () => {
    const findings = annotationFindings(
      detectDrift({
        screen: bareScreen(),
        liveSnapshot: [
          { role: "button", name: "Sign in", ref: "e1", depth: 0, ancestors: [] },
          { role: "button", name: "Sign in", ref: "e2", depth: 0, ancestors: [] },
        ],
        yamlAnnotations: [
          {
            id: "a1",
            kind: "rect",
            match: { role: "button", name: "Sign in" },
          },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("duplicated");
    expect(findings[0]?.message).toMatch(/a1/);
  });

  it("free-coord annotations contribute zero findings", () => {
    const findings = annotationFindings(
      detectDrift({
        screen: bareScreen(),
        liveSnapshot,
        yamlAnnotations: [
          {
            id: "a1",
            kind: "rect",
            bbox: { x: 0, y: 0, width: 10, height: 10 },
          },
          { id: "a2", kind: "freehand", path: "M0,0 L1,1" },
          {
            id: "a3",
            kind: "arrow",
            from: { point: { x: 0, y: 0 } },
            to: { point: { x: 10, y: 10 } },
          },
        ],
      }),
    );
    expect(findings).toEqual([]);
  });

  it("walks both endpoints of a match→match arrow", () => {
    const findings = annotationFindings(
      detectDrift({
        screen: bareScreen(),
        liveSnapshot,
        yamlAnnotations: [
          {
            id: "a1",
            kind: "arrow",
            from: { match: { role: "textbox", name: "Ghost1" } },
            to: { match: { role: "textbox", name: "Ghost2" } },
          },
        ],
      }),
    );
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.kind === "removed")).toBe(true);
    expect(findings.every((f) => f.message.includes("a1"))).toBe(true);
  });

  it("walks every coversElements match of a rect", () => {
    const findings = annotationFindings(
      detectDrift({
        screen: bareScreen(),
        liveSnapshot,
        yamlAnnotations: [
          {
            id: "a1",
            kind: "rect",
            coversElements: [
              { role: "textbox", name: "Email" },
              { role: "textbox", name: "Missing1" },
              { role: "textbox", name: "Missing2" },
            ],
          },
        ],
      }),
    );
    // Only the two missing ones produce findings — Email resolves.
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.kind === "removed")).toBe(true);
  });

  it("combined with yamlOverlays: both sources contribute findings", () => {
    const findings = detectDrift({
      screen: bareScreen(),
      // Live snapshot covers both overlay + annotation targets so
      // the "added" cycle stays quiet.
      liveSnapshot: [
        { role: "link", name: "Forgot", ref: "e1", depth: 0, ancestors: [] },
        { role: "link", name: "Help", ref: "e2", depth: 0, ancestors: [] },
      ],
      yamlOverlays: [
        {
          id: "o-resolves",
          kind: "numberedBadge",
          match: { role: "link", name: "Forgot" },
          number: 1,
        },
        {
          id: "o-ghost",
          kind: "numberedBadge",
          match: { role: "link", name: "Stale" },
          number: 2,
        },
      ],
      yamlAnnotations: [
        {
          id: "a-resolves",
          kind: "rect",
          match: { role: "link", name: "Help" },
        },
        {
          id: "a-ghost",
          kind: "rect",
          match: { role: "link", name: "Phantom" },
        },
      ],
    });
    // 1 `removed` from each side (the resolving entries pass cleanly,
    // the ghost entries produce `removed` errors). The annotation-side
    // finding's message references the annotation id (`a-ghost`);
    // the overlay-side finding doesn't.
    const removed = findings.filter((f) => f.kind === "removed");
    expect(removed).toHaveLength(2);
    expect(removed.some((f) => f.message.includes("a-ghost"))).toBe(true);
    expect(removed.some((f) => f.message.includes("Stale"))).toBe(true);
  });
});
