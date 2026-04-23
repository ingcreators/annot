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
