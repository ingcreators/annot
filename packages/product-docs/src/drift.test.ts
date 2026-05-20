import { describe, expect, it } from "vitest";

import {
  detectDrift,
  detectDriftFromYaml,
  isLintableScreen,
  lintableScreens,
  summariseDrift,
} from "./drift.js";
import type { ScreenSpec } from "./types.js";

function screenWith(overlays: ScreenSpec["overlays"]): ScreenSpec {
  return { id: "login", src: "./shots/login.png", overlays };
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
      { id: "a", overlays: [] },
      { id: "b", overlays: [{ match: { role: "button", name: "OK" }, body: "" }] },
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
