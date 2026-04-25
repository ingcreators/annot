/**
 * Storybook preview config.
 *
 * Pulls in the same CSS the PWA boots with so stories render
 * against the production design tokens (light / dark variables,
 * toolbar styles, file-manager layout, Material Symbols font).
 * Once the Lit migration has populated per-component `static
 * styles`, most of these imports will be scoped inside the
 * elements themselves — but today's vanilla components rely on
 * global stylesheets, so preview parity requires loading them.
 */

import "@ingcreators/annot-core/styles/material-symbols.css";
import "@ingcreators/annot-core/styles/editor.css";
import "@ingcreators/annot-core/styles/toolbar.css";
import "@ingcreators/annot-core/styles/property-panel.css";
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
