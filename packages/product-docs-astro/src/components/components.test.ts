// Structural checks for the seven Astro components.
//
// Phase 2 PR 3 of `docs/plans/living-product-docs.md`. We
// intentionally avoid booting Astro to render the components —
// that's heavy and integration-level. Instead each `.astro`
// file is inspected for:
//
//   - existence (so the `package.json` exports never point at a
//     missing path),
//   - a `Props` interface declaration (so editor tooling /
//     dts-bundler can resolve it),
//   - a single root element (Astro requires it),
//   - the data attributes the Image Service and downstream
//     CSS-in-docs styling rely on.
//
// Heavier Astro-runtime integration (component render under
// the Astro server) lands in the Phase 2 PR 4 dogfooded
// example app.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const COMPONENT_DIR = join(__dirname);

function readComponent(name: string): string {
  return readFileSync(join(COMPONENT_DIR, `${name}.astro`), "utf8");
}

const COMPONENTS = [
  "Screen",
  "Overlay",
  "Transition",
  "TransitionTable",
  "HistoryEntry",
  "ScreenList",
  "TransitionGraph",
];

describe("Astro components: existence + frontmatter shape", () => {
  for (const name of COMPONENTS) {
    it(`${name}.astro exists with Props declaration`, () => {
      const src = readComponent(name);
      expect(src).toMatch(/^---/);
      expect(src).toMatch(/interface Props\b/);
      expect(src).toMatch(/const \{ .* \} = Astro\.props;/);
    });
  }
});

describe("Screen.astro", () => {
  const src = readComponent("Screen");
  it("emits a <figure> root with data-screen-id", () => {
    expect(src).toMatch(/<figure class="annot-screen"\s+data-screen-id=/);
  });
  it("embeds an <img> + slot for overlays", () => {
    expect(src).toMatch(/<img src={src}/);
    expect(src).toMatch(/<slot \/>/);
  });
});

describe("Overlay.astro", () => {
  const src = readComponent("Overlay");
  it("propagates match + intent + number as data attrs", () => {
    expect(src).toMatch(/data-intent={intent}/);
    expect(src).toMatch(/data-overlay-number={number}/);
    expect(src).toMatch(/data-match-role={match\.role}/);
    expect(src).toMatch(/data-match-name={match\.name}/);
  });
});

describe("Transition.astro", () => {
  const src = readComponent("Transition");
  it("renders trigger / on / to as data + visible spans", () => {
    expect(src).toMatch(/data-trigger-role={trigger\.role}/);
    expect(src).toMatch(/data-on={on}/);
    expect(src).toMatch(/data-to={to}/);
  });
});

describe("TransitionTable.astro", () => {
  const src = readComponent("TransitionTable");
  it("renders a thead with Trigger / Event / Target / Notes", () => {
    expect(src).toMatch(/<th>Trigger<\/th>/);
    expect(src).toMatch(/<th>Event<\/th>/);
    expect(src).toMatch(/<th>Target<\/th>/);
    expect(src).toMatch(/<th>Notes<\/th>/);
  });
  it("iterates entries with row-level data attributes", () => {
    expect(src).toMatch(/entries\.map\(\(entry\) => \(/);
    expect(src).toMatch(/data-trigger={entry\.trigger}/);
  });
});

describe("HistoryEntry.astro", () => {
  const src = readComponent("HistoryEntry");
  it("emits version / date / author data attrs + <time> element", () => {
    expect(src).toMatch(/data-version={version}/);
    expect(src).toMatch(/<time class="annot-history-date" datetime={date}/);
  });
});

describe("ScreenList.astro", () => {
  const src = readComponent("ScreenList");
  it("sorts by id by default, supports byOrder", () => {
    expect(src).toMatch(/sort = "byId"/);
    expect(src).toMatch(/sort === "byOrder"/);
  });
  it("falls back to id for non-href entries", () => {
    expect(src).toMatch(/entry\.href \? \(/);
    expect(src).toMatch(/\) : \(/);
  });
});

describe("TransitionGraph.astro", () => {
  const src = readComponent("TransitionGraph");
  it("emits a Mermaid flowchart definition", () => {
    expect(src).toMatch(/flowchart "\s\+\sdirection/);
    expect(src).toMatch(/<pre class="mermaid">/);
  });
  it("escapes node ids and label pipes", () => {
    expect(src).toMatch(/replace\(\/\[\^A-Za-z0-9_\]\/g/);
    expect(src).toMatch(/replace\(\/\\\|\/g, "&#124;"\)/);
  });
});
