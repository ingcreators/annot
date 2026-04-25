/**
 * Stories for `SaveStatusIndicator` — one variant per
 * `SaveStatus` state plus a "cycle" story that walks through
 * each state on a timer for manual visual verification.
 *
 * Phase 1 initial landmark of `docs/plans/storybook-introduction.md`.
 * The indicator becomes a Lit element in Phase 0 of
 * `lit-migration.md`; this story stays through the migration
 * as its visual contract.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { SaveStatusIndicator, type SaveStatus } from "./save-status-indicator.js";

interface Args {
  status: SaveStatus;
}

const meta: Meta<Args> = {
  title: "Editor / SaveStatusIndicator",
  render: (args) => {
    // The imperative class mounts itself into its container. We
    // hand Storybook a <div> and let the indicator populate it.
    // Storybook's `web-components-vite` framework accepts an
    // HTMLElement directly as a Renderable — no lit-html wrapper
    // needed (Lit lands as a dep in Phase 0 of lit-migration.md).
    const root = document.createElement("div");
    const ind = new SaveStatusIndicator(root);
    ind.setStatus(args.status);
    return root;
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
