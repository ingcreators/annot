import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ANNOTATIONS_YAML_VERSION,
  type AnnotationsFile,
  parseMdx,
} from "@ingcreators/annot-product-docs";
import { describe, expect, it } from "vitest";

import { extractFromParsed, extractMdxFile } from "./extract.js";

const SAMPLE_MDX = `---
annot:
  id: SC-001
  title: Login
  xlsx:
    book: Spec
    sheet: Login
    role: screen
    order: 100
---

import { Screen, Overlay } from "@ingcreators/annot-product-docs-astro";

# Login

<Screen id="login" src="./shot.png">
<Overlay match={{ role: "textbox", name: "Email" }} intent="required" number={1}>
**Email** body
</Overlay>
<Overlay match={{ role: "button", name: "Sign in" }} intent="action" number={2}>
Click to submit
</Overlay>
</Screen>
`;

describe("extractFromParsed", () => {
  it("normalises screens + overlays into flat rows", () => {
    const parsed = parseMdx(SAMPLE_MDX);
    expect(parsed).not.toBeNull();
    const bundle = extractFromParsed(parsed!, "test.mdx");

    expect(bundle.frontmatter.id).toBe("SC-001");
    expect(bundle.screens).toHaveLength(1);
    expect(bundle.screens[0]).toEqual({
      id: "login",
      src: "./shot.png",
      overlayCount: 2,
    });
    expect(bundle.overlays).toHaveLength(2);
    expect(bundle.overlays[0]).toEqual({
      screenId: "login",
      number: 1,
      intent: "required",
      matchLabel: 'textbox "Email"',
      matchRole: "textbox",
      matchName: "Email",
      body: "**Email** body",
    });
    expect(bundle.overlays[1]?.intent).toBe("action");
  });

  it("auto-numbers overlays missing explicit `number`", () => {
    const mdx = `---
annot:
  id: X
---

import { Screen, Overlay } from "@ingcreators/annot-product-docs-astro";

<Screen id="s" src="./x.png">
<Overlay match={{ role: "button", name: "A" }}>A</Overlay>
<Overlay match={{ role: "button", name: "B" }} number={5}>B</Overlay>
<Overlay match={{ role: "button", name: "C" }}>C</Overlay>
</Screen>
`;
    const parsed = parseMdx(mdx);
    const bundle = extractFromParsed(parsed!, "test.mdx");
    expect(bundle.overlays.map((o) => o.number)).toEqual([1, 5, 2]);
  });

  it("formats matchLabel with `under` for disambiguated overlays", () => {
    const mdx = `---
annot:
  id: X
---

import { Screen, Overlay } from "@ingcreators/annot-product-docs-astro";

<Screen id="s" src="./x.png">
<Overlay match={{ role: "button", name: "OK", under: { role: "dialog", name: "Confirm" } }}>
OK
</Overlay>
</Screen>
`;
    const parsed = parseMdx(mdx);
    const bundle = extractFromParsed(parsed!, "test.mdx");
    expect(bundle.overlays[0]?.matchLabel).toBe('button "OK" under dialog "Confirm"');
  });
});

// ─── Phase 3d — yaml-driven extraction ─────────────────────────

const YAML_DRIVEN_MDX = `---
annot:
  id: SC-001
  title: Login
  xlsx:
    book: Spec
    role: screen
---

import { Screen, AnnotCallout } from "@ingcreators/annot-product-docs-astro";

<Screen id="login" src="./shot.png" annotations="./login.annotations.yaml">
<AnnotCallout for="o1">**Email** body</AnnotCallout>
<AnnotCallout for="o2">Click to submit</AnnotCallout>
</Screen>
`;

const YAML_DRIVEN_FILE: AnnotationsFile = {
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
      intent: "action",
      number: 2,
    },
  ],
  // annotations[] entries are deliberately NOT surfaced as rows —
  // image-only visual marking. The xlsx adapter's items table
  // stays scoped to overlays[].
  annotations: [
    {
      id: "a1",
      kind: "arrow",
      from: { match: { role: "textbox", name: "Email" } },
      to: { match: { role: "button", name: "Sign in" } },
    },
  ],
};

describe("Phase 3d — extractFromParsed (yaml-driven)", () => {
  it("uses yaml `overlays[]` for rows when the context map carries the screen's annotation file", () => {
    const parsed = parseMdx(YAML_DRIVEN_MDX);
    const bundle = extractFromParsed(parsed!, "test.mdx", {
      annotationsYamlByPath: new Map([["./login.annotations.yaml", YAML_DRIVEN_FILE]]),
    });
    expect(bundle.screens).toHaveLength(1);
    expect(bundle.screens[0]?.overlayCount).toBe(2);
    expect(bundle.overlays).toHaveLength(2);
    expect(bundle.overlays[0]).toEqual({
      screenId: "login",
      number: 1,
      intent: "required",
      matchLabel: 'textbox "Email"',
      matchRole: "textbox",
      matchName: "Email",
      body: "**Email** body",
    });
    expect(bundle.overlays[1]).toEqual({
      screenId: "login",
      number: 2,
      intent: "action",
      matchLabel: 'button "Sign in"',
      matchRole: "button",
      matchName: "Sign in",
      body: "Click to submit",
    });
  });

  it("emits empty body when an overlay has no matching <AnnotCallout for>", () => {
    const mdx = `---
annot:
  id: SC-001
---

import { Screen } from "@ingcreators/annot-product-docs-astro";

<Screen id="login" src="./shot.png" annotations="./login.annotations.yaml" />
`;
    const parsed = parseMdx(mdx);
    const bundle = extractFromParsed(parsed!, "test.mdx", {
      annotationsYamlByPath: new Map([["./login.annotations.yaml", YAML_DRIVEN_FILE]]),
    });
    expect(bundle.overlays).toHaveLength(2);
    expect(bundle.overlays.every((o) => o.body === "")).toBe(true);
  });

  it("annotations[] does NOT contribute rows", () => {
    const parsed = parseMdx(YAML_DRIVEN_MDX);
    const bundle = extractFromParsed(parsed!, "test.mdx", {
      annotationsYamlByPath: new Map([["./login.annotations.yaml", YAML_DRIVEN_FILE]]),
    });
    // YAML_DRIVEN_FILE has 1 annotation; bundle.overlays still just
    // 2 (one per yaml overlay), no extras for the arrow annotation.
    expect(bundle.overlays).toHaveLength(2);
    expect(
      bundle.overlays.find((o) => o.matchName === "Sign in" && o.matchLabel.includes("→")),
    ).toBeUndefined();
  });

  it("falls back to inline overlays for screens whose yaml isn't in the context map", () => {
    const parsed = parseMdx(SAMPLE_MDX); // inline-overlay MDX from above
    const bundle = extractFromParsed(parsed!, "test.mdx", {
      annotationsYamlByPath: new Map(),
    });
    // Inline overlays still drive the rows.
    expect(bundle.overlays).toHaveLength(2);
    expect(bundle.overlays[0]?.body).toBe("**Email** body");
  });
});

describe("Phase 3d — extractMdxFile loads yaml from disk", () => {
  it("loads + parses each <Screen annotations> yaml before extracting", async () => {
    const dir = await mkdtemp(join(tmpdir(), "annot-xlsx-extract-yaml-"));
    const mdxPath = join(dir, "screen.mdx");
    const yamlPath = join(dir, "login.annotations.yaml");
    await writeFile(mdxPath, YAML_DRIVEN_MDX);
    await writeFile(
      yamlPath,
      `version: 1
overlays:
  - id: o1
    kind: numberedBadge
    match: { role: textbox, name: Email }
    intent: required
    number: 1
  - id: o2
    kind: numberedBadge
    match: { role: button, name: "Sign in" }
    intent: action
    number: 2
`,
    );
    const bundle = await extractMdxFile(mdxPath);
    expect(bundle).not.toBeNull();
    expect(bundle!.overlays).toHaveLength(2);
    expect(bundle!.overlays[0]?.body).toBe("**Email** body");
    expect(bundle!.overlays[1]?.body).toBe("Click to submit");
  });

  it("throws loudly when a referenced yaml file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "annot-xlsx-extract-missing-"));
    const mdxPath = join(dir, "screen.mdx");
    await writeFile(mdxPath, YAML_DRIVEN_MDX);
    // No yaml file on disk.
    await expect(extractMdxFile(mdxPath)).rejects.toThrow(
      /failed to read.*login\.annotations\.yaml/,
    );
  });
});
