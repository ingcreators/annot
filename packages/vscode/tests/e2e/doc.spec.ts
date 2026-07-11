import { readFileSync } from "node:fs";
import path from "node:path";
import { activeTab, expect, openAnnotDoc, SAMPLE_DOC_FILE, test } from "./fixtures.js";

// .annot.html doc mode: the custom editor mounts <annot-doc-shell>
// (no image canvas), edits mark the VS Code document dirty via the
// doc-changed → {type:"edit"} bridge, and Ctrl+S serializes the
// live document back to standalone .annot.html bytes on disk.

test(".annot.html opens in doc mode with the template content", async ({ window }) => {
  const webview = await openAnnotDoc(window, SAMPLE_DOC_FILE);

  // Template blocks render (procedure starter).
  await expect(
    webview.locator('h1[data-annot-block="heading"]', { hasText: "[Procedure name]" }),
  ).toBeVisible();
  await expect(
    webview.locator('h2[data-annot-block="heading"]', { hasText: "Prerequisites" }),
  ).toBeVisible();
  // Doc mode replaces the image-editor surface — no canvas svg.
  await expect(webview.locator("[data-annot-shell-root]")).toHaveCount(0);
  await expect(activeTab(window)).not.toHaveClass(/dirty/);
});

test("editing a heading marks the document dirty and Ctrl+S persists it", async ({
  window,
  workspace,
}) => {
  const webview = await openAnnotDoc(window, SAMPLE_DOC_FILE);

  const title = webview.locator('h1[data-annot-block="heading"]', {
    hasText: "[Procedure name]",
  });
  // Click bottom-left: the hover block-toolbar overlays the
  // block's top edge (top: -16px, right-aligned) and intercepts
  // clicks near the centre / top-right. Triple-click selects the
  // block's own text (Ctrl+A would grab the whole article).
  const box = await title.boundingBox();
  if (!box) throw new Error("heading has no bounding box");
  await title.click({ position: { x: 24, y: box.height - 4 }, clickCount: 3 });
  await expect(title).toHaveAttribute("contenteditable", "true");
  await window.keyboard.type("Rotate signing keys");

  // The shell commits contenteditable input on a 600 ms debounce
  // (doc-changed → {type:"edit"} → VS Code dirty marker).
  await expect(activeTab(window)).toHaveClass(/dirty/, { timeout: 10_000 });
  // `title` filters on the old text, so re-locate by position.
  await expect(webview.locator('h1[data-annot-block="heading"]').first()).toHaveText(
    "Rotate signing keys",
  );

  await window.keyboard.press("Control+s");
  await expect(activeTab(window)).not.toHaveClass(/dirty/, { timeout: 20_000 });

  const saved = readFileSync(path.join(workspace, SAMPLE_DOC_FILE), "utf8");
  expect(saved).toContain("Rotate signing keys");
  expect(saved).not.toContain("[Procedure name]");

  // Reopen from disk: the serialize → parse round-trip keeps the edit.
  await window.keyboard.press("Control+w");
  await window.locator("iframe.webview.ready").waitFor({ state: "detached", timeout: 10_000 });
  const reopened = await openAnnotDoc(window, SAMPLE_DOC_FILE);
  await expect(
    reopened.locator('h1[data-annot-block="heading"]', { hasText: "Rotate signing keys" }),
  ).toBeVisible();
});
