// CSS imports
import "@ingcreators/annot-core/styles/editor.css";
import "@ingcreators/annot-core/styles/toolbar.css";
import "@ingcreators/annot-core/styles/property-panel.css";
import "@ingcreators/annot-core/styles/fonts.css";
import "./styles/app.css";
import "@ingcreators/annot-editor-shell/styles/file-manager.css";

import { applyPersistedTheme } from "@ingcreators/annot-editor";
import { App } from "./app.js";
// Register `<annot-icon>` early so consumers (built-in panels +
// plugins) can use the element without explicitly importing the
// module themselves. Phase 4a of
// `docs/plans/svg-icons-and-plugin-icon-spec.md`.
import "./ui/annot-icon.js";

// Restore the user's last-chosen theme + any saved token overrides
// before the first paint that depends on them. Call sites that
// later flip the theme (`createThemeToggle`) persist via
// `persistThemeChoice()` for the next boot.
applyPersistedTheme();

const app = new App();
app.init();
