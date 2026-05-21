import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { handleTranslateScreenSpec } from "./translate-screen-spec.js";

const SAMPLE_MDX = `---
annot:
  id: SC-001
  title: ログイン画面
  purpose: 認証情報を入力する
---

import { Screen, Overlay } from "@ingcreators/annot-product-docs-astro";

# ログイン画面

<Screen id="login" src="./shot.png">

<Overlay match={{ role: "textbox", name: "Email" }} number={1}>
**メール** を入力してください。
</Overlay>

<Overlay match={{ role: "button", name: "Sign in" }} number={2}>
クリックでログイン。
</Overlay>

</Screen>
`;

describe("handleTranslateScreenSpec", () => {
  it("errors on missing mdxPath / targetLocale", async () => {
    const r1 = await handleTranslateScreenSpec({});
    expect(r1.isError).toBe(true);
    const r2 = await handleTranslateScreenSpec({ mdxPath: "x.mdx" });
    expect(r2.isError).toBe(true);
  });

  it("errors when MDX has no annot frontmatter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "annot-mcp-translate-"));
    const mdxPath = join(dir, "plain.mdx");
    await writeFile(mdxPath, "# plain\n");
    const r = await handleTranslateScreenSpec({ mdxPath, targetLocale: "en-US" });
    expect(r.isError).toBe(true);
  });

  it("emits a JSON manifest with one item per translatable string", async () => {
    const dir = await mkdtemp(join(tmpdir(), "annot-mcp-translate-"));
    const mdxPath = join(dir, "screen.mdx");
    await writeFile(mdxPath, SAMPLE_MDX);
    const result = await handleTranslateScreenSpec({
      mdxPath,
      sourceLocale: "ja-JP",
      targetLocale: "en-US",
    });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.id).toBe("SC-001");
    expect(payload.sourceLocale).toBe("ja-JP");
    expect(payload.targetLocale).toBe("en-US");
    // title + purpose + 2 overlays = 4 items
    expect(payload.items).toHaveLength(4);
    expect(payload.items[0].location.kind).toBe("frontmatter.title");
    expect(payload.items[0].source).toBe("ログイン画面");
    expect(payload.items[1].location.kind).toBe("frontmatter.purpose");
    const overlayItems = payload.items.filter(
      (i: { location: { kind: string } }) => i.location.kind === "overlay.body",
    );
    expect(overlayItems).toHaveLength(2);
    expect(overlayItems[0].location.screenId).toBe("login");
    expect(overlayItems[0].location.matchRole).toBe("textbox");
    expect(overlayItems[0].location.matchName).toBe("Email");
  });
});
