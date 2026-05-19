// Install the reactive `vite:preloadError` / chunk-load-failure
// safety net BEFORE anything else. The module's top-level side
// effect attaches the global window listeners; placing the import
// here guarantees the handler is wired before any subsequent
// module (CSS, theme restore, App boot, ...) can itself trigger a
// dynamic import that might fail against a stale deploy.
// See `docs/plans/web-dynamic-import-recovery.md`.
import "./recovery/chunk-reload.js";

// CSS imports
import "@ingcreators/annot-core/styles/editor.css";
import "@ingcreators/annot-core/styles/toolbar.css";
import "@ingcreators/annot-core/styles/property-panel.css";
import "@ingcreators/annot-core/styles/fonts.css";
import "./styles/app.css";
import "@ingcreators/annot-host-ui/styles/file-manager.css";

import { applyPersistedTheme } from "@ingcreators/annot-editor";
import { App } from "./app.js";
// Register `<annot-icon>` early so consumers (built-in panels +
// plugins) can use the element without explicitly importing the
// module themselves. Phase 4a of
// `docs/plans/svg-icons-and-plugin-icon-spec.md`.
import "./ui/annot-icon.js";

// Restore the user's last-chosen theme + any saved token overrides
// before the first paint that depends on them. When the user
// later flips the theme via the Settings dialog, the dialog
// persists the new mode and re-calls `applyPersistedTheme()` to
// re-resolve "system" → effective light/dark.
applyPersistedTheme();

const app = new App();
app.init();
