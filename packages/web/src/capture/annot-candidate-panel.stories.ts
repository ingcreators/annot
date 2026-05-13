/**
 * Stories for `<annot-candidate-panel>` — right-side panel inside
 * the capture workspace.
 *
 * Phase 2 of `docs/plans/web-capture-redesign.md` only ships the
 * empty state. Phase 3 adds populated stories.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-candidate-panel.js";

interface Args {
  count: number;
}

const meta: Meta<Args> = {
  title: "Capture / CandidatePanel",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.cssText =
      "width:320px;height:480px;background:var(--bg-panel, #2a2a2a);border-left:1px solid #444;";
    const el = document.createElement("annot-candidate-panel");
    el.count = args.count;
    wrapper.appendChild(el);
    return wrapper;
  },
  argTypes: {
    count: { control: { type: "number", min: 0 } },
  },
  args: {
    count: 0,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Empty: Story = {};

/** Phase 3 placeholder count — proves the header reflects the
 *  count even before cards render. Replaced by a real `Populated`
 *  story in Phase 3. */
export const PlaceholderCount: Story = {
  args: { count: 3 },
};
