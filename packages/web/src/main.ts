// CSS imports
import "@ingcreators/annot-core/styles/editor.css";
import "@ingcreators/annot-core/styles/toolbar.css";
import "@ingcreators/annot-core/styles/property-panel.css";
import "./styles/app.css";
import "./styles/file-manager.css";

import { applyPersistedTheme } from "@ingcreators/annot-editor";
import { registerSW } from "virtual:pwa-register";
import { App } from "./app.js";
// Register `<annot-icon>` early so consumers (built-in panels +
// plugins) can use the element without explicitly importing the
// module themselves. Phase 4a of
// `docs/plans/svg-icons-and-plugin-icon-spec.md`.
import "./ui/annot-icon.js";
import { hideError, showError } from "./ui/error-bar.js";

// Restore the user's last-chosen theme + any saved token overrides
// before the first paint that depends on them. Call sites that
// later flip the theme (`createThemeToggle`) persist via
// `persistThemeChoice()` for the next boot.
applyPersistedTheme();

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
          // Close the banner the moment the user clicks. Without
          // this, the banner sits with an "armed" Reload button
          // until the page actually navigates (up to 1.5 s away,
          // longer if the SW handoff stalls), which reads as a
          // dead button and triggers re-clicks. Hiding it on
          // click acknowledges the gesture immediately and matches
          // the user's mental model of "Reload = the banner goes
          // away".
          hideError();
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
