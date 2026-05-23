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
  "AnnotCallout",
  "AnnotEditButton",
  "AnnotEditorIframeModal",
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
      // Allow either single-line or multi-line destructuring
      // — components with many defaults wrap the `const { … } =
      // Astro.props;` line by Biome's formatter.
      expect(src).toMatch(/const \{[\s\S]*?\} = Astro\.props;/);
    });
  }
});

describe("Screen.astro", () => {
  const src = readComponent("Screen");
  it("emits a <figure> root with data-screen-id", () => {
    expect(src).toMatch(/<figure[\s\S]*?class="annot-screen"[\s\S]*?data-screen-id=/);
  });
  it("embeds an <img> + slot for overlays", () => {
    expect(src).toMatch(/<img src={src}/);
    expect(src).toMatch(/<slot \/>/);
  });
  it("accepts the Phase 2b `annotations` prop and emits data-annotations-path", () => {
    expect(src).toMatch(/annotations\?:\s*string/);
    expect(src).toMatch(/data-annotations-path={annotations}/);
  });
});

describe("AnnotCallout.astro", () => {
  const src = readComponent("AnnotCallout");
  it("propagates `for` as data-callout-for", () => {
    expect(src).toMatch(/data-callout-for={forId}/);
  });
  it("renders body inside an .annot-callout-body wrapper", () => {
    expect(src).toMatch(/annot-callout-body/);
    expect(src).toMatch(/<slot \/>/);
  });
});

describe("AnnotEditButton.astro", () => {
  const src = readComponent("AnnotEditButton");
  it("declares the three required Props + the optional mode/cloudUrl/label", () => {
    expect(src).toMatch(/repo:\s*string/);
    expect(src).toMatch(/pngPath:\s*string/);
    expect(src).toMatch(/annotationsPath:\s*string/);
    expect(src).toMatch(/mode\?:\s*EmbedMode/);
    expect(src).toMatch(/cloudUrl\?:\s*string/);
    expect(src).toMatch(/label\?:\s*string/);
  });
  it("defaults mode to newTab + cloudUrl to https://annot.work", () => {
    expect(src).toMatch(/mode = "newTab"/);
    expect(src).toMatch(/cloudUrl = "https:\/\/annot\.work"/);
  });
  it('renders no button when mode === "disabled"', () => {
    expect(src).toMatch(/mode !== "disabled" &&/);
  });
  it("emits data-annot-edit-* attrs that the inline script reads", () => {
    expect(src).toMatch(/data-annot-edit-mode={mode}/);
    expect(src).toMatch(/data-annot-edit-cloud-url={cloudUrl}/);
    expect(src).toMatch(/data-annot-edit-repo={repo}/);
    expect(src).toMatch(/data-annot-edit-png-path={pngPath}/);
    expect(src).toMatch(/data-annot-edit-annotations-path={annotationsPath}/);
  });
  it("inline script imports encodeEmbedRequestUrl from the protocol pkg", () => {
    expect(src).toMatch(
      /import \{ encodeEmbedRequestUrl \} from "@ingcreators\/annot-embed-protocol"/,
    );
  });
  it("opens the inline modal via __annotEditorIframeModal when present", () => {
    expect(src).toMatch(/__annotEditorIframeModal/);
    expect(src).toMatch(/modalApi\.open\(\{ cloudUrl, editorUrl: url \}\)/);
  });
  it('falls back to newTab + console.warn when mode === "inline" and the modal is missing', () => {
    expect(src).toMatch(/effectiveMode = "newTab"/);
    expect(src).toMatch(/console\.warn\(/);
    expect(src).toMatch(/warnedMissingModal/);
  });
  it("opens the cloud editor via window.open with noopener,noreferrer", () => {
    expect(src).toMatch(/window\.open\(url, "_blank", "noopener,noreferrer"\)/);
  });
});

describe("AnnotEditorIframeModal.astro", () => {
  const src = readComponent("AnnotEditorIframeModal");
  it("renders a <dialog> root marked with data-annot-edit-modal-root", () => {
    expect(src).toMatch(/<dialog[\s\S]*?data-annot-edit-modal-root/);
  });
  it("contains an <iframe> with the annot-editor-iframe-modal-frame class", () => {
    expect(src).toMatch(/class="annot-editor-iframe-modal-frame"/);
  });
  it("imports the 5c host messenger factory + EmbedEvent types", () => {
    expect(src).toMatch(
      /import\s*\{\s*[\s\S]*?createEmbedHostMessenger[\s\S]*?\}\s*from\s*"@ingcreators\/annot-embed-protocol"/,
    );
    expect(src).toMatch(/type EmbedEvent/);
  });
  it("dismisses the modal on EditCommitted / EditAbandoned", () => {
    expect(src).toMatch(/EditCommitted/);
    expect(src).toMatch(/EditAbandoned/);
    expect(src).toMatch(/modal\.close\(\)/);
  });
  it("resizes the iframe on ResizeNeeded with a clamped height", () => {
    expect(src).toMatch(/ResizeNeeded/);
    expect(src).toMatch(/clampHeight/);
    expect(src).toMatch(/frame\.style\.height/);
  });
  it("attaches the host messenger only after the iframe load event", () => {
    expect(src).toMatch(/frame\.addEventListener\(\s*"load"/);
    expect(src).toMatch(/createEmbedHostMessenger\(/);
  });
  it("exposes the open function via __annotEditorIframeModal", () => {
    expect(src).toMatch(/__annotEditorIframeModal/);
    expect(src).toMatch(/open:\s*openModal/);
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
