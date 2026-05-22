/**
 * Phase 2a + Phase 3a of `docs/plans/living-spec-authoring-roadmap.md`.
 * Round-trip + shape-violation tests for the annotation yaml Tier A
 * surface. Pure data — no DOM, no fixtures on disk.
 */

import { describe, expect, it } from "vitest";
import {
  ANNOTATION_KINDS,
  ANNOTATIONS_YAML_VERSION,
  type AnnotationSpec,
  type AnnotationsFile,
  AnnotationsYamlError,
  parseAnnotationsYaml,
  serializeAnnotationsYaml,
} from "./annotations-yaml.js";

const minimal: AnnotationsFile = {
  version: ANNOTATIONS_YAML_VERSION,
  overlays: [
    {
      id: "o1",
      kind: "numberedBadge",
      match: { role: "textbox", name: "Email" },
      intent: "required",
      number: 1,
    },
    {
      id: "o2",
      kind: "numberedBadge",
      match: { role: "button", name: "Sign in" },
      number: 2,
    },
  ],
};

describe("annotations-yaml round-trip", () => {
  it("serializes + reparses a minimal file losslessly", () => {
    const yaml = serializeAnnotationsYaml(minimal);
    const parsed = parseAnnotationsYaml(yaml);
    expect(parsed).toEqual(minimal);
  });

  it("preserves nested `under` matches", () => {
    const file: AnnotationsFile = {
      version: ANNOTATIONS_YAML_VERSION,
      overlays: [
        {
          id: "o1",
          kind: "numberedBadge",
          match: {
            role: "textbox",
            name: "Comment",
            under: { role: "form", name: "Reply" },
          },
          number: 1,
        },
      ],
    };
    const yaml = serializeAnnotationsYaml(file);
    expect(parseAnnotationsYaml(yaml)).toEqual(file);
  });

  it("round-trips meta fields", () => {
    const file: AnnotationsFile = {
      version: ANNOTATIONS_YAML_VERSION,
      overlays: minimal.overlays,
      meta: { generator: "annot-docs migrate-overlays-to-annotations", book: "OM" },
    };
    const yaml = serializeAnnotationsYaml(file);
    expect(parseAnnotationsYaml(yaml)).toEqual(file);
  });

  it("emits version as the first key", () => {
    const yaml = serializeAnnotationsYaml(minimal);
    // First non-empty line should be `version: 1` — deterministic
    // ordering matters for git diffs.
    const firstLine = yaml.split("\n").find((l) => l.trim().length > 0);
    expect(firstLine).toBe("version: 1");
  });

  it("drops empty meta object instead of emitting `meta: {}`", () => {
    const file: AnnotationsFile = {
      version: ANNOTATIONS_YAML_VERSION,
      overlays: minimal.overlays,
      meta: {},
    };
    const yaml = serializeAnnotationsYaml(file);
    expect(yaml).not.toMatch(/meta:/);
  });
});

describe("annotations-yaml parser permissiveness (forward compat within v1)", () => {
  it("ignores unknown top-level keys", () => {
    const yaml = `
version: 1
overlays:
  - id: o1
    kind: numberedBadge
    match: { role: textbox, name: Email }
    number: 1
futureField: ignored
`;
    const parsed = parseAnnotationsYaml(yaml);
    expect(parsed.overlays).toHaveLength(1);
    expect((parsed as unknown as Record<string, unknown>)["futureField"]).toBeUndefined();
  });

  it("ignores unknown keys inside an overlay entry", () => {
    const yaml = `
version: 1
overlays:
  - id: o1
    kind: numberedBadge
    match: { role: textbox, name: Email }
    number: 1
    futureProp: 42
`;
    const parsed = parseAnnotationsYaml(yaml);
    expect(parsed.overlays[0]).toEqual({
      id: "o1",
      kind: "numberedBadge",
      match: { role: "textbox", name: "Email" },
      number: 1,
    });
  });

  it("drops non-string meta values silently", () => {
    const yaml = `
version: 1
overlays: []
meta:
  generator: cli
  count: 7
`;
    const parsed = parseAnnotationsYaml(yaml);
    expect(parsed.meta).toEqual({ generator: "cli" });
  });
});

describe("annotations-yaml parser rejects shape violations", () => {
  it("rejects unsupported major version (strict per OQ-01)", () => {
    const yaml = "version: 2\noverlays: []\n";
    expect(() => parseAnnotationsYaml(yaml)).toThrowError(AnnotationsYamlError);
    expect(() => parseAnnotationsYaml(yaml)).toThrowError(/version/i);
  });

  it("rejects missing version", () => {
    const yaml = "overlays: []\n";
    expect(() => parseAnnotationsYaml(yaml)).toThrowError(AnnotationsYamlError);
  });

  it("rejects top-level that isn't a mapping", () => {
    expect(() => parseAnnotationsYaml("- foo: bar\n")).toThrowError(AnnotationsYamlError);
  });

  it("rejects overlays not being an array", () => {
    expect(() => parseAnnotationsYaml("version: 1\noverlays: nope\n")).toThrowError(/overlays/);
  });

  it("rejects overlay missing id", () => {
    const yaml = `
version: 1
overlays:
  - kind: numberedBadge
    match: { role: button, name: OK }
    number: 1
`;
    expect(() => parseAnnotationsYaml(yaml)).toThrowError(/missing or empty id/);
  });

  it("rejects unsupported kind (Phase 2 only supports numberedBadge)", () => {
    const yaml = `
version: 1
overlays:
  - id: o1
    kind: arrow
    match: { role: button, name: OK }
    number: 1
`;
    expect(() => parseAnnotationsYaml(yaml)).toThrowError(/unsupported kind/);
  });

  it("rejects match without string role + name", () => {
    const yaml = `
version: 1
overlays:
  - id: o1
    kind: numberedBadge
    match: { role: button }
    number: 1
`;
    expect(() => parseAnnotationsYaml(yaml)).toThrowError(/match\.role and match\.name/);
  });

  it("rejects non-numeric number", () => {
    const yaml = `
version: 1
overlays:
  - id: o1
    kind: numberedBadge
    match: { role: button, name: OK }
    number: "one"
`;
    expect(() => parseAnnotationsYaml(yaml)).toThrowError(/number must be a finite number/);
  });

  it("attaches the source on the error so callers can surface context", () => {
    const yaml = "version: 99\noverlays: []\n";
    try {
      parseAnnotationsYaml(yaml);
      expect.fail("expected parser to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AnnotationsYamlError);
      expect((err as AnnotationsYamlError).source).toBe(yaml);
    }
  });
});

describe("annotations-yaml serializer rejects in-memory invariants", () => {
  it("rejects an overlay with an empty id", () => {
    const file: AnnotationsFile = {
      version: ANNOTATIONS_YAML_VERSION,
      overlays: [
        {
          id: "",
          kind: "numberedBadge",
          match: { role: "button", name: "OK" },
          number: 1,
        },
      ],
    };
    expect(() => serializeAnnotationsYaml(file)).toThrowError(/missing id/);
  });

  it("rejects an overlay whose match lacks role / name", () => {
    const file = {
      version: ANNOTATIONS_YAML_VERSION,
      overlays: [
        {
          id: "o1",
          kind: "numberedBadge",
          match: { role: "button" },
          number: 1,
        },
      ],
    } as unknown as AnnotationsFile;
    expect(() => serializeAnnotationsYaml(file)).toThrowError(/match must have string role/);
  });

  it("rejects an overlay with NaN number", () => {
    const file: AnnotationsFile = {
      version: ANNOTATIONS_YAML_VERSION,
      overlays: [
        {
          id: "o1",
          kind: "numberedBadge",
          match: { role: "button", name: "OK" },
          number: Number.NaN,
        },
      ],
    };
    expect(() => serializeAnnotationsYaml(file)).toThrowError(/finite number/);
  });
});

// ─── Phase 3a — annotations[] palette ──────────────────────────

const PHASE3_PALETTE_FILE: AnnotationsFile = {
  version: ANNOTATIONS_YAML_VERSION,
  overlays: [
    {
      id: "o1",
      kind: "numberedBadge",
      match: { role: "textbox", name: "Email" },
      intent: "required",
      number: 1,
    },
  ],
  annotations: [
    {
      id: "rect-match",
      kind: "rect",
      match: { role: "textbox", name: "Email" },
      intent: "info",
    },
    {
      id: "rect-covers",
      kind: "rect",
      coversElements: [
        { role: "textbox", name: "Email" },
        { role: "textbox", name: "Password" },
      ],
      stroke: "#abcdef",
      strokeWidth: 3,
    },
    {
      id: "rect-bbox",
      kind: "rect",
      bbox: { x: 10, y: 20, width: 30, height: 40 },
    },
    {
      id: "circle-match",
      kind: "circle",
      match: { role: "button", name: "Sign in" },
      radius: 24,
    },
    {
      id: "circle-free",
      kind: "circle",
      center: { x: 100, y: 200 },
      radius: 12,
    },
    {
      id: "arrow-match-match",
      kind: "arrow",
      from: { match: { role: "textbox", name: "Email" } },
      to: { match: { role: "button", name: "Sign in" } },
      intent: "action",
    },
    {
      id: "arrow-mixed",
      kind: "arrow",
      from: { point: { x: 10, y: 20 } },
      to: { match: { role: "button", name: "Sign in" } },
    },
    {
      id: "text-anchor",
      kind: "text",
      text: "未認証ユーザのエントリポイント",
      anchor: {
        match: { role: "heading", name: "Sign in" },
        position: "above",
      },
    },
    {
      id: "text-at",
      kind: "text",
      text: "decorative",
      at: { x: 100, y: 100 },
      fontSize: 18,
      color: "#ff0000",
    },
    {
      id: "callout-match",
      kind: "callout",
      text: "Authenticates against the in-memory user table.",
      target: { match: { role: "button", name: "Sign in" } },
      at: { x: 240, y: 320 },
    },
    {
      id: "callout-bbox",
      kind: "callout",
      text: "caption",
      target: { bbox: { x: 0, y: 0, width: 100, height: 50 } },
      at: { x: 50, y: 200 },
    },
    {
      id: "freehand",
      kind: "freehand",
      path: "M100,200 L150,250 L200,210",
      stroke: "#ff0000",
    },
    {
      id: "redact-match",
      kind: "redact",
      match: { role: "textbox", name: "Email" },
      style: "solid",
      fill: "#000000",
    },
    {
      id: "redact-bbox",
      kind: "redact",
      bbox: { x: 421, y: 269, width: 438, height: 40 },
    },
    {
      id: "focus-match",
      kind: "focusMask",
      cutout: { match: { role: "button", name: "Sign in" }, padding: 8 },
      dimColor: "rgba(0,0,0,0.6)",
    },
    {
      id: "focus-bbox",
      kind: "focusMask",
      cutout: { bbox: { x: 0, y: 0, width: 200, height: 200 } },
    },
  ],
};

describe("Phase 3a — annotations[] palette round-trip", () => {
  it("round-trips every kind losslessly", () => {
    const yaml = serializeAnnotationsYaml(PHASE3_PALETTE_FILE);
    const parsed = parseAnnotationsYaml(yaml);
    expect(parsed).toEqual(PHASE3_PALETTE_FILE);
  });

  it("exposes the full kind set via ANNOTATION_KINDS", () => {
    expect(ANNOTATION_KINDS).toEqual([
      "rect",
      "circle",
      "arrow",
      "text",
      "callout",
      "freehand",
      "redact",
      "focusMask",
    ]);
  });

  it("emits annotations after overlays for deterministic diffs", () => {
    const yaml = serializeAnnotationsYaml(PHASE3_PALETTE_FILE);
    const overlaysIdx = yaml.indexOf("overlays:");
    const annotationsIdx = yaml.indexOf("annotations:");
    expect(overlaysIdx).toBeGreaterThanOrEqual(0);
    expect(annotationsIdx).toBeGreaterThan(overlaysIdx);
  });

  it("absent annotations key stays absent (pre-Phase-3 compat)", () => {
    const yaml = serializeAnnotationsYaml({
      version: ANNOTATIONS_YAML_VERSION,
      overlays: [
        {
          id: "o1",
          kind: "numberedBadge",
          match: { role: "button", name: "OK" },
          number: 1,
        },
      ],
    });
    expect(yaml).not.toMatch(/annotations:/);
    // And empty `annotations` deserialises as undefined, not empty array.
    expect(parseAnnotationsYaml(yaml).annotations).toBeUndefined();
  });

  it("empty annotations array round-trips as undefined (no `annotations: []` emitted)", () => {
    const yaml = serializeAnnotationsYaml({
      ...PHASE3_PALETTE_FILE,
      annotations: [],
    });
    expect(yaml).not.toMatch(/annotations:/);
  });
});

describe("Phase 3a — annotations[] parser permissiveness (forward compat)", () => {
  it("ignores unknown style fields silently", () => {
    const yaml = `
version: 1
overlays: []
annotations:
  - id: a1
    kind: rect
    match: { role: textbox, name: Email }
    futureField: ignored
`;
    const parsed = parseAnnotationsYaml(yaml);
    expect(parsed.annotations).toHaveLength(1);
    expect(parsed.annotations?.[0]).toEqual({
      id: "a1",
      kind: "rect",
      match: { role: "textbox", name: "Email" },
    });
  });
});

describe("Phase 3a — annotations[] parser rejects shape violations", () => {
  it("rejects annotations not being an array", () => {
    expect(() =>
      parseAnnotationsYaml("version: 1\noverlays: []\nannotations: nope\n"),
    ).toThrowError(/annotations.*array/i);
  });

  it("rejects unknown kind", () => {
    const yaml = `
version: 1
overlays: []
annotations:
  - id: a1
    kind: pentagram
`;
    expect(() => parseAnnotationsYaml(yaml)).toThrowError(/unsupported kind/);
  });

  it.each([
    [
      "rect requires exactly one selector",
      "version: 1\noverlays: []\nannotations:\n  - id: a1\n    kind: rect\n",
      /exactly one of.*match.*coversElements.*bbox/,
    ],
    [
      "circle requires exactly one of match / center",
      "version: 1\noverlays: []\nannotations:\n  - id: a1\n    kind: circle\n    match: { role: button, name: OK }\n    center: { x: 0, y: 0 }\n    radius: 5\n",
      /exactly one of/,
    ],
    [
      "circle with center requires radius",
      "version: 1\noverlays: []\nannotations:\n  - id: a1\n    kind: circle\n    center: { x: 0, y: 0 }\n",
      /center.*requires.*radius/,
    ],
    [
      "arrow endpoint requires exactly one of match / point",
      "version: 1\noverlays: []\nannotations:\n  - id: a1\n    kind: arrow\n    from: { match: { role: button, name: OK }, point: { x: 0, y: 0 } }\n    to: { match: { role: button, name: Cancel } }\n",
      /arrow\.from requires exactly one/,
    ],
    [
      "text requires text + exactly one of anchor / at",
      "version: 1\noverlays: []\nannotations:\n  - id: a1\n    kind: text\n",
      /requires.*text/i,
    ],
    [
      "callout requires text",
      "version: 1\noverlays: []\nannotations:\n  - id: a1\n    kind: callout\n    target: { match: { role: button, name: OK } }\n    at: { x: 10, y: 10 }\n",
      /callout.*text/i,
    ],
    [
      "freehand requires non-empty path",
      `version: 1\noverlays: []\nannotations:\n  - id: a1\n    kind: freehand\n    path: ""\n`,
      /freehand.*path/,
    ],
    [
      "redact rejects mosaic / blur in Phase 3",
      "version: 1\noverlays: []\nannotations:\n  - id: a1\n    kind: redact\n    match: { role: textbox, name: Email }\n    style: mosaic\n",
      /style must be "solid"/,
    ],
    [
      "focusMask cutout requires exactly one of match / bbox",
      "version: 1\noverlays: []\nannotations:\n  - id: a1\n    kind: focusMask\n    cutout: { match: { role: button, name: OK }, bbox: { x: 0, y: 0, width: 10, height: 10 } }\n",
      /cutout requires exactly one/,
    ],
    [
      "bbox rejects negative width",
      "version: 1\noverlays: []\nannotations:\n  - id: a1\n    kind: rect\n    bbox: { x: 0, y: 0, width: -10, height: 10 }\n",
      /bbox.*non-negative/,
    ],
  ])("rejects: %s", (_label, yaml, pattern) => {
    expect(() => parseAnnotationsYaml(yaml)).toThrowError(pattern as RegExp);
  });

  it("attaches the source on the error so callers can surface context", () => {
    const yaml = `
version: 1
overlays: []
annotations:
  - id: a1
    kind: zoinks
`;
    try {
      parseAnnotationsYaml(yaml);
      expect.fail("expected parser to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AnnotationsYamlError);
    }
  });
});

describe("Phase 3a — annotations[] serializer rejects in-memory invariants", () => {
  function fileWith(annotation: AnnotationSpec): AnnotationsFile {
    return {
      version: ANNOTATIONS_YAML_VERSION,
      overlays: [],
      annotations: [annotation],
    };
  }

  it("rejects rect with no selector", () => {
    expect(() =>
      serializeAnnotationsYaml(fileWith({ id: "a1", kind: "rect" } as unknown as AnnotationSpec)),
    ).toThrowError(/rect requires exactly one of/);
  });

  it("rejects redact with mosaic style", () => {
    expect(() =>
      serializeAnnotationsYaml(
        fileWith({
          id: "a1",
          kind: "redact",
          bbox: { x: 0, y: 0, width: 10, height: 10 },
          style: "mosaic" as unknown as "solid",
        }),
      ),
    ).toThrowError(/style must be "solid"/);
  });
});
