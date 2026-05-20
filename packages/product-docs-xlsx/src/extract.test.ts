import { parseMdx } from "@ingcreators/annot-product-docs";
import { describe, expect, it } from "vitest";

import { extractFromParsed } from "./extract.js";

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
