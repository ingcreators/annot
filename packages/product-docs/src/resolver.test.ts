import { describe, expect, it } from "vitest";

import { parseSnapshot } from "./resolver.js";

describe("parseSnapshot", () => {
  it("parses a flat snapshot", () => {
    const yaml = `- textbox "Email" [ref=e3]
- textbox "Password" [ref=e5]
- button "Sign in" [ref=e9]
`;
    const entries = parseSnapshot(yaml);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ role: "textbox", name: "Email", ref: "e3", depth: 0 });
    expect(entries[2]).toMatchObject({ role: "button", name: "Sign in", ref: "e9" });
  });

  it("captures ancestor chain via container colons", () => {
    const yaml = `- dialog "Confirm":
  - button "OK" [ref=e12]
  - button "Cancel" [ref=e13]
`;
    const entries = parseSnapshot(yaml);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.ancestors).toEqual([{ role: "dialog", name: "Confirm" }]);
    expect(entries[1]?.ancestors).toEqual([{ role: "dialog", name: "Confirm" }]);
  });

  it("ignores container lines without refs at top level", () => {
    const yaml = `- region "Main":
  - button "Save" [ref=e1]
- region "Footer":
  - button "Save" [ref=e2]
`;
    const entries = parseSnapshot(yaml);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.ancestors).toEqual([{ role: "region", name: "Main" }]);
    expect(entries[1]?.ancestors).toEqual([{ role: "region", name: "Footer" }]);
  });

  it("survives Playwright trailing attribute brackets like [cursor=pointer]", () => {
    const yaml = `- button "Sign in" [cursor=pointer] [ref=e9]
`;
    const entries = parseSnapshot(yaml);
    expect(entries[0]?.ref).toBe("e9");
    expect(entries[0]?.name).toBe("Sign in");
  });
});
