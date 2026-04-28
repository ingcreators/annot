// Phase 1 of `docs/plans/svg-icons-and-plugin-icon-spec.md`.
// Lightweight runtime + type-discrimination tests for the Tier A
// `IconSpec` descriptor + helpers.

import { describe, expect, it } from "vitest";
import {
  builtinIcon,
  type IconSpec,
  isBuiltinIcon,
  isSvgIcon,
  isUrlIcon,
  svgIcon,
  urlIcon,
} from "./types.js";

describe("IconSpec constructors", () => {
  it("builtinIcon produces a builtin-kind spec", () => {
    const spec = builtinIcon("edit");
    expect(spec).toEqual({ kind: "builtin", id: "edit" });
  });

  it("svgIcon stores the markup verbatim (no validation here)", () => {
    const raw = "<svg><script>alert(1)</script></svg>";
    const spec = svgIcon(raw);
    expect(spec).toEqual({ kind: "svg", svg: raw });
  });

  it("urlIcon stores the URL verbatim (no validation here)", () => {
    const spec = urlIcon("data:image/svg+xml,%3Csvg/%3E");
    expect(spec).toEqual({ kind: "url", url: "data:image/svg+xml,%3Csvg/%3E" });
  });
});

describe("IconSpec type guards", () => {
  const builtin: IconSpec = { kind: "builtin", id: "cloud" };
  const svg: IconSpec = { kind: "svg", svg: "<svg/>" };
  const url: IconSpec = { kind: "url", url: "/icons/foo.svg" };

  it("isBuiltinIcon narrows correctly", () => {
    expect(isBuiltinIcon(builtin)).toBe(true);
    expect(isBuiltinIcon(svg)).toBe(false);
    expect(isBuiltinIcon(url)).toBe(false);
  });

  it("isSvgIcon narrows correctly", () => {
    expect(isSvgIcon(builtin)).toBe(false);
    expect(isSvgIcon(svg)).toBe(true);
    expect(isSvgIcon(url)).toBe(false);
  });

  it("isUrlIcon narrows correctly", () => {
    expect(isUrlIcon(builtin)).toBe(false);
    expect(isUrlIcon(svg)).toBe(false);
    expect(isUrlIcon(url)).toBe(true);
  });

  it("guards usable in switch-style narrowing", () => {
    const specs: readonly IconSpec[] = [builtin, svg, url];
    const seen: string[] = [];
    for (const spec of specs) {
      if (isBuiltinIcon(spec)) seen.push(`builtin:${spec.id}`);
      else if (isSvgIcon(spec)) seen.push(`svg:${spec.svg.length}`);
      else if (isUrlIcon(spec)) seen.push(`url:${spec.url.length}`);
    }
    expect(seen).toEqual(["builtin:cloud", "svg:6", "url:14"]);
  });
});
