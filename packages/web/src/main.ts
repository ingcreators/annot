// CSS imports
import "@ingcreators/annot-core/styles/material-symbols.css";
import "@ingcreators/annot-core/styles/editor.css";
import "@ingcreators/annot-core/styles/toolbar.css";
import "@ingcreators/annot-core/styles/property-panel.css";
import "./styles/app.css";
import "./styles/file-manager.css";

import { registerSW } from "virtual:pwa-register";
import { App } from "./app.js";
import { showError } from "./ui/error-bar.js";

// Register the PWA service worker with manual update prompt. When a
// new SW is installed and waiting, Workbox fires `onNeedRefresh`;
// we surface the info banner with a single "Reload" action that
// calls `updateSW(true)` → `skipWaiting` → `window.location.reload`.
// This replaces the old `autoUpdate` flow where users stayed on a
// stale bundle until they happened to close every tab.
const updateSW = registerSW({
  onNeedRefresh() {
    showError({
      message: "A new version of Annot is available.",
      severity: "info",
      action: {
        label: "Reload",
        onClick: () => {
          void updateSW(true);
        },
      },
    });
  },
});

const app = new App();
app.init();

// Phases 1–2 verification hook for `docs/plans/github-integration.md`.
// Navigating to `?github-setup=1` opens the PAT paste → repo picker →
// branch → base path flow, then (Phase 2) instantiates a `GitHubStore`
// and runs a non-destructive smoke test (`listFolders` + `listImages`
// at the base path) so we can confirm the API round-trip works before
// Phase 3 wires the store into the full sidebar / editor path.
//
// `?github-smoke=1` additionally exercises the write path — creates a
// throwaway folder, writes a tiny test image, deletes both. Leaves
// commits in the picked repo's git log; only use against a scratch
// repo.
if (new URLSearchParams(location.search).get("github-setup") === "1") {
  const runSmoke = new URLSearchParams(location.search).get("github-smoke") === "1";
  void (async () => {
    const setup = await import("./storage/github-setup-ui.js");
    const bridge = await import("./storage/bridge.js");
    const auth = await import("./storage/github-auth.js");

    const ref = await setup.connectGitHub();
    if (!ref) return;
    const token = auth.getAccessToken();
    if (!token) return;

    const store = bridge.connectGitHub(token, ref);
    const label = `${ref.owner}/${ref.repo} on ${ref.branch}`
      + (ref.basePath ? ` / ${ref.basePath}` : "");

    try {
      const [images, folders] = await Promise.all([
        store.listImages(""),
        store.listFolders(""),
      ]);
      showError({
        message: `Connected to ${label}. Found ${images.length} image(s) and `
          + `${folders.length} folder(s) at the base path.`,
        severity: "info",
      });

      if (runSmoke) {
        await runGithubSmokeTest(store);
      }
    } catch (e) {
      showError({
        message: `Connected to ${label} but listing failed: ${(e as Error).message}`,
        severity: "error",
      });
    }
  })();
}

async function runGithubSmokeTest(
  store: import("@ingcreators/annot-core/storage").StorageProvider,
): Promise<void> {
  const folderName = `annot-smoke-${Date.now()}`;
  try {
    // 1x1 transparent PNG, embedded as data URL.
    const tinyPng = "data:image/png;base64,"
      + "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

    await store.createFolder("", folderName);
    const savedPath = await store.saveImage({
      folderPath: folderName,
      originalDataUrl: tinyPng,
      thumbnailDataUrl: "",
      annotationsSvg: "",
      width: 1,
      height: 1,
      sourceUrl: "",
      tags: { smoke: "true" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      filename: "smoke.annot.png",
    });
    const listed = await store.listImages(folderName);
    const found = listed.some((r) => r.path === savedPath);
    await store.deleteImage(savedPath);
    await store.deleteFolder(folderName);
    showError({
      message: found
        ? `Smoke test passed: created → listed → deleted ${savedPath}.`
        : `Smoke test saw save+delete succeed but the list didn't include ${savedPath}.`,
      severity: found ? "info" : "warning",
      autoDismiss: 8000,
    });
  } catch (e) {
    showError({
      message: `Smoke test failed in ${folderName}: ${(e as Error).message}`,
      severity: "error",
    });
  }
}
