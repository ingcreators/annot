// Phase 0 PoC orchestrator. Walks Stages 2–6 of
// `docs/plans/living-product-docs.md` end-to-end:
//
//   - Read `fixture/login.screen.mdx` (Stage 2)
//   - Open `fixture/login.html` in headless Chromium
//   - Take aria-snapshot via Playwright (foundational primitive
//     from #869's `annot_aria_snapshot` MCP tool, used directly
//     here instead of via MCP transport for simplicity)
//   - Resolve every `<Overlay match>` against the snapshot
//     (Stage 3)
//   - Render annotated PNG (Stage 4)
//   - Render HTML page + Excel workbook from the same MDX
//     (Stage 5)
//   - Report drift (Stage 6 — pass `--drift-demo` to mutate the
//     MDX with a broken match and show the resolution error
//     path)

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

import { parseMdx } from "./parse-mdx.ts";
import { renderAnnotatedPng } from "./render-png.ts";
import { renderHtml } from "./render-html.ts";
import { renderXlsx } from "./render-xlsx.ts";
import { parseSnapshot, resolveAllOverlays } from "./resolve.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolvePath(__dirname, "..");
const FIXTURE = resolvePath(ROOT, "fixture");
const OUT = resolvePath(ROOT, "output");

const VIEWPORT = { width: 1280, height: 800 };

async function main() {
  const driftDemo = process.argv.includes("--drift-demo");

  await mkdir(OUT, { recursive: true });

  // ── Stage 2: load the hand-written MDX ────────────────────
  const mdxPath = resolvePath(FIXTURE, "login.screen.mdx");
  let parsed = await parseMdx(mdxPath);

  if (driftDemo) {
    // Mutate one overlay's match.name to something that doesn't
    // exist on the page. The resolver should report this as
    // drift.
    parsed = applyDriftMutation(parsed);
    console.log("\n=== DRIFT-DEMO MODE ===");
    console.log("Mutated first overlay's match.name to a value");
    console.log("that no longer exists on the page.\n");
  }

  console.log(`Loaded MDX: ${mdxPath}`);
  console.log(`  Screen id: ${parsed.frontmatter.id}`);
  console.log(`  Title: ${parsed.frontmatter.title ?? "(none)"}`);
  console.log(`  Overlays: ${parsed.screens.flatMap((s) => s.overlays).length}`);
  console.log(`  Transitions: ${parsed.transitions.length}`);

  // ── Stage 3: open the fixture page + take snapshot ────────
  const fixtureUrl = pathToFileURL(resolvePath(FIXTURE, "login.html")).href;
  console.log(`\nLaunching headless Chromium...`);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  try {
    await page.goto(fixtureUrl, { waitUntil: "load" });

    const yaml = await page.locator("body").ariaSnapshot({ mode: "ai" });
    const snapshotPath = resolvePath(OUT, "login.snapshot.yaml");
    await writeFile(snapshotPath, yaml, "utf8");
    console.log(`Wrote snapshot YAML: ${snapshotPath}`);

    const snapshot = parseSnapshot(yaml);
    console.log(`Parsed ${snapshot.length} snapshot entries.`);

    // Resolve overlays
    const allOverlays = parsed.screens.flatMap((s) => s.overlays);
    const resolved = await resolveAllOverlays(allOverlays, snapshot, page);

    console.log("\nResolution report:");
    let okCount = 0;
    let driftCount = 0;
    for (const r of resolved) {
      const matchLabel = `${r.overlay.match.role} "${r.overlay.match.name}"`;
      if (r.status === "resolved") {
        console.log(`  ✓ ${matchLabel} → ${r.snapshotMatch} bbox=${formatBbox(r.bbox)}`);
        okCount++;
      } else if (r.status === "role-name-renamed") {
        console.log(
          `  ⚠ ${matchLabel} → role match but name diff — suggestion: "${r.suggestion}"`,
        );
        driftCount++;
      } else if (r.status === "ambiguous") {
        console.log(`  ⚠ ${matchLabel} → ambiguous, candidates: ${r.candidates.join(", ")}`);
        driftCount++;
      } else {
        console.log(`  ✗ ${matchLabel} → not found: ${r.reason}`);
        driftCount++;
      }
    }
    console.log(`\nResolved ${okCount}/${resolved.length} overlays; ${driftCount} drift issues.`);

    if (driftCount > 0 && !driftDemo) {
      console.warn("\nDrift detected. Continuing to render with resolved overlays only.");
    }

    // ── Stage 4: screenshot + annotated PNG ───────────────
    const screenshotPng = await page.screenshot({ fullPage: false, type: "png" });
    const rawScreenshotPath = resolvePath(OUT, "login.shot.png");
    await writeFile(rawScreenshotPath, screenshotPng);
    console.log(`\nWrote raw screenshot: ${rawScreenshotPath}`);

    const annotatedPath = resolvePath(OUT, "login.annotated.png");
    await renderAnnotatedPng({
      screenshotPng: new Uint8Array(screenshotPng),
      pageWidth: VIEWPORT.width,
      pageHeight: VIEWPORT.height,
      resolved,
      outPath: annotatedPath,
    });
    console.log(`Wrote annotated PNG: ${annotatedPath}`);

    // ── Stage 5: HTML + Excel from the same MDX ────────────
    const htmlPath = resolvePath(OUT, "login.html");
    await renderHtml({ parsed, annotatedPngPath: annotatedPath, outPath: htmlPath });
    console.log(`Wrote HTML render: ${htmlPath}`);

    const xlsxPath = resolvePath(OUT, "login.xlsx");
    await renderXlsx({ parsed, annotatedPngPath: annotatedPath, outPath: xlsxPath });
    console.log(`Wrote Excel workbook: ${xlsxPath}`);

    // ── Stage 6: drift summary ─────────────────────────────
    if (driftDemo) {
      console.log("\n=== Stage 6: drift detection demo ===");
      if (driftCount > 0) {
        console.log(`SUCCESS: drift detected. The mutated overlay was correctly`);
        console.log(`flagged as not resolvable against the live page.`);
        process.exitCode = 1; // CI would fail here
      } else {
        console.log(`UNEXPECTED: drift mutation didn't produce a drift report.`);
        process.exitCode = 2;
      }
    } else {
      console.log("\n=== Run --drift-demo to see Stage 6 drift detection ===");
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

function formatBbox(b: { x: number; y: number; width: number; height: number }) {
  return `(${b.x.toFixed(0)},${b.y.toFixed(0)})+${b.width.toFixed(0)}×${b.height.toFixed(0)}`;
}

function applyDriftMutation(parsed: import("./parse-mdx.ts").ParsedMdx): import("./parse-mdx.ts").ParsedMdx {
  const screens = parsed.screens.map((s) => ({
    ...s,
    overlays: s.overlays.map((o, idx) => {
      if (idx !== 0) return o;
      return { ...o, match: { ...o.match, name: o.match.name + "ZZZ-DRIFT-DEMO" } };
    }),
  }));
  return { ...parsed, screens };
}

main().catch((err) => {
  console.error("PoC failed:", err);
  process.exit(1);
});
