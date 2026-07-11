import { readFileSync } from "node:fs";
import path from "node:path";
import {
  activeTab,
  annotations,
  canvas,
  dragOnCanvas,
  expect,
  openAnnotFile,
  SAMPLE_PNG_FILE,
  test,
  toolButton,
} from "./fixtures.js";

// .annot.png flow: a plain renamed screenshot opens via the
// raw-raster fallback, and Ctrl+S upgrades it to a re-editable
// PNG — rendered pixels for outside viewers, plus the XMP packet
// (<annot:annotations> + original image APP-segments) that lets
// the editor round-trip the annotation layer on reopen.

test("a plain .annot.png opens via the raw-raster fallback", async ({ window }) => {
  const webview = await openAnnotFile(window, SAMPLE_PNG_FILE);

  await expect(canvas(webview).locator("image")).toBeVisible();
  await expect(canvas(webview).locator("image")).toHaveAttribute("href", /^data:image\/png/);
  await expect(annotations(webview)).toHaveCount(0);
  await expect(activeTab(window)).not.toHaveClass(/dirty/);
});

test("a drawn annotation round-trips through the XMP-embedded PNG", async ({
  window,
  workspace,
}) => {
  const webview = await openAnnotFile(window, SAMPLE_PNG_FILE);
  const file = path.join(workspace, SAMPLE_PNG_FILE);
  const originalBytes = readFileSync(file);

  await toolButton(webview, "shape").click();
  await dragOnCanvas(window, webview, { x: 0.2, y: 0.25 }, { x: 0.6, y: 0.65 });
  await expect(annotations(webview)).toHaveCount(1);
  await expect(activeTab(window)).toHaveClass(/dirty/, { timeout: 10_000 });

  await window.keyboard.press("Control+s");
  await expect(activeTab(window)).not.toHaveClass(/dirty/, { timeout: 20_000 });

  // Still a PNG, but now carrying the annot XMP payload.
  const saved = readFileSync(file);
  expect(saved.subarray(0, 8)).toEqual(originalBytes.subarray(0, 8));
  const savedText = saved.toString("latin1");
  expect(savedText).toContain("annot:annotations");
  expect(savedText).toContain("<rect");

  // Reopen from disk: readEditableImage must recover the original
  // (un-annotated) screenshot AND the annotation layer.
  await window.keyboard.press("Control+w");
  await window.locator("iframe.webview.ready").waitFor({ state: "detached", timeout: 10_000 });
  const reopened = await openAnnotFile(window, SAMPLE_PNG_FILE);

  await expect(reopened.locator("[data-annot-shell-root] image")).toHaveAttribute(
    "href",
    /^data:image\/png/,
  );
  await expect(annotations(reopened)).toHaveCount(1);
  await expect(annotations(reopened).first()).toHaveAttribute("stroke", "#ff0000");
});
