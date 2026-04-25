/**
 * Stories for the `showError` / `showInfo` / `showSaveError` /
 * `showAuthError` functional API. The bar is a module-level
 * singleton (`ensureBar()` lazily creates it), so each story
 * calls `showError` directly and lets the bar mount into
 * document.body.
 *
 * Phase 1 initial landmark of `docs/plans/storybook-introduction.md`.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { hideError, showError, showInfo, showSaveError } from "./error-bar.js";

/** Build the fallback hint paragraph that explains the bar
 *  renders outside the story iframe's root node. Returned from
 *  each story instead of a `lit-html` template — Storybook
 *  accepts any HTMLElement as a Renderable, and Lit isn't a web
 *  dep yet (lands in Phase 0 of lit-migration.md). */
function hint(text: string): HTMLElement {
  const p = document.createElement("p");
  p.style.color = "var(--text-muted, #666)";
  p.style.fontSize = "13px";
  p.textContent = text;
  return p;
}

interface Args {
  severity: "error" | "warning" | "info";
  message: string;
  withAction: boolean;
}

const meta: Meta<Args> = {
  title: "UI / ErrorBar",
  // The error bar mounts itself into document.body, outside
  // Storybook's story iframe root. We reset the bar on each
  // render + surface a visible "trigger" button so the story
  // can be replayed by the Storybook user (useful for auto-
  // dismiss variants).
  render: (args) => {
    // Clear any previously-shown bar from a sibling story.
    hideError();
    showError({
      message: args.message,
      severity: args.severity,
      action: args.withAction
        ? {
            label: "Retry",
            onClick: () => {
              console.log("[story] Retry clicked");
            },
          }
        : undefined,
    });
    return hint(
      "The bar renders at the top of the story iframe. Use the controls to change severity / message / action.",
    );
  },
  argTypes: {
    severity: {
      control: "select",
      options: ["error", "warning", "info"],
    },
    message: { control: "text" },
    withAction: { control: "boolean" },
  },
  args: {
    severity: "error",
    message: "Something went wrong.",
    withAction: false,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const ErrorSeverity: Story = {
  name: "Error",
  args: {
    severity: "error",
    message: "Save failed: request timed out.",
  },
};

export const Warning: Story = {
  args: {
    severity: "warning",
    message: "You are offline. Changes will be lost.",
  },
};

export const Info: Story = {
  args: {
    severity: "info",
    message: "Workspace updated — reload to see changes.",
  },
};

export const ErrorWithRetry: Story = {
  args: {
    severity: "error",
    message: "Save failed: network unreachable.",
    withAction: true,
  },
};

export const SaveErrorShorthand: Story = {
  name: "Shorthand — showSaveError",
  render: () => {
    hideError();
    showSaveError("Save failed: session expired.", () => {
      console.log("[story] showSaveError retry clicked");
    });
    return hint(
      "Rendered via showSaveError(message, onRetry) — the one-liner most callers use.",
    );
  },
};

export const InfoShorthand: Story = {
  name: "Shorthand — showInfo",
  render: () => {
    hideError();
    // Short auto-dismiss so the story can be replayed quickly.
    showInfo("Connected to Google Drive.", 3000);
    return hint(
      "Info variant with autoDismiss: 3000. The bar disappears after 3 seconds; re-render to see it again.",
    );
  },
};
