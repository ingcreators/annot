import { describe, expect, it } from "vitest";

import { annotFrontmatterSchema, defineConfig, isScreenRole } from "./config.js";

describe("annotFrontmatterSchema", () => {
  it("accepts a minimal valid frontmatter", () => {
    const r = annotFrontmatterSchema.safeParse({ id: "SC-001" });
    expect(r.success).toBe(true);
  });

  it("rejects an empty id", () => {
    const r = annotFrontmatterSchema.safeParse({ id: "" });
    expect(r.success).toBe(false);
  });

  it("rejects extraneous root-level fields (strict)", () => {
    const r = annotFrontmatterSchema.safeParse({ id: "X", typo: "oops" });
    expect(r.success).toBe(false);
  });

  it("rejects xlsx with both sheet and sheets set", () => {
    const r = annotFrontmatterSchema.safeParse({
      id: "X",
      xlsx: { sheet: "A", sheets: { default: "A" } },
    });
    expect(r.success).toBe(false);
  });

  it("accepts xlsx.role from the enum", () => {
    const r = annotFrontmatterSchema.safeParse({ id: "X", xlsx: { role: "cover" } });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown xlsx.role", () => {
    const r = annotFrontmatterSchema.safeParse({ id: "X", xlsx: { role: "weird" } });
    expect(r.success).toBe(false);
  });
});

describe("defineConfig", () => {
  it("returns the config when valid", () => {
    const config = defineConfig({
      meta: { projectName: "Example" },
      xlsx: {
        defaultBook: "Spec",
        books: {
          Spec: {
            template: "./template.xlsx",
            templateSheets: { screen: "Per screen" },
          },
        },
      },
    });
    expect(config.meta?.["projectName"]).toBe("Example");
    expect(config.xlsx?.books?.["Spec"]?.template).toBe("./template.xlsx");
  });

  it("throws on unknown top-level keys", () => {
    expect(() =>
      // @ts-expect-error testing runtime guard against a typo
      defineConfig({ xslx: {} }),
    ).toThrow(/Invalid `annot-docs.config.ts`/);
  });
});

describe("isScreenRole", () => {
  it("defaults to true when xlsx.role is unset", () => {
    expect(isScreenRole({ id: "X" })).toBe(true);
  });

  it("returns false for non-screen roles", () => {
    expect(isScreenRole({ id: "X", xlsx: { role: "history" } })).toBe(false);
    expect(isScreenRole({ id: "X", xlsx: { role: "cover" } })).toBe(false);
  });

  it("returns true for explicit screen role", () => {
    expect(isScreenRole({ id: "X", xlsx: { role: "screen" } })).toBe(true);
  });
});
