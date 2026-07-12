import { readFileSync } from "node:fs";
import path from "node:path";
import {
  activeTab,
  annotations,
  canvas,
  dragOnCanvas,
  expect,
  openAnnotFile,
  SAMPLE_FILE,
  test,
  toolButton,
} from "./fixtures.js";

// VSCode custom-editor UX: *.annot.svg opens in the Annot editor,
// drawing works inside the webview, and VS Code's save flow
// (Ctrl+S → saveCustomDocument → workspace.fs.writeFile) persists
// the annotation back into the original file on disk.

test("*.annot.svg opens in the Annot custom editor with the image rendered", async ({ window }) => {
  const webview = await openAnnotFile(window, SAMPLE_FILE);

  await expect(canvas(webview).locator("image")).toBeVisible();
  // The base screenshot must actually be loaded — an `<image>` with
  // an empty href still reports "visible" (the box has size), and an
  // empty href is what the save path would destroy the file with.
  await expect(canvas(webview).locator("image")).toHaveAttribute("href", /^data:image\//);
  await expect(annotations(webview)).toHaveCount(0);
  // The shared toolbar mounts with the full tool set.
  for (const tool of ["arrow", "shape", "text", "redact"]) {
    await expect(toolButton(webview, tool)).toBeVisible();
  }
  // Freshly opened file is not dirty.
  await expect(activeTab(window)).not.toHaveClass(/dirty/);
});

test("drawing marks the document dirty and Ctrl+S bakes it into the file", async ({
  window,
  workspace,
}) => {
  const webview = await openAnnotFile(window, SAMPLE_FILE);

  await toolButton(webview, "shape").click();
  await expect(toolButton(webview, "shape")).toHaveClass(/active/);
  await dragOnCanvas(window, webview, { x: 0.2, y: 0.25 }, { x: 0.6, y: 0.65 });
  await expect(annotations(webview)).toHaveCount(1);

  // The webview's {type:"edit"} message must reach the host and
  // flip VS Code's dirty state (tab dot).
  await expect(activeTab(window)).toHaveClass(/dirty/, { timeout: 10_000 });

  await window.keyboard.press("Control+s");
  await expect(activeTab(window)).not.toHaveClass(/dirty/, { timeout: 20_000 });

  // saveCustomDocument wrote the annotated SVG back into the
  // original file: versioned root + the drawn rect, base image kept.
  const saved = readFileSync(path.join(workspace, SAMPLE_FILE), "utf8");
  expect(saved).toContain('data-annot-version="1"');
  expect(saved).toContain("<rect");
  expect(saved).toContain("data:image/png;base64,");
  // Provenance parity with the raster XMP packet: a standalone
  // .annot.svg written by the vscode host stamps its producer.
  expect(saved).toContain('data-annot-producer="vscode"');
});

test("undo removes the drawn shape inside the webview", async ({ window }) => {
  const webview = await openAnnotFile(window, SAMPLE_FILE);

  await toolButton(webview, "shape").click();
  await dragOnCanvas(window, webview, { x: 0.2, y: 0.25 }, { x: 0.6, y: 0.65 });
  await expect(annotations(webview)).toHaveCount(1);

  await canvas(webview).click({ position: { x: 10, y: 10 } });
  await window.keyboard.press("Control+z");
  await expect(annotations(webview)).toHaveCount(0);
});
