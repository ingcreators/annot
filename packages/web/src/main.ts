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
// calls `updateSW(true)` → `skipWaiting` → workbox's `controlling`
// listener → `window.location.reload()`. This replaces the old
// `autoUpdate` flow where users stayed on a stale bundle until they
// happened to close every tab.
//
// The reload chain depends on three async hops landing in order:
// SKIP_WAITING posted, SW activates, `controllerchange` fires.
// Browsers occasionally drop the last hop (multi-tab clients
// holding the old SW, `controllerchange` racing the listener
// install, etc.) and `updateSW(true)` then resolves silently with
// no observable reload. To guarantee the user-promised "Reload =
// you get the new version", we attach a **fallback timeout**: if
// the reload chain hasn't fired within a few seconds of the
// click, we call `window.location.reload()` ourselves. The fresh
// SW is already activated (or activating) at that point, so the
// reload picks up the new bundle the same way.
const updateSW = registerSW({
  onNeedRefresh() {
    showError({
      message: "A new version of Annot is available.",
      severity: "info",
      action: {
        label: "Reload",
        onClick: () => {
          // Belt-and-braces fallback — fires regardless of whether
          // workbox's `controlling` listener gets there first. The
          // worst-case race is two reloads, which is fine.
          window.setTimeout(() => {
            window.location.reload();
          }, 1500);
          // Surface any unexpected error from the SW handoff so
          // it's not silently lost. The Promise rejects rarely (only
          // when registration itself failed), but when it does the
          // user otherwise sees a still-armed banner with no clue
          // why the reload didn't happen.
          updateSW(true).catch((err: unknown) => {
            console.error("[pwa] updateSW failed:", err);
            window.location.reload();
          });
        },
      },
    });
  },
});

const app = new App();
app.init();
