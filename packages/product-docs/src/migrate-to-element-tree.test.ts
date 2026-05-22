import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hasElementTreePng, readElementTreePng } from "@ingcreators/annot-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildElementTreeFromLegacyBlocks,
  migrateMdxFile,
  parseLegacyAttributesYaml,
  resolvePngPath,
  stripLegacyCommentBlocks,
} from "./migrate-to-element-tree.js";

/** Smallest valid 1×1 transparent PNG, 67 bytes. */
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function tinyPngBytes(): Uint8Array {
  const bin = atob(TINY_PNG_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

describe("parseLegacyAttributesYaml", () => {
  it("parses one block per role+name header", () => {
    const yaml = [
      'button "Sign in":',
      "  type: submit",
      'textbox "Email":',
      "  type: email",
      '  required: ""',
    ].join("\n");
    const entries = parseLegacyAttributesYaml(yaml, ["type", "required"]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      role: "button",
      name: "Sign in",
      attributes: { type: "submit" },
    });
    expect(entries[1]).toEqual({
      role: "textbox",
      name: "Email",
      attributes: { type: "email", required: "" },
    });
  });

  it("drops keys not in the whitelist", () => {
    const yaml = ['button "Click":', "  type: submit", "  unsafe-attr: should-drop"].join("\n");
    const entries = parseLegacyAttributesYaml(yaml, ["type"]);
    expect(entries[0]?.attributes).toEqual({ type: "submit" });
  });

  it("returns empty array on empty input", () => {
    expect(parseLegacyAttributesYaml("", ["type"])).toEqual([]);
    expect(parseLegacyAttributesYaml("   \n", ["type"])).toEqual([]);
  });

  it("strips surrounding quotes from values", () => {
    const yaml = ['link "Home":', '  href: "/home"'].join("\n");
    const entries = parseLegacyAttributesYaml(yaml, ["href"]);
    expect(entries[0]?.attributes.href).toBe("/home");
  });
});

describe("buildElementTreeFromLegacyBlocks", () => {
  it("converts snapshot YAML into an ElementTree", () => {
    const tree = buildElementTreeFromLegacyBlocks({
      snapshotYaml: ["- main:", '  - heading "Sign in" [ref=e2]', '  - button "OK" [ref=e3]'].join(
        "\n",
      ),
      attributesYaml: "",
      whitelist: [],
    });
    expect(tree.source.kind).toBe("playwright");
    expect(tree.source.agent).toContain("migrate");
    expect(tree.root.role).toBe("main");
    expect(tree.root.children?.[0]?.name).toBe("Sign in");
    expect(tree.root.children?.[1]?.name).toBe("OK");
  });

  it("merges legacy attributes onto matching nodes", () => {
    const tree = buildElementTreeFromLegacyBlocks({
      snapshotYaml: ['- textbox "Email" [ref=e1]', '- button "Sign in" [ref=e2]'].join("\n"),
      attributesYaml: [
        'textbox "Email":',
        "  type: email",
        '  required: ""',
        'button "Sign in":',
        "  type: submit",
      ].join("\n"),
      whitelist: ["type", "required"],
    });
    // Tree wraps multi-top-level entries in a synthetic root.
    const email = tree.root.children?.[0];
    const button = tree.root.children?.[1];
    expect(email?.attributes).toEqual({ type: "email", required: "" });
    expect(button?.attributes).toEqual({ type: "submit" });
  });

  it("skips attribute entries that don't match exactly one node", () => {
    const tree = buildElementTreeFromLegacyBlocks({
      snapshotYaml: [
        '- button "Click" [ref=e1]',
        '- button "Click" [ref=e2]', // ambiguous
      ].join("\n"),
      attributesYaml: ['button "Click":', "  type: submit"].join("\n"),
      whitelist: ["type"],
    });
    expect(tree.root.children?.[0]?.attributes).toBeUndefined();
    expect(tree.root.children?.[1]?.attributes).toBeUndefined();
  });
});

describe("resolvePngPath", () => {
  it("resolves relative paths against the MDX dir", () => {
    const result = resolvePngPath("/abs/docs/login.mdx", "./shots/login.png");
    expect(result?.endsWith("login.png")).toBe(true);
    expect(result?.includes("shots")).toBe(true);
  });

  it("returns null for URL-like protocols", () => {
    expect(resolvePngPath("/abs/login.mdx", "https://example.com/img.png")).toBeNull();
    expect(resolvePngPath("/abs/login.mdx", "data:image/png;base64,abc")).toBeNull();
  });

  it("preserves absolute paths", () => {
    const result = resolvePngPath("/abs/login.mdx", "/srv/shots/foo.png");
    expect(result).toBe("/srv/shots/foo.png");
  });
});

describe("stripLegacyCommentBlocks", () => {
  it("removes both annot:snapshot and annot:attributes blocks", () => {
    const source = [
      "# Login",
      "",
      "{/* annot:snapshot",
      '- button "OK" [ref=e1]',
      "*/}",
      "",
      "{/* annot:attributes",
      'button "OK":',
      "  type: submit",
      "*/}",
      "",
      "Rest.",
    ].join("\n");
    const out = stripLegacyCommentBlocks(source);
    expect(out).not.toContain("annot:snapshot");
    expect(out).not.toContain("annot:attributes");
    expect(out).toContain("# Login");
    expect(out).toContain("Rest.");
  });

  it("is a no-op when no blocks are present", () => {
    const source = "# Hello\n\nBody.\n";
    expect(stripLegacyCommentBlocks(source)).toBe(source);
  });
});

describe("migrateMdxFile (integration)", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "annot-migrate-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  async function setupFixture(mdxBody: string): Promise<{ mdxPath: string; pngPath: string }> {
    const pngPath = join(tmp, "login.png");
    const mdxPath = join(tmp, "login.mdx");
    await writeFile(pngPath, tinyPngBytes());
    await writeFile(mdxPath, mdxBody, "utf8");
    return { mdxPath, pngPath };
  }

  it("writes ElementTree XMP to the referenced PNG and strips legacy blocks", async () => {
    const { mdxPath, pngPath } = await setupFixture(
      [
        "---",
        "annot:",
        "  id: login",
        "---",
        "",
        '<Screen id="login" src="./login.png">',
        '  <Overlay match={{ role: "textbox", name: "Email" }} intent="required" number={1}>Email</Overlay>',
        "</Screen>",
        "",
        "{/* annot:snapshot",
        '- textbox "Email" [ref=e1]',
        '- button "Sign in" [ref=e2]',
        "*/}",
        "",
        "{/* annot:attributes",
        'textbox "Email":',
        "  type: email",
        "*/}",
        "",
      ].join("\n"),
    );
    const result = await migrateMdxFile(mdxPath);
    expect(result.screens).toHaveLength(1);
    expect(result.screens[0]?.xmpWritten).toBe(true);
    expect(result.mdxRewritten).toBe(true);

    // PNG carries the chunk
    const pngBytes = new Uint8Array(await readFile(pngPath));
    expect(hasElementTreePng(pngBytes)).toBe(true);
    const tree = readElementTreePng(pngBytes);
    expect(tree?.root.children?.[0]?.name).toBe("Email");
    expect(tree?.root.children?.[0]?.attributes?.type).toBe("email");

    // MDX no longer carries the legacy blocks
    const updatedMdx = await readFile(mdxPath, "utf8");
    expect(updatedMdx).not.toContain("annot:snapshot");
    expect(updatedMdx).not.toContain("annot:attributes");
    expect(updatedMdx).toContain('<Screen id="login"');
  });

  it("dry-run reports without writing", async () => {
    const { mdxPath, pngPath } = await setupFixture(
      [
        "---",
        "annot:",
        "  id: login",
        "---",
        "",
        '<Screen id="login" src="./login.png">',
        '  <Overlay match={{ role: "button", name: "OK" }} intent="action" number={1}>Click</Overlay>',
        "</Screen>",
        "",
        "{/* annot:snapshot",
        '- button "OK" [ref=e1]',
        "*/}",
        "",
      ].join("\n"),
    );
    const result = await migrateMdxFile(mdxPath, { dryRun: true });
    expect(result.screens[0]?.xmpWritten).toBe(true);
    expect(result.mdxRewritten).toBe(false);

    const pngBytes = new Uint8Array(await readFile(pngPath));
    expect(hasElementTreePng(pngBytes)).toBe(false);
    const updatedMdx = await readFile(mdxPath, "utf8");
    expect(updatedMdx).toContain("annot:snapshot");
  });

  it("skips screens with no annot:snapshot block", async () => {
    const { mdxPath } = await setupFixture(
      [
        "---",
        "annot:",
        "  id: login",
        "---",
        "",
        '<Screen id="login" src="./login.png">',
        '  <Overlay match={{ role: "button", name: "OK" }} intent="action" number={1}>Click</Overlay>',
        "</Screen>",
        "",
      ].join("\n"),
    );
    const result = await migrateMdxFile(mdxPath);
    expect(result.screens[0]?.skipReason).toBe("no-snapshot");
  });

  it("is idempotent — re-running over a migrated file is a no-op for the MDX", async () => {
    const { mdxPath } = await setupFixture(
      [
        "---",
        "annot:",
        "  id: login",
        "---",
        "",
        '<Screen id="login" src="./login.png">',
        '  <Overlay match={{ role: "button", name: "OK" }} intent="action" number={1}>Click</Overlay>',
        "</Screen>",
        "",
        "{/* annot:snapshot",
        '- button "OK" [ref=e1]',
        "*/}",
        "",
      ].join("\n"),
    );
    await migrateMdxFile(mdxPath);
    const first = await readFile(mdxPath, "utf8");
    const second = await migrateMdxFile(mdxPath);
    expect(second.mdxRewritten).toBe(false);
    expect(second.screens[0]?.skipReason).toBe("no-snapshot");
    const after = await readFile(mdxPath, "utf8");
    expect(after).toBe(first);
  });
});
