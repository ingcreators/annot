// Unit tests for the `productDocs` fixture's standalone helpers.
//
// Same approach as `@ingcreators/annot-playwright`'s
// `fixture.test.ts`: stub the Playwright `Page` surface we
// actually use (`getByRole().count()`, `getByRole().evaluate()`,
// `locator("body").ariaSnapshot()`) and assert on the side
// effects. A real Playwright runner is overkill for the
// rewrite-MDX behaviour we care about here.

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { collectAttributesYaml, syncProductDocs } from "./fixture.js";
import type { OverlaySpec } from "./types.js";

const FIXTURE_MDX = `---
annot:
  id: SC-001
  title: Login screen
---

import { Screen, Overlay } from "@ingcreators/annot-product-docs-astro";

# Login screen

<Screen id="login" src="./shots/login.png">
<Overlay match={{ role: "textbox", name: "Email" }}>
Enter email.
</Overlay>
<Overlay match={{ role: "button", name: "Sign in" }}>
Click to sign in.
</Overlay>
</Screen>
`;

/**
 * Build a stub Playwright `Page` that returns canned aria-snapshot
 * YAML for `body` and canned attribute maps for each `getByRole`
 * lookup keyed by `role + name`.
 */
function makeStubPage(opts: {
  snapshotYaml: string;
  perElement?: Record<string, Record<string, string>>;
}): Page {
  type StubLocator = {
    count(): Promise<number>;
    evaluate<R>(fn: (el: Element, arg: readonly string[]) => R, arg: readonly string[]): Promise<R>;
    ariaSnapshot(): Promise<string>;
  };
  const elementFor = (key: string): Element | null => {
    const attrs = opts.perElement?.[key];
    if (!attrs) return null;
    // Build a real DOM element so the `el.getAttribute` calls
    // inside the page-side `evaluate` callback run for real
    // when we invoke it directly on the Node side.
    const el: Partial<Element> = {
      getAttribute(name: string) {
        return attrs[name] ?? null;
      },
    };
    return el as Element;
  };
  const stub = (key: string): StubLocator => ({
    async count() {
      return opts.perElement?.[key] ? 1 : 0;
    },
    async evaluate(fn, arg) {
      const el = elementFor(key);
      if (!el) throw new Error(`stub: no element for ${key}`);
      return fn(el, arg);
    },
    async ariaSnapshot() {
      return opts.snapshotYaml;
    },
  });
  const page: Partial<Page> = {
    getByRole: ((role: string, options?: { name?: string }) =>
      stub(`${role}|${options?.name ?? ""}`)) as Page["getByRole"],
    locator: ((selector: string) => {
      if (selector === "body") {
        return stub("__root__") as unknown as ReturnType<Page["locator"]>;
      }
      return stub("__unknown__") as unknown as ReturnType<Page["locator"]>;
    }) as Page["locator"],
  };
  return page as Page;
}

describe("collectAttributesYaml", () => {
  const overlays: OverlaySpec[] = [
    {
      match: { role: "textbox", name: "Email" },
      body: "Enter email.",
    },
    {
      match: { role: "button", name: "Sign in" },
      body: "Click to sign in.",
    },
  ];

  it("emits one YAML section per resolvable overlay", async () => {
    const page = makeStubPage({
      snapshotYaml: "",
      perElement: {
        "textbox|Email": { type: "email", required: "true", maxlength: "255" },
        "button|Sign in": { type: "submit" },
      },
    });
    const yaml = await collectAttributesYaml(page, overlays, ["type", "required", "maxlength"]);
    expect(yaml).toContain('textbox "Email":');
    expect(yaml).toContain("type: email");
    expect(yaml).toContain("required: true");
    expect(yaml).toContain("maxlength: 255");
    expect(yaml).toContain('button "Sign in":');
    expect(yaml).toContain("type: submit");
  });

  it("skips overlays whose match has zero hits", async () => {
    const page = makeStubPage({
      snapshotYaml: "",
      perElement: {
        "textbox|Email": { type: "email" },
        // No `button|Sign in` entry — locator count() returns 0.
      },
    });
    const yaml = await collectAttributesYaml(page, overlays, ["type"]);
    expect(yaml).toContain('textbox "Email":');
    expect(yaml).not.toContain('button "Sign in":');
  });

  it("skips overlays with no whitelisted attrs", async () => {
    const page = makeStubPage({
      snapshotYaml: "",
      perElement: {
        // `name` is present on the element but NOT in the
        // whitelist passed below, so the section is skipped.
        "textbox|Email": { name: "email-field" },
      },
    });
    const yaml = await collectAttributesYaml(page, overlays, ["type", "required"]);
    expect(yaml).not.toContain('textbox "Email":');
  });
});

describe("syncProductDocs", () => {
  async function writeFixture(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "annot-product-docs-test-"));
    const mdxPath = join(dir, "screen.mdx");
    await writeFile(mdxPath, FIXTURE_MDX, "utf8");
    return mdxPath;
  }

  it("writes annot:snapshot and annot:attributes blocks into the MDX file", async () => {
    const mdxPath = await writeFixture();
    const page = makeStubPage({
      snapshotYaml: `- textbox "Email" [ref=e3]
- button "Sign in" [ref=e9]`,
      perElement: {
        "textbox|Email": { type: "email", required: "true" },
        "button|Sign in": { type: "submit" },
      },
    });
    await syncProductDocs(page, { id: "login", mdxPath });
    const updated = await readFile(mdxPath, "utf8");
    expect(updated).toContain("{/* annot:snapshot");
    expect(updated).toContain('textbox "Email" [ref=e3]');
    expect(updated).toContain('button "Sign in" [ref=e9]');
    expect(updated).toContain("{/* annot:attributes");
    expect(updated).toContain("type: email");
    expect(updated).toContain("required: true");
    // Body text outside the comment blocks is preserved.
    expect(updated).toContain("# Login screen");
    expect(updated).toContain("Enter email.");
  });

  it("throws when the target MDX has no annot frontmatter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "annot-product-docs-test-"));
    const mdxPath = join(dir, "plain.mdx");
    await writeFile(mdxPath, "# Just plain MDX\n", "utf8");
    const page = makeStubPage({ snapshotYaml: "" });
    await expect(syncProductDocs(page, { id: "x", mdxPath })).rejects.toThrow(
      /no `annot:` frontmatter/,
    );
  });

  it("throws when the requested screen id is missing from the file", async () => {
    const mdxPath = await writeFixture();
    const page = makeStubPage({ snapshotYaml: "" });
    await expect(syncProductDocs(page, { id: "does-not-exist", mdxPath })).rejects.toThrow(
      /has no <Screen id="does-not-exist">/,
    );
  });

  it("is idempotent — second call replaces existing blocks", async () => {
    const mdxPath = await writeFixture();
    const page1 = makeStubPage({
      snapshotYaml: '- textbox "Email" [ref=e1]',
      perElement: { "textbox|Email": { type: "email" } },
    });
    await syncProductDocs(page1, { id: "login", mdxPath });

    const page2 = makeStubPage({
      snapshotYaml: '- textbox "Email" [ref=e7]\n- button "Sign in" [ref=e9]',
      perElement: {
        "textbox|Email": { type: "email", required: "true" },
        "button|Sign in": { type: "submit" },
      },
    });
    await syncProductDocs(page2, { id: "login", mdxPath });

    const updated = await readFile(mdxPath, "utf8");
    expect(updated).toContain("[ref=e7]");
    expect(updated).toContain("[ref=e9]");
    expect(updated).not.toContain("[ref=e1]");
    expect(updated).toContain("required: true");
    // One snapshot block, one attributes block — not stacked.
    expect(updated.match(/annot:snapshot/g)).toHaveLength(1);
    expect(updated.match(/annot:attributes/g)).toHaveLength(1);
  });
});
