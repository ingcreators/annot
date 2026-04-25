/**
 * Stories for the error bar — covers both the declarative
 * `<annot-error-bar>` Lit element and the module-level
 * functional API (`showError` / `showInfo` / `showSaveError`),
 * which is a thin facade over a singleton `<annot-error-bar>`.
 *
 * Bootstrapped in Phase 1 of `docs/plans/_done/storybook-introduction.md`
 * when the bar was imperative; the declarative variants lock in
 * the Phase 0 Lit element's visual contract per
 * `docs/plans/_done/lit-migration.md`.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./error-bar.js";
import { hideError, showError, showInfo, showSaveError } from "./error-bar.js";

/** Build the fallback hint paragraph that explains the bar
 *  renders outside the story iframe's root node. Returned from
 *  singleton-API stories instead of the bar itself — those
 *  stories mutate the document.body-mounted bar, not a local tree. */
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
  // Declarative story: mount an `<annot-error-bar>` directly so
  // reviewers see the element's render output. Manual-dismiss
  // and auto-dismiss behaviour is exercised in the shorthand
  // stories below via the singleton.
  render: (args) => {
    const bar = document.createElement("annot-error-bar");
    bar.severity = args.severity;
    bar.message = args.message;
    // Storybook arg-flow traces — intentional `console.log`.
    bar.action = args.withAction
      ? {
          label: "Retry",
          onClick: () => console.log("[story] Retry clicked"),
        }
      : null;
    bar.onDismissClick = () => console.log("[story] Dismiss clicked");
    bar.visible = true;
    return bar;
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
    // Storybook arg-flow trace — intentional `console.log`.
    showSaveError("Save failed: session expired.", () => {
      console.log("[story] showSaveError retry clicked");
    });
    return hint(
      "Rendered via showSaveError(message, onRetry) — the one-liner most callers use. The bar renders at the top of the story iframe.",
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

export const ErrorSingleton: Story = {
  name: "Shorthand — showError",
  render: () => {
    hideError();
    // Storybook arg-flow trace — intentional `console.log`.
    showError({
      message: "Unhandled exception in save pipeline.",
      severity: "error",
      action: {
        label: "Retry",
        onClick: () => console.log("[story] showError retry"),
      },
    });
    return hint(
      "Rendered via showError({ message, severity, action }) — the full API for callers that need options beyond the shorthands.",
    );
  },
};
