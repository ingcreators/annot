/**
 * @vitest-environment happy-dom
 *
 * Phase 2 of `docs/plans/rich-text-and-shape-text.md` — the
 * contentEditable ↔ TextRun mapper. Round-trip property test
 * + targeted shape tests for each formatting flag.
 */
import { describe, expect, it } from "vitest";
import type { TextRun } from "../utils/desktop-bridge.js";
import { htmlToRuns, runsToHtml } from "./rich-text-mapper.js";

function div(html: string): HTMLDivElement {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d;
}

describe("htmlToRuns", () => {
  it("plain text → one run", () => {
    expect(htmlToRuns(div("hello"))).toEqual([{ text: "hello" }]);
  });

  it("<b>x</b> → bold flag", () => {
    expect(htmlToRuns(div("<b>x</b>"))).toEqual([{ text: "x", bold: true }]);
  });

  it("<strong>x</strong> → bold flag (alias)", () => {
    expect(htmlToRuns(div("<strong>x</strong>"))).toEqual([{ text: "x", bold: true }]);
  });

  it("<i>x</i> / <em>x</em> → italic flag", () => {
    expect(htmlToRuns(div("<i>a</i><em>b</em>"))).toEqual([
      { text: "a", italic: true },
      { text: "b", italic: true },
    ]);
  });

  it("<u>x</u> → underline flag", () => {
    expect(htmlToRuns(div("<u>x</u>"))).toEqual([{ text: "x", underline: true }]);
  });

  it("inline <span style='font-weight: bold'> → bold flag", () => {
    expect(htmlToRuns(div('<span style="font-weight: bold">x</span>'))).toEqual([
      { text: "x", bold: true },
    ]);
  });

  it("inline <span style='font-weight: 700'> → bold flag", () => {
    expect(htmlToRuns(div('<span style="font-weight: 700">x</span>'))).toEqual([
      { text: "x", bold: true },
    ]);
  });

  it("inline <span style='font-style: italic'> → italic flag", () => {
    expect(htmlToRuns(div('<span style="font-style: italic">x</span>'))).toEqual([
      { text: "x", italic: true },
    ]);
  });

  it("inline <span style='text-decoration: underline'> → underline flag", () => {
    expect(htmlToRuns(div('<span style="text-decoration: underline">x</span>'))).toEqual([
      { text: "x", underline: true },
    ]);
  });

  it("inline font-size in px → font_size override", () => {
    expect(htmlToRuns(div('<span style="font-size: 24px">x</span>'))).toEqual([
      { text: "x", font_size: 24 },
    ]);
  });

  it("inline font-family unwraps quotes", () => {
    expect(htmlToRuns(div(`<span style="font-family: 'Inter, sans-serif'">x</span>`))).toEqual([
      { text: "x", font_family: "Inter, sans-serif" },
    ]);
  });

  it("inline color → color override", () => {
    expect(htmlToRuns(div('<span style="color: #ff0000">x</span>'))).toEqual([
      { text: "x", color: "#ff0000" },
    ]);
  });

  it("nested <b><i> cascades both flags", () => {
    expect(htmlToRuns(div("<b>bold <i>both</i></b>"))).toEqual([
      { text: "bold ", bold: true },
      { text: "both", bold: true, italic: true },
    ]);
  });

  it("`<br>` between runs flips line_break_after on the previous run", () => {
    expect(htmlToRuns(div("first<br>second"))).toEqual([
      { text: "first", line_break_after: true },
      { text: "second" },
    ]);
  });

  it("Chrome-style `<div>` per line splits paragraphs", () => {
    expect(htmlToRuns(div("<div>line A</div><div>line B</div>"))).toEqual([
      { text: "line A", line_break_after: true },
      { text: "line B" },
    ]);
  });

  it("Chrome-style bare-text + `<div>` continuation preserves the break", () => {
    // This is what Chrome's contentEditable produces when the user
    // starts with a fresh editor (bare text node), types "abc",
    // presses Enter, then types "def": the FIRST line stays as a
    // bare text node and only the continuation gets wrapped in a
    // <div>. Previously the walker tagged line_break_after on
    // "def" instead of "abc", which the trailing-strip then dropped
    // entirely — so the typed line break was silently lost on
    // commit.
    expect(htmlToRuns(div("abc<div>def</div>"))).toEqual([
      { text: "abc", line_break_after: true },
      { text: "def" },
    ]);
  });

  it("empty `<div>` between content emits a blank-line placeholder", () => {
    // Two Enters between text → an empty paragraph in the middle.
    // The blank line is its own run with text="" + line_break_after
    // so the gap survives the round-trip.
    expect(htmlToRuns(div("abc<div></div><div>def</div>"))).toEqual([
      { text: "abc", line_break_after: true },
      { text: "", line_break_after: true },
      { text: "def" },
    ]);
  });

  it("trailing block boundary doesn't produce a phantom empty run", () => {
    // When a contentEditable's outer div *itself* is a block, the
    // walker's last `markLineBreak` would otherwise leave a stale
    // line_break_after on the final visible run. The trailing-flag
    // strip restores the canonical "last run has no
    // line_break_after" invariant.
    expect(htmlToRuns(div("a<br>"))).toEqual([{ text: "a" }]);
  });

  it("empty input → empty run array", () => {
    expect(htmlToRuns(div(""))).toEqual([]);
  });

  it("mixed: bold-italic-underline-color in one tree", () => {
    const input = "<b>B </b><i>I </i><u>U </u>" + '<span style="color: #00ff00">C</span>';
    expect(htmlToRuns(div(input))).toEqual([
      { text: "B ", bold: true },
      { text: "I ", italic: true },
      { text: "U ", underline: true },
      { text: "C", color: "#00ff00" },
    ]);
  });
});

describe("runsToHtml", () => {
  it("plain text → bare text node (no wrapper)", () => {
    expect(runsToHtml([{ text: "hello" }])).toBe("hello");
  });

  it("escapes HTML special characters in text", () => {
    expect(runsToHtml([{ text: 'a<&">b' }])).toBe("a&lt;&amp;&quot;&gt;b");
  });

  it("bold run wraps in <span style='font-weight: bold'>", () => {
    expect(runsToHtml([{ text: "x", bold: true }])).toBe(
      '<span style="font-weight: bold">x</span>',
    );
  });

  it("multiple flags collapse into one span style", () => {
    expect(runsToHtml([{ text: "x", bold: true, italic: true, underline: true }])).toBe(
      '<span style="font-weight: bold; font-style: italic; text-decoration: underline">x</span>',
    );
  });

  it("font_size override emits px unit", () => {
    expect(runsToHtml([{ text: "x", font_size: 18 }])).toBe(
      '<span style="font-size: 18px">x</span>',
    );
  });

  it("line_break_after emits <br>", () => {
    expect(runsToHtml([{ text: "a", line_break_after: true }, { text: "b" }])).toBe("a<br>b");
  });
});

/** Coalesce adjacent runs that share their entire formatting
 *  context. Two plain text runs `[{text:"a"},{text:"b"}]` are
 *  semantically equivalent to `[{text:"ab"}]` — the round-trip
 *  through HTML naturally collapses them, so the assertion
 *  canonicalises both sides before comparing. */
function canonicalize(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && !last.line_break_after && sameStyle(last, r)) {
      last.text += r.text;
      if (r.line_break_after) last.line_break_after = true;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

function sameStyle(a: TextRun, b: TextRun): boolean {
  return (
    !!a.bold === !!b.bold &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    a.font_size === b.font_size &&
    a.font_family === b.font_family &&
    a.color === b.color
  );
}

describe("htmlToRuns ∘ runsToHtml round-trip", () => {
  // Compact set of randomized fixtures rather than property-based
  // generation — the per-flag tests above already pin the
  // canonical mapping; this set verifies the inverse holds across
  // every realistic combination the contentEditable produces.
  const FIXTURES: TextRun[][] = [
    [],
    [{ text: "" }],
    [{ text: "Hello" }],
    [{ text: "Hello", bold: true }],
    [{ text: "α", italic: true }],
    [{ text: "α", underline: true, color: "#0033aa" }],
    [{ text: "a" }, { text: "b" }],
    [{ text: "first", line_break_after: true }, { text: "second" }],
    [
      { text: "bold ", bold: true },
      { text: "italic", italic: true },
      { text: "+u", underline: true, color: "#ff0000" },
    ],
    [
      { text: "p1", line_break_after: true },
      { text: "p2", line_break_after: true },
      { text: "p3" },
    ],
    [{ text: "size override", font_size: 24 }, { text: " base" }],
    [{ text: "Inter family", font_family: "Inter" }, { text: " base" }],
  ];

  it.each(
    FIXTURES.map((runs, i) => [i, runs] as const),
  )("round-trips fixture #%i", (_index, runs) => {
    const html = runsToHtml(runs);
    const back = htmlToRuns(div(html));
    // Adjacent same-style runs collapse during the HTML
    // round-trip — `[{text:"a"},{text:"b"}]` and `[{text:"ab"}]`
    // are semantically equivalent.
    const expected = canonicalize(runs.filter((r) => r.text !== "" || r.line_break_after));
    expect(canonicalize(back)).toEqual(expected);
  });
});
