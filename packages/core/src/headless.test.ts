// Default `node` environment — no `happy-dom`, no `document`, no `window`.
// This is the ENTIRE point of the test: importing `@ingcreators/annot-core/headless`
// must succeed in pure Node, the same way the future Playwright fixture and
// GitHub Action would. If any DOM-dependent symbol leaks into the headless
// barrel, the import below throws `ReferenceError: document is not defined`
// at module load time and the test fails.
//
// Stage 4-1 of `docs/plans/pre-release-cleanup.md` — codify the headless
// boundary so any new symbol that pulls in DOM access is caught before it
// breaks downstream consumers.

import { describe, expect, it } from "vitest";
import * as headless from "./headless.js";

describe("@ingcreators/annot-core/headless boundary", () => {
  it("imports cleanly under a pure-Node environment", () => {
    // The `import` above is the actual assertion — if it threw, vitest
    // would surface the load-time error long before this `it` runs. The
    // expect below just gives the test a visible body so the suite shows
    // up in the run output.
    expect(typeof headless).toBe("object");
  });

  it("exports the documented headless surface", () => {
    // Spot-check a representative symbol from each section of headless.ts
    // (storage types are erased at runtime, so they aren't checked here).
    expect(typeof headless.ANNOT_SVG_VERSION).toBe("string");
    expect(typeof headless.joinPath).toBe("function");
    expect(typeof headless.assertNonNull).toBe("function");
    expect(typeof headless.newIdB58).toBe("function");
    expect(typeof headless.buildZip).toBe("function");
    expect(typeof headless.computeDasharray).toBe("function");
    // Capability predicates added in Stage 2.
    expect(typeof headless.supportsResync).toBe("function");
    expect(typeof headless.supportsForceRefresh).toBe("function");
    expect(typeof headless.supportsTokenRefresher).toBe("function");
    // Capability predicate added in Phase 6a of
    // `docs/plans/_done/annot-html-document.md`.
    expect(typeof headless.supportsDocuments).toBe("function");
    // Capability predicate added in Phase 1 of
    // `docs/plans/shared-metadata-cache.md`. The error classes are
    // runtime constructors so they get spot-checked here too.
    expect(typeof headless.supportsMetadataCache).toBe("function");
    expect(typeof headless.MetadataCacheError).toBe("function");
    expect(typeof headless.MetadataCacheQuotaError).toBe("function");
    // Toolbar tool registry — Phase 1 of `docs/plans/toolbar-schema.md`.
    // Pure data + jsdom-friendly classifiers; loading the module here
    // proves it doesn't reach for `document` / `window` at import time.
    expect(typeof headless.TOOL_REGISTRY).toBe("object");
    expect(Array.isArray(headless.TOOL_REGISTRY_IDS)).toBe(true);
    // Storage error hierarchy — Phase 2 of
    // `docs/plans/storage-error-contract.md`. Exporting the base
    // class plus all four subclasses through headless makes them
    // usable from headless backends and Node-side test fixtures.
    expect(typeof headless.StorageError).toBe("function");
    expect(typeof headless.StorageConflictError).toBe("function");
    expect(typeof headless.StorageNotFoundError).toBe("function");
    expect(typeof headless.StoragePermissionError).toBe("function");
    expect(typeof headless.StorageQuotaError).toBe("function");
    // Icon spec descriptors — Phase 1 of
    // `docs/plans/svg-icons-and-plugin-icon-spec.md`. Tier A pure
    // types + constructor helpers + type guards — importing them
    // through headless proves they don't reach for DOM at module
    // load time.
    expect(typeof headless.builtinIcon).toBe("function");
    expect(typeof headless.svgIcon).toBe("function");
    expect(typeof headless.urlIcon).toBe("function");
    expect(typeof headless.isBuiltinIcon).toBe("function");
    expect(typeof headless.isSvgIcon).toBe("function");
    expect(typeof headless.isUrlIcon).toBe("function");
    // Icon registry — Phase 2 of
    // `docs/plans/svg-icons-and-plugin-icon-spec.md`. Pure data,
    // jsdom-loadable.
    expect(typeof headless.BUILTIN_ICONS).toBe("object");
    expect(Array.isArray(headless.BUILTIN_ICON_IDS)).toBe(true);
    expect(typeof headless.resolveBuiltinIcon).toBe("function");
    // Icon renderer + sanitiser — Phase 3 of the same plan. Tier-B
    // Element-takers; the actual DOMParser-driven path is exercised
    // in their own happy-dom-environment tests, so here we just
    // assert the surface is present and the import doesn't reach
    // for `document` at module load time.
    expect(typeof headless.renderIconHtml).toBe("function");
    expect(typeof headless.renderIconElement).toBe("function");
    expect(typeof headless.sanitizeIconSvg).toBe("function");
    // ElementTree — Phase 1a of `docs/plans/living-spec-authoring-roadmap.md`.
    // Tier A pure data types + serializers + traversal helpers.
    expect(typeof headless.isElementTreeShape).toBe("function");
    expect(typeof headless.serializeElementTreeToYaml).toBe("function");
    expect(typeof headless.parseElementTreeFromYaml).toBe("function");
    expect(typeof headless.serializeElementTreeToJson).toBe("function");
    expect(typeof headless.parseElementTreeFromJson).toBe("function");
    expect(typeof headless.validateElementTree).toBe("function");
    expect(typeof headless.walkTree).toBe("function");
    expect(typeof headless.findByRef).toBe("function");
    expect(typeof headless.findByMatch).toBe("function");
    expect(typeof headless.flattenTree).toBe("function");
    // ElementTree PNG XMP payload — Phase 1d of the same roadmap.
    expect(typeof headless.ELEMENT_TREE_ITXT_KEYWORD).toBe("string");
    expect(typeof headless.writeElementTreePng).toBe("function");
    expect(typeof headless.readElementTreePng).toBe("function");
    expect(typeof headless.hasElementTreePng).toBe("function");
  });

  it("does not leak `document` / `window` into the importing context", () => {
    // The `node` environment makes these globals undefined. If a
    // headless-side module had `(globalThis as any).document = …` in its
    // top-level code (a polyfill leak), this would catch it.
    // (`navigator` is intentionally not checked — Node 21+ exposes a
    // built-in `globalThis.navigator`, so its presence isn't a signal.)
    const g = globalThis as Record<string, unknown>;
    expect(g.document).toBeUndefined();
    expect(g.window).toBeUndefined();
  });
});

describe("@ingcreators/annot-core ↔ @ingcreators/annot-editor cycle prevention", () => {
  // Phase 1 of `docs/plans/three-package-split.md`. While the editor /
  // render package extraction is in progress, the temptation will be
  // strong to add a "convenience re-export" or "just-in-time import"
  // that points from `annot-core` back into `annot-editor` or
  // `annot-render`. Doing so is a circular package dependency and
  // would break bundling immediately.
  //
  // This test walks the Node module cache after importing the entire
  // `annot-core` surface (root + every documented subpath) and asserts
  // that no entry in the cache resolves under either editor or render
  // package paths. If any does, a `core/*` module imported it
  // transitively — exactly the regression we want to catch.
  //
  // Implementation note: we use the `node:module` `createRequire`
  // because `import.meta.url`-relative paths can't introspect the
  // ESM loader cache directly. The CJS-side `require.cache` reflects
  // the same dependency graph because vitest's test loader bridges
  // both module systems.

  it("no @ingcreators/annot-core module transitively imports annot-editor or annot-render", async () => {
    // Re-import each documented subpath so any module they pull in
    // shows up in the loader cache. Importing for side-effects is
    // sufficient — we only need them in the cache.
    await import("@ingcreators/annot-core");
    await import("@ingcreators/annot-core/headless");
    await import("@ingcreators/annot-core/storage");
    await import("@ingcreators/annot-core/utils");
    await import("@ingcreators/annot-core/icons");
    await import("@ingcreators/annot-core/element-tree");

    // Vitest's loader exposes the resolved module list via the
    // CJS-side `require.cache`. We avoid pulling `@types/node` into
    // the core tsconfig (which is configured with `"types": []` to
    // keep its surface deliberately small) by accessing the Node
    // APIs through a stringified dynamic import — TypeScript can't
    // statically resolve the module name, so it doesn't demand the
    // type package.
    const nodeModuleSpecifier = "node:module";
    const nodeModule = (await import(nodeModuleSpecifier)) as unknown as {
      default: { createRequire: (url: string) => { cache: Record<string, unknown> } };
    };
    const req = nodeModule.default.createRequire(import.meta.url);
    const cachedKeys = Object.keys(req.cache);
    const forbidden = cachedKeys.filter(
      (k) =>
        k.includes("/packages/editor/") ||
        k.includes("\\packages\\editor\\") ||
        k.includes("/packages/render/") ||
        k.includes("\\packages\\render\\"),
    );
    expect(
      forbidden,
      `@ingcreators/annot-core must not transitively import annot-editor / annot-render. Offending paths: ${forbidden.join(", ")}`,
    ).toEqual([]);
  });
});
