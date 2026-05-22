/**
 * Phase 2d of `docs/plans/living-spec-authoring-roadmap.md`.
 * Tests for the inline-`<Overlay>` → annotation yaml migration.
 */

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ANNOTATIONS_YAML_VERSION, parseAnnotationsYaml } from "./annotations-yaml.js";
import { parseMdxFile } from "./mdx.js";
import {
  buildAnnotationsFile,
  migrateOverlaysToAnnotationsFile,
} from "./migrate-overlays-to-annotations.js";

const LEGACY_MDX = `---
annot:
  id: SC-001
  title: Login screen
---

import { Screen, Overlay } from "@ingcreators/annot-product-docs-astro";

# Login

<Screen id="login" src="./shots/login.png">

<Overlay match={{ role: "textbox", name: "Email" }} intent="required" number={1}>
**Email** — enter your registered address.
</Overlay>

<Overlay match={{ role: "button", name: "Sign in" }} intent="action" number={2}>
Click to POST /api/auth/sign-in
</Overlay>

</Screen>
`;

async function makeFixture(mdxSource: string): Promise<{ mdxPath: string; pngPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "annot-migrate-overlays-"));
  const mdxPath = join(dir, "login.mdx");
  const shotsDir = join(dir, "shots");
  const pngPath = join(shotsDir, "login.png");
  await writeFile(mdxPath, mdxSource, "utf8");
  // Touch a sentinel PNG so the yamlPath calculation has something
  // to land next to. The migration doesn't touch the PNG bytes
  // itself.
  await import("node:fs/promises").then((fs) => fs.mkdir(shotsDir, { recursive: true }));
  await writeFile(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]), { flag: "w" });
  return { mdxPath, pngPath };
}

describe("buildAnnotationsFile", () => {
  it("assigns sequential o-ids and preserves intent + number", () => {
    const file = buildAnnotationsFile([
      {
        match: { role: "textbox", name: "Email" },
        intent: "required",
        number: 1,
        body: "Email body",
      },
      {
        match: { role: "button", name: "Sign in" },
        intent: "action",
        number: 2,
        body: "Sign in body",
      },
    ]);
    expect(file.version).toBe(ANNOTATIONS_YAML_VERSION);
    expect(file.overlays).toEqual([
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
        intent: "action",
        number: 2,
      },
    ]);
    // Generator stamp so we can spot migrated files in audit.
    expect(file.meta?.generator).toMatch(/migrate-overlays-to-annotations/);
  });

  it("defaults number to the overlay index when missing", () => {
    const file = buildAnnotationsFile([
      { match: { role: "button", name: "A" }, body: "" },
      { match: { role: "button", name: "B" }, body: "" },
    ]);
    expect(file.overlays.map((o) => o.number)).toEqual([1, 2]);
  });
});

describe("migrateOverlaysToAnnotationsFile", () => {
  it("dry-run: reports what would happen without touching disk", async () => {
    const { mdxPath } = await makeFixture(LEGACY_MDX);
    const result = await migrateOverlaysToAnnotationsFile(mdxPath, { dryRun: true });
    expect(result.mdxRewritten).toBe(false);
    expect(result.screens).toHaveLength(1);
    expect(result.screens[0]?.id).toBe("login");
    expect(result.screens[0]?.overlayCount).toBe(2);
    expect(result.screens[0]?.yamlWritten).toBe(false);
    expect(result.screens[0]?.yamlPath).toMatch(/login\.annotations\.yaml$/);
    // MDX source untouched.
    const reread = await readFile(mdxPath, "utf8");
    expect(reread).toBe(LEGACY_MDX);
  });

  it("writes yaml + rewrites MDX into `<AnnotCallout for>` form", async () => {
    const { mdxPath } = await makeFixture(LEGACY_MDX);
    const result = await migrateOverlaysToAnnotationsFile(mdxPath);
    expect(result.mdxRewritten).toBe(true);
    expect(result.screens[0]?.yamlWritten).toBe(true);

    // Yaml exists + round-trips through the parser.
    const yamlPath = result.screens[0]!.yamlPath!;
    const yamlSource = await readFile(yamlPath, "utf8");
    const parsed = parseAnnotationsYaml(yamlSource);
    expect(parsed.overlays).toHaveLength(2);
    expect(parsed.overlays[0]).toMatchObject({
      id: "o1",
      match: { role: "textbox", name: "Email" },
      intent: "required",
      number: 1,
    });

    // MDX rewrite: `annotations` prop on Screen + `<AnnotCallout>`
    // bodies preserved.
    const rewrittenMdx = await readFile(mdxPath, "utf8");
    expect(rewrittenMdx).toMatch(/<Screen[^>]*annotations="\.\/shots\/login\.annotations\.yaml"/);
    expect(rewrittenMdx).toMatch(/<AnnotCallout for="o1">[\s\S]*?<\/AnnotCallout>/);
    expect(rewrittenMdx).toMatch(/<AnnotCallout for="o2">[\s\S]*?<\/AnnotCallout>/);
    expect(rewrittenMdx).not.toMatch(/<Overlay\b/);
    // Body content preserved verbatim.
    expect(rewrittenMdx).toContain("**Email** — enter your registered address.");
    expect(rewrittenMdx).toContain("Click to POST /api/auth/sign-in");

    // Re-parsing the rewritten MDX produces a screen with the new
    // shape: annotations set, callouts populated, overlays empty.
    const reparsed = await parseMdxFile(mdxPath);
    expect(reparsed?.screens[0]?.annotations).toBe("./shots/login.annotations.yaml");
    expect(reparsed?.screens[0]?.callouts.map((c) => c.for)).toEqual(["o1", "o2"]);
    expect(reparsed?.screens[0]?.overlays).toHaveLength(0);
  });

  it("idempotent: re-running over a migrated MDX is a no-op", async () => {
    const { mdxPath } = await makeFixture(LEGACY_MDX);
    await migrateOverlaysToAnnotationsFile(mdxPath);
    const sourceAfterFirstRun = await readFile(mdxPath, "utf8");

    const result = await migrateOverlaysToAnnotationsFile(mdxPath);
    expect(result.mdxRewritten).toBe(false);
    expect(result.screens[0]?.skipReason).toBe("already-migrated");
    const sourceAfterSecondRun = await readFile(mdxPath, "utf8");
    expect(sourceAfterSecondRun).toBe(sourceAfterFirstRun);
  });

  it("skips screens without `<Overlay>` children", async () => {
    const mdx = `---
annot:
  id: SC-002
---

import { Screen } from "@ingcreators/annot-product-docs-astro";

<Screen id="empty" src="./shots/empty.png">
</Screen>
`;
    const { mdxPath } = await makeFixture(mdx);
    const result = await migrateOverlaysToAnnotationsFile(mdxPath);
    expect(result.screens[0]?.skipReason).toBe("no-overlays");
    expect(result.mdxRewritten).toBe(false);
  });

  it("skips screens with no `src`", async () => {
    const mdx = `---
annot:
  id: SC-003
---

import { Screen, Overlay } from "@ingcreators/annot-product-docs-astro";

<Screen id="srcless">
<Overlay match={{ role: "button", name: "OK" }} number={1}>OK</Overlay>
</Screen>
`;
    const { mdxPath } = await makeFixture(mdx);
    const result = await migrateOverlaysToAnnotationsFile(mdxPath);
    expect(result.screens[0]?.skipReason).toBe("no-src");
    expect(result.mdxRewritten).toBe(false);
  });

  it("returns null-screens for MDX without `annot:` frontmatter", async () => {
    const { mdxPath } = await makeFixture("# Just plain\n");
    const result = await migrateOverlaysToAnnotationsFile(mdxPath);
    expect(result.screens).toEqual([]);
    expect(result.mdxRewritten).toBe(false);
  });

  it("respects yamlPathFor override", async () => {
    const { mdxPath } = await makeFixture(LEGACY_MDX);
    const result = await migrateOverlaysToAnnotationsFile(mdxPath, {
      yamlPathFor: ({ mdxPath: m, screenId }) =>
        join(m, "..", "..", "custom", `${screenId}.annotations.yaml`),
    });
    expect(result.screens[0]?.yamlPath).toMatch(/custom[\\/]login\.annotations\.yaml$/);
  });
});
