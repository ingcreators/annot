// @vitest-environment happy-dom
//
// Theme registry structural tests — Phase 1 of
// `docs/plans/card-document-themes.md`. Phase 1 only ships the
// legacy themes (`modern-light` + `modern-dark`); Phase 2 adds
// `minimal` / `editorial` / `playful` and extends these
// assertions.

import { describe, expect, it } from "vitest";
import { editorial } from "./editorial.js";
import { BUILTIN_THEME_IDS, getTheme, pickLegacyTheme, THEMES } from "./index.js";
import { modernDark, modernLight } from "./legacy.js";
import { minimal } from "./minimal.js";
import { playful } from "./playful.js";

describe("THEMES registry", () => {
  it("registers the legacy modern-light + modern-dark themes", () => {
    expect(THEMES["modern-light"]).toBe(modernLight);
    expect(THEMES["modern-dark"]).toBe(modernDark);
  });

  it("each theme's vars have a corresponding entry for every key in its sibling's vars (symmetry)", () => {
    // The two legacy themes share the same variable name set —
    // modern-dark is a pure color-palette swap of modern-light's
    // root-level vars. Asymmetry here would mean a CSS property
    // defined in one theme silently falls through to its
    // computed default in the other.
    const lightKeys = new Set(modernLight.vars.map(([k]) => k));
    const darkKeys = new Set(modernDark.vars.map(([k]) => k));
    expect(lightKeys).toEqual(darkKeys);
  });

  it("modern-light.darkVars matches modern-dark.vars 1:1 (legacy auto-mode equivalence)", () => {
    // The legacy `meta.theme === "auto"` path uses modern-light
    // at root + darkVars in a media query. The legacy
    // `meta.theme === "dark"` path uses modern-dark vars flat.
    // The values must agree so a user picking "Dark" via OS
    // settings sees the same colours as a user picking "Dark"
    // via the doc's theme field.
    expect(modernLight.darkVars).toBeDefined();
    expect(modernLight.darkVars).toEqual(modernDark.vars);
  });

  it("modern-dark has no darkVars (it's already dark)", () => {
    expect(modernDark.darkVars).toBeUndefined();
  });
});

describe("getTheme", () => {
  it("looks up a registered theme by id", () => {
    expect(getTheme("modern-light")).toBe(modernLight);
    expect(getTheme("modern-dark")).toBe(modernDark);
  });

  it("falls back to modern-light for unknown ids", () => {
    expect(getTheme("does-not-exist")).toBe(modernLight);
    expect(getTheme(undefined)).toBe(modernLight);
  });
});

describe("Phase 2 themes (minimal / editorial / playful)", () => {
  const phase2Themes = [
    ["minimal", minimal],
    ["editorial", editorial],
    ["playful", playful],
  ] as const;

  it("registers every Phase 2 theme in THEMES under its id", () => {
    expect(THEMES.minimal).toBe(minimal);
    expect(THEMES.editorial).toBe(editorial);
    expect(THEMES.playful).toBe(playful);
  });

  it("exposes every theme id through BUILTIN_THEME_IDS in the canonical order", () => {
    expect(BUILTIN_THEME_IDS).toEqual([
      "modern-light",
      "modern-dark",
      "minimal",
      "editorial",
      "playful",
    ]);
  });

  for (const [id, theme] of phase2Themes) {
    it(`${id}: declares the full themable variable set on vars`, () => {
      // Each Phase 2 theme MUST define every variable name the
      // legacy modern-light theme defines so consumers don't fall
      // through to undefined for any themable property. (The
      // structural defaults from `CARD_SIZING_VARS` still apply
      // for non-themable knobs.)
      const themeKeys = new Set(theme.vars.map(([k]) => k));
      const baselineKeys = new Set(modernLight.vars.map(([k]) => k));
      expect(themeKeys).toEqual(baselineKeys);
    });

    it(`${id}: declares matching darkVars keys when present`, () => {
      if (!theme.darkVars) return;
      const darkKeys = new Set(theme.darkVars.map(([k]) => k));
      const lightKeys = new Set(theme.vars.map(([k]) => k));
      expect(darkKeys).toEqual(lightKeys);
    });
  }
});

describe("pickLegacyTheme", () => {
  it('maps "light" to modern-light without the dark media query', () => {
    expect(pickLegacyTheme("light")).toEqual({
      theme: modernLight,
      emitDarkMediaQuery: false,
    });
  });

  it('maps "dark" to modern-dark without the dark media query', () => {
    expect(pickLegacyTheme("dark")).toEqual({
      theme: modernDark,
      emitDarkMediaQuery: false,
    });
  });

  it('maps "auto" to modern-light WITH the dark media query', () => {
    expect(pickLegacyTheme("auto")).toEqual({
      theme: modernLight,
      emitDarkMediaQuery: true,
    });
  });
});
