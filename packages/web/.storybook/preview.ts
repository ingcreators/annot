/**
 * Storybook preview config.
 *
 * Pulls in the same CSS the PWA boots with so stories render
 * against the production design tokens (light / dark variables,
 * toolbar styles, file-manager layout, Material Symbols font).
 *
 * Annot's Lit components intentionally render to **light DOM**
 * (per CLAUDE.md's "Hybrid CSS" stance — see
 * `_done/lit-migration.md`), so global stylesheet matching
 * survives the migration unchanged. These imports therefore
 * remain authoritative for both Lit and any residual vanilla
 * surfaces; they are NOT a transitional scaffold awaiting
 * per-component `static styles`.
 */

import "@ingcreators/annot-core/styles/editor.css";
import "@ingcreators/annot-core/styles/toolbar.css";
import "@ingcreators/annot-core/styles/property-panel.css";
import "@ingcreators/annot-core/styles/fonts.css";
import "../src/styles/app.css";
import "../src/styles/file-manager.css";

import type { Preview } from "@storybook/web-components-vite";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    // `addon-a11y` integration — surface violations but don't
    // block the Stories UI. Once a11y coverage settles, we can
    // flip `test` to `"error"` to fail stories with violations.
    a11y: {
      test: "todo",
    },
  },
};

export default preview;
