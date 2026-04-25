/**
 * Stories for `<annot-save-status>` — one variant per
 * `SaveStatus` state.
 *
 * Bootstrapped in Phase 1 of `docs/plans/_done/storybook-introduction.md`
 * when the indicator was still imperative; converted to the
 * Lit element in Phase 0 of `docs/plans/_done/lit-migration.md`.
 * Stories are the visual contract preserved across the migration.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./save-status-indicator.js";
import type { SaveStatus } from "./save-status-indicator.js";

interface Args {
  status: SaveStatus;
}

const meta: Meta<Args> = {
  title: "Editor / SaveStatusIndicator",
  render: (args) => {
    const el = document.createElement("annot-save-status");
    el.status = args.status;
    return el;
  },
  argTypes: {
    status: {
      control: "select",
      options: ["saved", "pending", "saving", "error"],
    },
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Saved: Story = {
  args: { status: "saved" },
};

export const Pending: Story = {
  args: { status: "pending" },
};

export const Saving: Story = {
  args: { status: "saving" },
};

export const ErrorStatus: Story = {
  name: "Error",
  args: { status: "error" },
};
