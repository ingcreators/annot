import { describe, expect, it } from "vitest";

import { parseMdx, updateCommentBlocks } from "./mdx.js";

const LOGIN_MDX = `---
annot:
  id: SC-001
  title: Login screen
  meta:
    author: Alice
  xlsx:
    book: Screen spec
    sheet: SC-001 login
    role: screen
    order: 100
---

import { Screen, Overlay } from "@ingcreators/annot-product-docs-astro";

# Login screen

<Screen id="login" src="./shots/login.png">

<Overlay match={{ role: "textbox", name: "Email" }} intent="required" number={1}>
**Email** — enter your company email address.
</Overlay>

<Overlay match={{ role: "button", name: "Sign in" }} intent="action" number={2}>
Click to POST /api/auth/sign-in
</Overlay>

</Screen>

{/* annot:snapshot
- textbox "Email" [ref=e3]
- textbox "Password" [ref=e5]
- button "Sign in" [ref=e9]
*/}
`;

describe("parseMdx", () => {
  it("returns null for plain MDX without annot frontmatter", () => {
    const out = parseMdx("# Just a regular MDX\n\nNo annot here.\n");
    expect(out).toBeNull();
  });

  it("extracts the annot frontmatter via Zod", () => {
    const parsed = parseMdx(LOGIN_MDX);
    expect(parsed).not.toBeNull();
    const { frontmatter } = parsed!;
    expect(frontmatter.id).toBe("SC-001");
    expect(frontmatter.title).toBe("Login screen");
    expect(frontmatter.meta?.["author"]).toBe("Alice");
    expect(frontmatter.xlsx?.book).toBe("Screen spec");
    expect(frontmatter.xlsx?.sheet).toBe("SC-001 login");
    expect(frontmatter.xlsx?.role).toBe("screen");
    expect(frontmatter.xlsx?.order).toBe(100);
  });

  it("extracts <Screen> + nested <Overlay> with structured `match` props", () => {
    const parsed = parseMdx(LOGIN_MDX);
    const screens = parsed!.screens;
    expect(screens).toHaveLength(1);
    const [screen] = screens;
    expect(screen?.id).toBe("login");
    expect(screen?.src).toBe("./shots/login.png");
    expect(screen?.overlays).toHaveLength(2);

    const [emailOverlay, signinOverlay] = screen!.overlays;
    expect(emailOverlay?.match).toEqual({ role: "textbox", name: "Email" });
    expect(emailOverlay?.intent).toBe("required");
    expect(emailOverlay?.number).toBe(1);
    expect(emailOverlay?.body).toMatch(/^\*\*Email\*\*/);

    expect(signinOverlay?.match).toEqual({ role: "button", name: "Sign in" });
    expect(signinOverlay?.intent).toBe("action");
    expect(signinOverlay?.number).toBe(2);
  });

  it("extracts annot:snapshot comment block", () => {
    const parsed = parseMdx(LOGIN_MDX);
    expect(parsed!.commentBlocks.snapshot).toContain('textbox "Email" [ref=e3]');
    expect(parsed!.commentBlocks.snapshot).toContain('button "Sign in" [ref=e9]');
  });

  it("parses nested `under` in match prop", () => {
    const source = `---
annot:
  id: SC-X
---

import { Screen, Overlay } from "@ingcreators/annot-product-docs-astro";

<Screen id="dlg" src="./x.png">

<Overlay match={{ role: "button", name: "OK", under: { role: "dialog", name: "Confirm" } }} intent="action" number={1}>
Confirm OK
</Overlay>

</Screen>
`;
    const parsed = parseMdx(source);
    const overlay = parsed!.screens[0]?.overlays[0];
    expect(overlay?.match).toEqual({
      role: "button",
      name: "OK",
      under: { role: "dialog", name: "Confirm" },
    });
  });

  it("Phase 2b — extracts <Screen annotations> + <AnnotCallout> children", () => {
    const source = `---
annot:
  id: SC-001
---

import { Screen, AnnotCallout } from "@ingcreators/annot-product-docs-astro";

<Screen id="login" src="./shots/login.png" annotations="./login.annotations.yaml">

<AnnotCallout for="o1">
**Email** — enter your registered email.
</AnnotCallout>

<AnnotCallout for="o2">
**Password** — characters are hidden.
</AnnotCallout>

</Screen>
`;
    const parsed = parseMdx(source);
    const screen = parsed!.screens[0]!;
    expect(screen.id).toBe("login");
    expect(screen.annotations).toBe("./login.annotations.yaml");
    expect(screen.overlays).toHaveLength(0);
    expect(screen.callouts).toHaveLength(2);
    expect(screen.callouts[0]).toMatchObject({ for: "o1" });
    expect(screen.callouts[0]?.body).toMatch(/^\*\*Email\*\*/);
    expect(screen.callouts[1]?.for).toBe("o2");
  });

  it("Phase 2b — <Screen annotations> is optional; legacy `<Overlay>` path still works", () => {
    const parsed = parseMdx(LOGIN_MDX);
    const screen = parsed!.screens[0]!;
    expect(screen.annotations).toBeUndefined();
    expect(screen.callouts).toEqual([]);
    expect(screen.overlays).toHaveLength(2);
  });

  it("Phase 2b — <AnnotCallout> missing `for` throws", () => {
    const source = `---
annot:
  id: X
---

import { Screen, AnnotCallout } from "@ingcreators/annot-product-docs-astro";

<Screen id="s" src="./x.png" annotations="./s.yaml">

<AnnotCallout>oops</AnnotCallout>

</Screen>
`;
    expect(() => parseMdx(source)).toThrow(/<AnnotCallout> requires a `for=/);
  });

  it("throws on invalid frontmatter (Zod surfaces the path)", () => {
    const source = `---
annot:
  title: missing id
---

# Body
`;
    expect(() => parseMdx(source, { filePath: "bad.mdx" })).toThrow(/bad\.mdx/);
  });

  it("throws on <Screen> missing id", () => {
    const source = `---
annot:
  id: X
---

import { Screen } from "@ingcreators/annot-product-docs-astro";

<Screen src="./x.png">
hi
</Screen>
`;
    expect(() => parseMdx(source)).toThrow(/<Screen> requires an `id` prop/);
  });

  it("throws on <Overlay> missing match", () => {
    const source = `---
annot:
  id: X
---

import { Screen, Overlay } from "@ingcreators/annot-product-docs-astro";

<Screen id="s" src="./x.png">

<Overlay intent="action" number={1}>
oops
</Overlay>

</Screen>
`;
    expect(() => parseMdx(source)).toThrow(/<Overlay> requires a `match` prop/);
  });

  it("collects <HistoryEntry> blocks", () => {
    const source = `---
annot:
  id: HIST
  xlsx:
    role: history
---

import { HistoryEntry } from "@ingcreators/annot-product-docs-astro";

<HistoryEntry version="1.0" date="2026-03-15" author="Alice">
Initial draft.
</HistoryEntry>

<HistoryEntry version="1.1" date="2026-04-02" author="Bob">
Review fixes for SC-005.
</HistoryEntry>
`;
    const parsed = parseMdx(source);
    expect(parsed!.history).toHaveLength(2);
    expect(parsed!.history[0]?.version).toBe("1.0");
    expect(parsed!.history[0]?.body).toBe("Initial draft.");
    expect(parsed!.history[1]?.author).toBe("Bob");
  });

  it("collects <ScreenList>", () => {
    const source = `---
annot:
  id: LIST
  xlsx:
    role: list
---

import { ScreenList } from "@ingcreators/annot-product-docs-astro";

<ScreenList book="Screen spec" sort="byId" />
`;
    const parsed = parseMdx(source);
    expect(parsed!.screenLists).toHaveLength(1);
    expect(parsed!.screenLists[0]).toEqual({ book: "Screen spec", sort: "byId" });
  });
});

describe("updateCommentBlocks", () => {
  it("replaces an existing annot:snapshot block in place", () => {
    const before = `# Title

{/* annot:snapshot
- textbox "Email" [ref=e3]
*/}

After.
`;
    const after = updateCommentBlocks(before, {
      snapshot: '- textbox "Email" [ref=e7]\n- button "Sign in" [ref=e9]',
    });
    expect(after).toContain('- textbox "Email" [ref=e7]');
    expect(after).toContain('- button "Sign in" [ref=e9]');
    expect(after).not.toContain("[ref=e3]");
    // Body text outside the comment block is untouched.
    expect(after).toContain("# Title");
    expect(after).toContain("After.");
  });

  it("appends an annot:attributes block when none exists", () => {
    const before = "# Title\n\nBody text.";
    const after = updateCommentBlocks(before, {
      attributes: 'textbox "Email":\n  type: email\n  required: true',
    });
    expect(after).toContain("# Title");
    expect(after).toContain("{/* annot:attributes");
    expect(after).toContain("type: email");
    expect(after).toContain("*/}");
  });

  it("leaves snapshot untouched when only attributes is updated", () => {
    const before = `# Title

{/* annot:snapshot
- a "b" [ref=e1]
*/}
`;
    const after = updateCommentBlocks(before, {
      attributes: 'a "b":\n  hidden: false',
    });
    expect(after).toContain("[ref=e1]");
    expect(after).toContain("hidden: false");
  });

  it("empty body clears the block to a single-line marker", () => {
    const before = "# Title\n";
    const after = updateCommentBlocks(before, { snapshot: "" });
    expect(after).toContain("{/* annot:snapshot */}");
  });
});
