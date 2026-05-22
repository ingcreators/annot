/**
 * Phase 2a of `docs/plans/living-spec-authoring-roadmap.md`.
 * Round-trip + shape-violation tests for the annotation yaml Tier A
 * surface. Pure data — no DOM, no fixtures on disk.
 */

import { describe, expect, it } from "vitest";
import {
  ANNOTATIONS_YAML_VERSION,
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
